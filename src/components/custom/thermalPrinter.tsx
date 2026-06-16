import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// ─── ESC/POS helpers ────────────────────────────────────────────────────────
// These are raw commands that all thermal printers understand

const ESC_INIT        = '\x1B\x40'       // Reset printer
const ALIGN_CENTER    = '\x1B\x61\x01'   // Center text
const ALIGN_LEFT      = '\x1B\x61\x00'   // Left align
const BOLD_ON         = '\x1B\x45\x01'   // Bold on
const BOLD_OFF        = '\x1B\x45\x00'   // Bold off
const FEED_AND_CUT    = '\x1D\x56\x41\x00' // Feed paper and cut

// Common BLE service UUIDs for thermal printers
// These cover most cheap Chinese thermal printers (Xprinter, GOOJPRT, Rongta, etc.)
const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // most common
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // second most common
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART (some printers)
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // another variant
]

// Build the receipt as a byte array
function buildReceipt(shopName, items) {
  const total = items.reduce((sum, i) => sum + i.qty * i.price, 0)
  const date = new Date().toLocaleString('fr-DZ')

  const separator32 = '================================\n'
  const separator32dash = '--------------------------------\n'

  // Format a line item: "2x Cola              240.00"
  function lineItem(item) {
    const left = `${item.qty}x ${item.name}`
    const right = (item.qty * item.price).toFixed(2)
    const spaces = 32 - left.length - right.length
    return left + ' '.repeat(Math.max(1, spaces)) + right + '\n'
  }

  const receipt = [
    ESC_INIT,
    ALIGN_CENTER,
    BOLD_ON,
    shopName + '\n',
    BOLD_OFF,
    'Tel: 0555 123 456\n',
    date + '\n',
    separator32,
    ALIGN_LEFT,
    ...items.map(lineItem),
    separator32dash,
    BOLD_ON,
    `TOTAL: ${total.toFixed(2)} DZD\n`,
    BOLD_OFF,
    separator32,
    ALIGN_CENTER,
    'Merci! A bientot.\n',
    '\n\n\n',   // extra feed so paper comes out enough to tear
    FEED_AND_CUT,
  ].join('')

  return new TextEncoder().encode(receipt)
}

// Send bytes to printer in 20-byte chunks (BLE MTU limit)
async function sendToPrinter(characteristic, bytes) {
  const CHUNK = 20
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.slice(i, i + CHUNK)
    if (characteristic.properties.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk)
    } else {
      await characteristic.writeValue(chunk)
    }
    // Small delay between chunks to avoid buffer overflow
    await new Promise((r) => setTimeout(r, 20))
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

// Dummy sale data — replace this with your real cart later
const DEMO_ITEMS = [
  { qty: 2, name: 'Cola 33cl',   price: 60  },
  { qty: 1, name: 'Chips Lay\'s', price: 80  },
  { qty: 3, name: 'Eau Minérale', price: 25  },
]

export default function PrintTest() {
  const [connected, setConnected]   = useState(false)
  const [deviceName, setDeviceName] = useState('')
  const [status, setStatus]         = useState('')
  const [statusType, setStatusType] = useState('') // 'info' | 'success' | 'error'
  const [printing, setPrinting]     = useState(false)

  const charRef = useRef(null)

  function showStatus(msg, type = 'info') {
    setStatus(msg)
    setStatusType(type)
  }

  async function connectPrinter() {
    if (!navigator.bluetooth) {
      showStatus('Web Bluetooth not supported. Use Chrome on Android.', 'error')
      return
    }

    try {
      showStatus('Opening Bluetooth scanner...')

      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: PRINTER_SERVICES,
      })

      showStatus('Connecting to ' + (device.name || 'device') + '...')

      const server = await device.gatt.connect()
      let char = null

      // Try each known service UUID until we find a writable characteristic
      for (const uuid of PRINTER_SERVICES) {
        try {
          const service = await server.getPrimaryService(uuid)
          const chars   = await service.getCharacteristics()
          char = chars.find(
            (c) => c.properties.write || c.properties.writeWithoutResponse
          )
          if (char) break
        } catch (_) {
          // This UUID not found on this printer, try the next
        }
      }

      if (!char) {
        throw new Error(
          'Could not find a writable characteristic. ' +
          'Make sure the printer is in pairing mode and check the model.'
        )
      }

      charRef.current = char
      setConnected(true)
      setDeviceName(device.name || 'Printer')
      showStatus('Connected to ' + (device.name || 'printer'), 'success')

      // Handle disconnection
      device.addEventListener('gattserverdisconnected', () => {
        setConnected(false)
        setDeviceName('')
        charRef.current = null
        showStatus('Printer disconnected', 'error')
      })
    } catch (err) {
      if (err.name === 'NotFoundError') {
        showStatus('No device selected.', 'info')
      } else {
        showStatus('Error: ' + err.message, 'error')
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
    } catch (err) {
      showStatus('Print error: ' + err.message, 'error')
    } finally {
      setPrinting(false)
    }
  }

  const total = DEMO_ITEMS.reduce((s, i) => s + i.qty * i.price, 0)

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
                  {left}
                  {' '.repeat(Math.max(1, 32 - left.length - right.length))}
                  {right}
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
            <p className={`text-sm px-3 py-2 rounded-md ${
              statusType === 'success' ? 'bg-green-50 text-green-700' :
              statusType === 'error'   ? 'bg-red-50 text-red-700'     :
              'bg-blue-50 text-blue-700'
            }`}>
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