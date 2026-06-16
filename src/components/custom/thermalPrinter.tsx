import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SaleItem {
  qty: number
  name: string
  price: number
}

type StatusType = 'info' | 'success' | 'error' | ''

// ─── ESC/POS helpers ─────────────────────────────────────────────────────────

const ESC_INIT     = '\x1B\x40'
const ALIGN_CENTER = '\x1B\x61\x01'
const ALIGN_LEFT   = '\x1B\x61\x00'
const BOLD_ON      = '\x1B\x45\x01'
const BOLD_OFF     = '\x1B\x45\x00'
const FEED_AND_CUT = '\x1D\x56\x41\x00'

// Common BLE service UUIDs for thermal printers
const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
]

function buildReceipt(shopName: string, items: SaleItem[]): Uint8Array {
  const total = items.reduce((sum: number, i: SaleItem) => sum + i.qty * i.price, 0)
  const date = new Date().toLocaleString('fr-DZ')
  const sep  = '================================\n'
  const dash = '--------------------------------\n'

  function lineItem(item: SaleItem): string {
    const left  = `${item.qty}x ${item.name}`
    const right = (item.qty * item.price).toFixed(2)
    const spaces = Math.max(1, 32 - left.length - right.length)
    return left + ' '.repeat(spaces) + right + '\n'
  }

  const receipt = [
    ESC_INIT,
    ALIGN_CENTER,
    BOLD_ON,  shopName + '\n', BOLD_OFF,
    'Tel: 0555 123 456\n',
    date + '\n',
    sep,
    ALIGN_LEFT,
    ...items.map(lineItem),
    dash,
    BOLD_ON, `TOTAL: ${total.toFixed(2)} DZD\n`, BOLD_OFF,
    sep,
    ALIGN_CENTER,
    'Merci! A bientot.\n',
    '\n\n\n',
    FEED_AND_CUT,
  ].join('')

  return new TextEncoder().encode(receipt)
}

async function sendToPrinter(
  characteristic: BluetoothRemoteGATTCharacteristic,
  bytes: Uint8Array
): Promise<void> {
  const CHUNK = 20
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.slice(i, i + CHUNK)
    if (characteristic.properties.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk)
    } else {
      await characteristic.writeValue(chunk)
    }
    await new Promise((r) => setTimeout(r, 20))
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

const DEMO_ITEMS: SaleItem[] = [
  { qty: 2, name: "Cola 33cl",    price: 60 },
  { qty: 1, name: "Chips Lay's",  price: 80 },
  { qty: 3, name: "Eau Minérale", price: 25 },
]

export default function PrintTest() {
  const [connected,  setConnected]  = useState(false)
  const [deviceName, setDeviceName] = useState('')
  const [status,     setStatus]     = useState('')
  const [statusType, setStatusType] = useState<StatusType>('')
  const [printing,   setPrinting]   = useState(false)

  const charRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null)

  function showStatus(msg: string, type: StatusType = 'info') {
    setStatus(msg)
    setStatusType(type)
  }

  async function connectPrinter() {
    // navigator.bluetooth is not in the default TS lib — cast to any
    const nav = navigator as Navigator & {
      bluetooth: {
        requestDevice: (options: object) => Promise<BluetoothDevice>
      }
    }

    if (!nav.bluetooth) {
      showStatus('Web Bluetooth not supported. Use Chrome on Android.', 'error')
      return
    }

    try {
      showStatus('Opening Bluetooth scanner...')

      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: PRINTER_SERVICES,
      })

      showStatus('Connecting to ' + (device.name ?? 'device') + '...')

      const server = await device.gatt!.connect()
      let char: BluetoothRemoteGATTCharacteristic | null = null

      for (const uuid of PRINTER_SERVICES) {
        try {
          const service = await server.getPrimaryService(uuid)
          const chars   = await service.getCharacteristics()
          char = chars.find(
            (c: BluetoothRemoteGATTCharacteristic) =>
              c.properties.write || c.properties.writeWithoutResponse
          ) ?? null
          if (char) break
        } catch (_) {
          // UUID not on this printer, try next
        }
      }

      if (!char) {
        throw new Error(
          'No writable characteristic found. Check printer model.'
        )
      }

      charRef.current = char
      setConnected(true)
      setDeviceName(device.name ?? 'Printer')
      showStatus('Connected to ' + (device.name ?? 'printer'), 'success')

      device.addEventListener('gattserverdisconnected', () => {
        setConnected(false)
        setDeviceName('')
        charRef.current = null
        showStatus('Printer disconnected', 'error')
      })
    } catch (err: unknown) {
      const error = err as Error
      if (error.name === 'NotFoundError') {
        showStatus('No device selected.', 'info')
      } else {
        showStatus('Error: ' + error.message, 'error')
      }
    }
  }

  async function printInvoice() {
    if (!charRef.current) return
    try {
      setPrinting(true)
      showStatus('Sending to printer...')
      const bytes = buildReceipt('MON MAGASIN', DEMO_ITEMS)
      await sendToPrinter(charRef.current, bytes)
      showStatus('Printed!', 'success')
    } catch (err: unknown) {
      const error = err as Error
      showStatus('Print error: ' + error.message, 'error')
    } finally {
      setPrinting(false)
    }
  }

  const total = DEMO_ITEMS.reduce((s, i) => s + i.qty * i.price, 0)

  const statusColors: Record<StatusType, string> = {
    success: 'bg-green-50 text-green-700',
    error:   'bg-red-50 text-red-700',
    info:    'bg-blue-50 text-blue-700',
    '':      '',
  }

  return (
    <div className="p-4 max-w-sm mx-auto space-y-4">

      {/* Receipt preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoice preview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="font-mono text-xs bg-white text-black p-4 rounded border border-dashed leading-relaxed">
            <p className="text-center font-bold">MON MAGASIN</p>
            <p className="text-center text-[10px]">Tel: 0555 123 456</p>
            <p className="text-center text-[10px]">{new Date().toLocaleString('fr-DZ')}</p>
            <p>================================</p>
            {DEMO_ITEMS.map((item, i) => {
              const left  = `${item.qty}x ${item.name}`
              const right = (item.qty * item.price).toFixed(2)
              return (
                <p key={i}>
                  {left}{'  '}{right}
                </p>
              )
            })}
            <p>--------------------------------</p>
            <p className="font-bold">TOTAL: {total.toFixed(2)} DZD</p>
            <p>================================</p>
            <p className="text-center">Merci! A bientot.</p>
          </div>
        </CardContent>
      </Card>

      {/* Printer connection */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Bluetooth printer</CardTitle>
            <Badge variant={connected ? 'default' : 'secondary'}>
              {connected ? deviceName : 'Not connected'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={connectPrinter}
              disabled={connected}
              className="flex-1"
            >
              {connected ? 'Connected' : 'Connect printer'}
            </Button>
            <Button
              onClick={printInvoice}
              disabled={!connected || printing}
              className="flex-1"
            >
              {printing ? 'Printing...' : 'Print'}
            </Button>
          </div>

          {status && (
            <p className={`text-sm px-3 py-2 rounded-md ${statusColors[statusType]}`}>
              {status}
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Requires Chrome on Android. Printer must be in pairing mode.
          </p>
        </CardContent>
      </Card>

    </div>
  )
}