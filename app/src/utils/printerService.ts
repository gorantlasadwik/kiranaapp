// Thermal Printer integration driver and simulator for ATPOS H58BT
// Translates bills to ESC/POS bytes and generates visually appealing simulated HTML representations.

import { db } from '../db';
import type { Bill } from '../db';
import { registerPlugin } from '@capacitor/core';

export interface PrinterConfig {
  printer_name: string;
  printer_mac: string;
  upi_id: string;
  merchant_name: string;
  auto_connect?: boolean;
  upi_qr_image?: string; // base64 data URL of the uploaded QR photo
  qr_size?: number;
}

export interface RenderedReceipt {
  html: string;
  rawText: string;
  escposBytes: Uint8Array;
}

export const DEFAULT_UPI_QR_PAYLOAD = 'upi://pay?pa=gpay-11232240371@okbizaxis&pn=Sai%20Ram%20Kirana&cu=INR';

// Printer Connection State
let printerStatus: 'Connected' | 'Disconnected' | 'Connecting' = 'Disconnected';
let _connectionPollInterval: ReturnType<typeof setInterval> | null = null;

const BluetoothStatusPlugin = (typeof window !== 'undefined' && typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor.isNativePlatform())
  ? registerPlugin<any>('BluetoothStatusPlugin')
  : null;

if (BluetoothStatusPlugin) {
  BluetoothStatusPlugin.addListener('onPrinterStatusChange', (data: { status: string; mac?: string; name?: string; reason?: string }) => {
    console.log('[PrinterService] Native Bluetooth status change:', data);
    const currentMac = db.getSetting('printer_mac') || 'DC:0D:30:06:49:9C';
    if (data.status === 'disconnected') {
      if (data.reason === 'bluetooth_disabled' || !data.mac || data.mac.toUpperCase() === currentMac.toUpperCase()) {
        console.log('[PrinterService] Printer or Bluetooth disconnected natively');
        printerStatus = 'Disconnected';
        window.dispatchEvent(new CustomEvent('printer-disconnected'));
      }
    } else if (data.status === 'connected') {
      if (data.mac && data.mac.toUpperCase() === currentMac.toUpperCase()) {
        console.log('[PrinterService] Printer connected natively');
        printerStatus = 'Connected';
        window.dispatchEvent(new CustomEvent('printer-connected'));
      }
    }
  });
}

// Start polling bluetoothSerial.isConnected() every 5 s to detect power-off events
function startConnectionPoller() {
  if (_connectionPollInterval) return; // already running
  _connectionPollInterval = setInterval(() => {
    const isNative = typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor.isNativePlatform();
    if (!isNative || typeof (window as any).bluetoothSerial === 'undefined') return;
    if (printerStatus !== 'Connected') {
      stopConnectionPoller();
      return;
    }
    (window as any).bluetoothSerial.isConnected(
      () => { /* still connected */ },
      () => {
        // Lost connection
        console.log('[PrinterService] Poll: printer lost connection');
        printerStatus = 'Disconnected';
        window.dispatchEvent(new CustomEvent('printer-disconnected'));
        stopConnectionPoller();
      }
    );
  }, 5000);
}

function stopConnectionPoller() {
  if (_connectionPollInterval) {
    clearInterval(_connectionPollInterval);
    _connectionPollInterval = null;
  }
}

// Helper to wrap text into multiple lines of maxLen
export function wrapText(text: string, maxLen: number): string[] {
  const words = (text || '').split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!word) continue;
    if ((currentLine + (currentLine ? ' ' : '') + word).length <= maxLen) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
      while (currentLine.length > maxLen) {
        lines.push(currentLine.substring(0, maxLen));
        currentLine = currentLine.substring(maxLen);
      }
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// Generate the UPI QR Code payload. The QR is intentionally amount-less.
export function generateUPIPayload(upiId: string, merchantName: string): string {
  const cleanInput = (upiId || '').trim();
  if (!cleanInput) return DEFAULT_UPI_QR_PAYLOAD;

  // If the input is already a full upi:// URL, return it exactly as-is.
  // This preserves all custom/merchant parameters and encoding perfectly.
  if (/^upi:\/\/pay\?/i.test(cleanInput)) {
    return cleanInput;
  }

  // Otherwise, construct a clean UPI URL from the raw VPA
  const encodedPn = encodeURIComponent((merchantName || 'Sai Ram Kirana').trim());
  return `upi://pay?pa=${cleanInput}&pn=${encodedPn}&cu=INR`;
}

export function appendAmountToUPIPayload(upiPayload: string, amount: number): string {
  if (!upiPayload) return '';
  if (!/^upi:\/\/pay\?/i.test(upiPayload)) {
    return upiPayload;
  }
  if (/[?&]am=/i.test(upiPayload)) {
    return upiPayload.replace(/([?&]am=)[^&]*/i, `$1${amount.toFixed(2)}`);
  }
  return `${upiPayload}&am=${amount.toFixed(2)}`;
}

export function extractUPIDisplayText(upiPayload: string): string {
  const paMatch = (upiPayload || '').match(/[?&]pa=([^&]+)/i);
  if (!paMatch?.[1]) return upiPayload;
  try {
    return decodeURIComponent(paMatch[1]);
  } catch {
    return paMatch[1];
  }
}

// Compact unit abbreviations for receipt printing
export function formatUnit(unit: string): string {
  switch ((unit || '').toLowerCase().trim()) {
    case 'gram': case 'grams': case 'g': case 'gm': case 'gms': return 'g';
    case 'kg': case 'kgs': case 'kilo': case 'kilos': case 'kilogram': return 'kg';
    case 'litre': case 'litres': case 'liter': case 'liters': return 'L';
    case 'ml': case 'mls': case 'milliliter': case 'milliliters': return 'ml';
    case 'piece': case 'pieces': case 'pc': case 'pcs': return 'pc';
    case 'carton': case 'cartons': case 'cartoon': case 'cartoons': return 'ct';
    case 'bag': case 'bags': return 'bg';
    case 'tray': case 'trays': return 'tr';
    case 'sheet': case 'sheets': return 'sht';
    case 'pudha': case 'pudhas': case 'puda': return 'pud';
    default: return unit || '';
  }
}

// ESC/POS Command Generator class
export class EscPosBuilder {
  private buffer: number[] = [];

  initialize(): this {
    this.buffer.push(0x1B, 0x40);
    return this;
  }

  alignLeft(): this {
    this.buffer.push(0x1B, 0x61, 0x00);
    return this;
  }

  alignCenter(): this {
    this.buffer.push(0x1B, 0x61, 0x01);
    return this;
  }

  alignRight(): this {
    this.buffer.push(0x1B, 0x61, 0x02);
    return this;
  }

  bold(enable: boolean): this {
    this.buffer.push(0x1B, 0x45, enable ? 0x01 : 0x00);
    return this;
  }

  fontSize(size: 'normal' | 'large'): this {
    if (size === 'large') {
      this.buffer.push(0x1D, 0x21, 0x11); // Double width + double height
    } else {
      this.buffer.push(0x1D, 0x21, 0x00); // Normal
    }
    return this;
  }

  text(str: string): this {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    for (const b of Array.from(bytes)) {
      this.buffer.push(b);
    }
    return this;
  }

  lineFeed(count = 1): this {
    for (let i = 0; i < count; i++) {
      this.buffer.push(0x0A);
    }
    return this;
  }

  cut(): this {
    this.buffer.push(0x1D, 0x56, 0x42, 0x00);
    return this;
  }

  barcode(code: string): this {
    // Select barcode height: GS h n
    this.buffer.push(0x1D, 0x68, 0x50); // Height = 80 dots
    // Select barcode width: GS w n
    this.buffer.push(0x1D, 0x77, 0x02); // Width = 2 (thin)
    // Select print position of HRI characters: GS H n
    this.buffer.push(0x1D, 0x48, 0x02); // Print below barcode
    // Print barcode Code-128 (System B: GS k 73 n {B data)
    const codeBytes = new TextEncoder().encode(code);
    const n = codeBytes.length + 2;
    this.buffer.push(0x1D, 0x6B, 0x49, n, 0x7B, 0x42); // subset B select
    for (const b of Array.from(codeBytes)) {
      this.buffer.push(b);
    }
    return this;
  }

  qrCode(data: string, size = 10, eccLevel: 'L' | 'M' | 'Q' | 'H' = 'M'): this {
    // 1. Set QR Code model: GS ( k 04 00 31 41 32 00 (Model 2)
    this.buffer.push(0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    // 2. Set QR Code size: GS ( k 03 00 31 43 size
    const qrSize = Math.max(1, Math.min(16, size));
    this.buffer.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, qrSize);
    // 3. Set QR Code error correction level: GS ( k 03 00 31 44 n
    let eccVal = 0x30;
    if (eccLevel === 'M') eccVal = 0x31;
    else if (eccLevel === 'Q') eccVal = 0x32;
    else if (eccLevel === 'H') eccVal = 0x33;
    this.buffer.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x44, eccVal);
    // 4. Store QR Code data: GS ( k pL pH 31 50 30 [data]
    const dataBytes = new TextEncoder().encode(data);
    // ESC/POS standard dictates that pL, pH must represent the length of parameters
    // following the pH field, which includes the 3 header bytes (0x31 0x50 0x30) + data length.
    const numBytes = dataBytes.length + 3;
    const pL = numBytes & 0xFF;
    const pH = (numBytes >> 8) & 0xFF;
    this.buffer.push(0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30);
    for (const b of Array.from(dataBytes)) {
      this.buffer.push(b);
    }
    // 5. Print QR Code: GS ( k 03 00 31 51 30
    this.buffer.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30);
    return this;
  }

  getBytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

export function generateSimulatedReceipt(bill: Bill, config: PrinterConfig): RenderedReceipt {
  const storeName = config.merchant_name || 'SAI RAM KIRANA';
  const isUPIPayment = bill.payment_mode === 'UPI';
  const upiPayload = isUPIPayment ? generateUPIPayload(config.upi_id, storeName) : '';
  const upiDisplayText = upiPayload ? extractUPIDisplayText(upiPayload) : '';

  const dateStr = new Date(bill.created_at || Date.now()).toLocaleString('en-IN', { hour12: true });


  const builder = new EscPosBuilder();
  builder.initialize();

  // Plain text builder
  let txt = '';
  
  // Header
  txt += `================================\n`;
  builder.alignCenter().bold(true).fontSize('large').text(storeName).lineFeed().fontSize('normal').bold(false);
  
  txt += `        ${storeName.toUpperCase()}\n`;
  txt += `     Daily Provisions Store\n`;
  txt += `       PH: 99890 68112\n`;
  builder.text('Daily Provisions Store').lineFeed();
  builder.text('PH: 99890 68112').lineFeed();
  
  txt += `================================\n`;
  builder.alignLeft().text('================================').lineFeed();

  // Metadata
  const billLine = `Bill No: #${bill.bill_number}`;
  txt += billLine + '\n';
  builder.text(billLine).lineFeed();

  const dateLine = `Date:    ${dateStr}`;
  txt += dateLine + '\n';
  builder.text(dateLine).lineFeed();

  const custName = bill.customer_name && bill.customer_name !== 'Customer' ? bill.customer_name : 'Walk-In';
  const custLine = `Cust:    ${custName}`;
  txt += custLine + '\n';
  builder.text(custLine).lineFeed();

  if (bill.customer_phone && bill.customer_phone !== 'NA') {
    const phoneLine = `Phone:   ${bill.customer_phone}`;
    txt += phoneLine + '\n';
    builder.text(phoneLine).lineFeed();
  }

  txt += `--------------------------------\n`;
  builder.text('--------------------------------').lineFeed();

  // Table items (32 character limit formatting) - name qty price
  const headerStr = 'ITEM                QTY    TOTAL';
  txt += `${headerStr}\n`;
  builder.alignLeft().text(headerStr).lineFeed();

  txt += `--------------------------------\n`;
  builder.text('--------------------------------').lineFeed();

  bill.items.forEach(item => {
    const qtyStr = `${item.quantity}${formatUnit(item.unit)}`;
    const totalStr = `${item.total.toFixed(0)}`;

    // Align Name: 18 chars, Qty: 5 chars, Total: 9 chars (Total = 32 chars)
    const nameLines = wrapText(item.product_name, 18);
    const firstLineName = nameLines[0].padEnd(18, ' ');
    const formattedQty = qtyStr.padStart(5, ' ');
    const formattedTotal = totalStr.padStart(9, ' ');
    const combinedLine = `${firstLineName}${formattedQty}${formattedTotal}`;

    txt += `${combinedLine}\n`;
    builder.text(combinedLine).lineFeed();

    for (let i = 1; i < nameLines.length; i++) {
      const extraLine = nameLines[i].padEnd(32, ' ');
      txt += `${extraLine}\n`;
      builder.text(extraLine).lineFeed();
    }
  });

  txt += `--------------------------------\n`;
  builder.alignLeft().text('--------------------------------').lineFeed();

  // Totals
  const subTotalStr = `Subtotal:             ₹${bill.subtotal.toFixed(2)}`;
  txt += subTotalStr + '\n';
  builder.text(`Subtotal:${' '.repeat(32 - 9 - bill.subtotal.toFixed(2).length - 3)}Rs.${bill.subtotal.toFixed(2)}`).lineFeed();

  if (bill.discount > 0) {
    const discStr = `Discount:            -₹${bill.discount.toFixed(2)}`;
    txt += discStr + '\n';
    builder.text(`Discount:${' '.repeat(32 - 9 - bill.discount.toFixed(2).length - 4)}-Rs.${bill.discount.toFixed(2)}`).lineFeed();
  }

  const grandTotalStr = `GRAND TOTAL:          ₹${bill.grand_total.toFixed(2)}`;
  txt += grandTotalStr + '\n';
  builder.bold(true).text(`GRAND TOTAL:${' '.repeat(32 - 12 - bill.grand_total.toFixed(2).length - 3)}Rs.${bill.grand_total.toFixed(2)}`).lineFeed().bold(false);

  txt += `--------------------------------\n`;
  builder.text('--------------------------------').lineFeed();

  const pmLine = `Payment: ${bill.payment_mode}`;
  txt += pmLine + '\n';
  builder.bold(true).text(pmLine).lineFeed().bold(false);

  const khataSnapshot = bill.payment_mode === 'Credit'
    ? db.getCustomerKhataSnapshot(bill.customer_id, bill.created_at, bill.grand_total)
    : { prevDue: 0, newDue: 0 };

  if (bill.payment_mode === 'Credit') {
    // Add Khata summary lines
    const prevDue = khataSnapshot.prevDue;
    const newDue = khataSnapshot.newDue;
    
    const prevDueStr = `Previous Due:         ₹${prevDue.toFixed(2)}`;
    const newDueStr =  `New Balance:          ₹${newDue.toFixed(2)}`;
    txt += prevDueStr + '\n' + newDueStr + '\n';
    builder.text(`Previous Due:${' '.repeat(32 - 13 - prevDue.toFixed(2).length - 3)}Rs.${prevDue.toFixed(2)}`).lineFeed();
    builder.bold(true).text(`New Balance:${' '.repeat(32 - 12 - newDue.toFixed(2).length - 3)}Rs.${newDue.toFixed(2)}`).lineFeed().bold(false);
  }

  if (isUPIPayment && upiPayload) {
    txt += `--------------------------------\n`;
    txt += `SCAN TO PAY (UPI)\n`;
    txt += `${upiDisplayText}\n`;
    txt += `UPI PHONE: 9989068112\n`;
    const qrSize = config.qr_size || 10;
    builder.alignCenter()
      .text('--------------------------------').lineFeed()
      .bold(true).text('SCAN TO PAY (UPI)').lineFeed().bold(false)
      .lineFeed()
      .qrCode(upiPayload, qrSize, 'L')
      .lineFeed(2)
      .text(upiDisplayText).lineFeed()
      .bold(true).text('UPI NUMBER TO PAY: 9989068112').lineFeed().bold(false)
      .lineFeed()
      .alignLeft();
  }

  txt += `================================\n`;
  txt += ` Thank you! Please visit again \n`;
  txt += `================================\n`;
  
  builder.alignCenter().text('================================').lineFeed();
  builder.text('Thank you! Please visit again').lineFeed();
  builder.text('================================').lineFeed();
  builder.lineFeed(3).cut();

  // Build HTML Simulation


  const itemsHtml = `
    <table style="width: 100%; border-collapse: collapse; font-family: monospace; font-size: 11px; margin-bottom: 8px; table-layout: fixed;">
      <thead>
        <tr style="border-bottom: 1.5px dashed #000; font-weight: bold; color: #000; font-size: 11px;">
          <th style="text-align: left; padding: 4px 0; width: 55%;">ITEM</th>
          <th style="text-align: right; padding: 4px 0; width: 20%;">QTY</th>
          <th style="text-align: right; padding: 4px 0; width: 25%;">TOTAL</th>
        </tr>
      </thead>
      <tbody>
        ${bill.items.map(item => {
          const qtyStr = `${item.quantity}${formatUnit(item.unit)}`;
          return `
            <tr style="vertical-align: top; border-bottom: 1px dashed #f1f5f9; font-size: 11px;">
              <td style="text-align: left; padding: 6px 0; font-weight: bold; color: #1a1a1a; word-break: break-word; width: 55%; overflow: hidden; text-overflow: ellipsis;">
                ${item.product_name}
              </td>
              <td style="text-align: right; padding: 6px 0; font-weight: bold; color: #334155; font-family: monospace; white-space: nowrap; width: 20%;">
                ${qtyStr}
              </td>
              <td style="text-align: right; padding: 6px 0; font-weight: bold; color: #000; font-family: monospace; width: 25%;">
                ₹${item.total.toFixed(0)}
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  const khataSectionHtml = bill.payment_mode === 'Credit' ? `
    <div style="border-top: 1px dashed #666; margin-top: 8px; padding-top: 8px; font-size: 13px; font-family: monospace;">
      <div style="display: flex; justify-content: space-between;">
        <span>PREVIOUS DUE</span>
        <span>₹${khataSnapshot.prevDue.toFixed(2)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; font-weight: bold; color: #b45309;">
        <span>NEW KHATA DUE</span>
        <span>₹${khataSnapshot.newDue.toFixed(2)}</span>
      </div>
    </div>
  ` : '';

  // UPI QR preview section. Physical printer output uses ESC/POS QR commands above.
  const qrSectionHtml = (() => {
    if (!isUPIPayment || !upiPayload) return '';
    const qrSizeSetting = config.qr_size || 8;
    const imgSize = 120 + (qrSizeSetting - 6) * 15; // 6 -> 120px, 8 -> 150px, 10 -> 180px, 12 -> 210px, 14 -> 240px, 16 -> 270px

    if (config.upi_qr_image) {
      return `
        <div style="border-top: 1.5px dashed #94a3b8; margin-top: 12px; padding-top: 12px; text-align: center;">
          <div style="font-size: 10px; font-weight: bold; color: #334155; letter-spacing: 0.5px; margin-bottom: 8px;">SCAN TO PAY (UPI)</div>
          <img src="${config.upi_qr_image}" style="width: ${imgSize}px; height: ${imgSize}px; object-fit: contain; border: 1px solid #e2e8f0; border-radius: 6px; display: block; margin: 0 auto;" alt="UPI QR" />
          <div style="font-size: 9px; color: #64748b; margin-top: 6px; font-family: monospace; word-break: break-all;">${upiDisplayText}</div>
          <div style="font-size: 10px; font-weight: bold; color: #000; margin-top: 6px; font-family: monospace;">UPI NUMBER TO PAY: 9989068112</div>
        </div>
      `;
    }

    // Autorun QR code generator API for the VPA payload
    const generatedQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${imgSize}x${imgSize}&data=${encodeURIComponent(upiPayload)}`;
    return `
      <div style="border-top: 1.5px dashed #94a3b8; margin-top: 12px; padding-top: 10px; text-align: center;">
        <div style="font-size: 10px; font-weight: bold; color: #334155; letter-spacing: 0.5px; margin-bottom: 6px;">SCAN TO PAY (UPI)</div>
        <img src="${generatedQrUrl}" style="width: ${imgSize}px; height: ${imgSize}px; object-fit: contain; border: 1px solid #e2e8f0; border-radius: 6px; display: block; margin: 0 auto;" alt="UPI QR" />
        <div style="font-size: 11px; font-weight: 900; color: #0f172a; font-family: monospace; word-break: break-all; margin-top: 6px;">${upiDisplayText}</div>
        <div style="font-size: 10px; font-weight: bold; color: #000; margin-top: 6px; font-family: monospace;">UPI NUMBER TO PAY: 9989068112</div>
      </div>
    `;
  })();

  const receiptHtml = `
    <div style="width: 280px; background: #ffffff; color: #1a1a1a; padding: 20px 16px; box-shadow: 0 6px 20px rgba(0,0,0,0.15); border-radius: 8px; font-family: 'Courier New', Courier, monospace; margin: 0 auto; border: 1px solid #e2e8f0; box-sizing: border-box; text-transform: uppercase; letter-spacing: 0.2px; position: relative;">
      
      <!-- Top receipt serrated trim line indicator -->
      <div style="text-align: center; margin-bottom: 12px; border-bottom: 2px dashed #94a3b8; padding-bottom: 8px;">
        <div style="display: flex; justify-content: center; margin-bottom: 8px;">
          <img src="/bill-logo.png" style="max-height: 48px; width: auto; object-fit: contain; filter: grayscale(100%);" alt="Store Logo" />
        </div>
        <h2 style="margin: 0; font-size: 19px; font-weight: 900; letter-spacing: 1.5px; color: #0f172a;">${storeName}</h2>
        <p style="margin: 4px 0 0 0; font-size: 10px; color: #475569; font-weight: bold; letter-spacing: 1.2px;">Daily Provisions Store</p>
        <p style="margin: 2px 0 0 0; font-size: 10px; color: #475569; font-weight: bold; letter-spacing: 1.2px;">PH: 99890 68112</p>
      </div>
      
      <div style="border-bottom: 2px dashed #94a3b8; padding: 0 0 8px 0; margin-bottom: 12px; font-size: 11px; color: #334155; line-height: 1.5;">
        <div><b>BILL NO:</b> #${bill.bill_number}</div>
        <div><b>DATE   :</b> ${dateStr}</div>
        <div><b>CUST   :</b> ${custName}</div>
        ${bill.customer_phone && bill.customer_phone !== 'NA' ? `<div><b>PHONE  :</b> ${bill.customer_phone}</div>` : ''}
      </div>

      <div style="margin-bottom: 12px;">
        ${itemsHtml}
      </div>

      <div style="border-top: 2px dashed #94a3b8; padding-top: 8px; font-size: 13px; color: #1e293b;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
          <span>SUBTOTAL</span>
          <span style="font-weight: bold;">₹${bill.subtotal.toFixed(2)}</span>
        </div>
        ${bill.discount > 0 ? `
        <div style="display: flex; justify-content: space-between; color: #16a34a; margin-bottom: 2px;">
          <span>DISCOUNT</span>
          <span style="font-weight: bold;">-₹${bill.discount.toFixed(2)}</span>
        </div>` : ''}
        <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 15px; margin-top: 6px; border-top: 1px solid #0f172a; border-bottom: 2px double #0f172a; padding: 6px 0; color: #000;">
          <span>GRAND TOTAL</span>
          <span>₹${bill.grand_total.toFixed(2)}</span>
        </div>
      </div>

      <div style="margin-top: 8px; font-size: 11px; font-weight: bold; color: #334155;">
        <span>PAYMENT MODE: ${bill.payment_mode}</span>
      </div>

      ${khataSectionHtml}
      ${qrSectionHtml}

      <!-- Decorative Barcode -->
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; margin-top: 20px; margin-bottom: 2px; opacity: 0.85;">
        <div style="display: flex; height: 32px; align-items: stretch; gap: 1px; width: 160px;">
          <div style="background:#111; width:2px;"></div>
          <div style="background:#111; width:1px;"></div>
          <div style="background:transparent; width:1px;"></div>
          <div style="background:#111; width:3px;"></div>
          <div style="background:#111; width:1px;"></div>
          <div style="background:transparent; width:2px;"></div>
          <div style="background:#111; width:2px;"></div>
          <div style="background:#111; width:4px;"></div>
          <div style="background:transparent; width:1px;"></div>
          <div style="background:#111; width:1px;"></div>
          <div style="background:#111; width:2px;"></div>
          <div style="background:transparent; width:3px;"></div>
          <div style="background:#111; width:3px;"></div>
          <div style="background:#111; width:1px;"></div>
          <div style="background:transparent; width:1px;"></div>
          <div style="background:#111; width:2px;"></div>
          <div style="background:#111; width:2px;"></div>
          <div style="background:transparent; width:2px;"></div>
          <div style="background:#111; width:4px;"></div>
          <div style="background:#111; width:1px;"></div>
          <div style="background:transparent; width:1px;"></div>
          <div style="background:#111; width:2px;"></div>
          <div style="background:#111; width:3px;"></div>
          <div style="background:transparent; width:1px;"></div>
          <div style="background:#111; width:1px;"></div>
          <div style="background:#111; width:1px;"></div>
          <div style="background:transparent; width:2px;"></div>
          <div style="background:#111; width:3px;"></div>
          <div style="background:#111; width:2px;"></div>
        </div>
        <span style="font-size: 8px; font-family: monospace; letter-spacing: 2px; margin-top: 4px; color: #475569; font-weight: bold;">*SRK-${bill.bill_number}*</span>
      </div>

      <div style="text-align: center; margin-top: 16px; font-size: 9px; border-top: 2px dashed #94a3b8; padding-top: 10px; color: #475569; font-weight: bold; letter-spacing: 0.5px;">
        <span>THANK YOU! VISIT AGAIN</span>
      </div>
    </div>
  `;

  return {
    html: receiptHtml,
    rawText: txt,
    escposBytes: builder.getBytes()
  };
}

// Code-128 Barcode widths table
const CODE128_PATTERNS: number[][] = [
  [2, 1, 2, 2, 2, 2], // 0: space
  [2, 2, 2, 1, 2, 2], // 1: !
  [2, 2, 2, 2, 2, 1], // 2: "
  [1, 2, 1, 2, 2, 3], // 3: #
  [1, 2, 1, 3, 2, 2], // 4: $
  [1, 3, 1, 2, 2, 2], // 5: %
  [1, 2, 2, 2, 1, 3], // 6: &
  [1, 2, 2, 3, 1, 2], // 7: '
  [1, 3, 2, 2, 1, 2], // 8: (
  [2, 2, 1, 2, 1, 3], // 9: )
  [2, 2, 1, 3, 1, 2], // 10: *
  [2, 3, 1, 2, 1, 2], // 11: +
  [1, 1, 2, 2, 3, 2], // 12: ,
  [1, 2, 2, 1, 3, 2], // 13: -
  [1, 2, 2, 2, 3, 1], // 14: .
  [1, 1, 3, 2, 2, 2], // 15: /
  [1, 2, 3, 1, 2, 2], // 16: 0
  [1, 2, 3, 2, 2, 1], // 17: 1
  [2, 2, 3, 2, 1, 1], // 18: 2
  [2, 2, 1, 1, 3, 2], // 19: 3
  [2, 2, 1, 2, 3, 1], // 20: 4
  [2, 1, 3, 2, 1, 2], // 21: 5
  [2, 2, 3, 1, 1, 2], // 22: 6
  [3, 1, 2, 1, 3, 1], // 23: 7
  [3, 1, 1, 2, 2, 2], // 24: 8
  [3, 2, 1, 1, 2, 2], // 25: 9
  [3, 2, 1, 2, 2, 1], // 26: :
  [3, 1, 2, 2, 1, 2], // 27: ;
  [3, 2, 2, 1, 1, 2], // 28: <
  [3, 2, 2, 2, 1, 1], // 29: =
  [2, 1, 2, 1, 2, 3], // 30: >
  [2, 1, 2, 3, 2, 1], // 31: ?
  [2, 3, 2, 1, 2, 1], // 32: @
  [1, 1, 1, 3, 2, 3], // 33: A
  [1, 3, 1, 1, 2, 3], // 34: B
  [1, 3, 1, 3, 2, 1], // 35: C
  [1, 1, 2, 3, 1, 3], // 36: D
  [1, 3, 2, 1, 1, 3], // 37: E
  [1, 3, 2, 3, 1, 1], // 38: F
  [2, 1, 1, 3, 1, 3], // 39: G
  [2, 3, 1, 1, 1, 3], // 40: H
  [2, 3, 1, 3, 1, 1], // 41: I
  [1, 1, 2, 1, 3, 3], // 42: J
  [1, 1, 2, 3, 3, 1], // 43: K
  [1, 3, 2, 1, 3, 1], // 44: L
  [1, 1, 3, 1, 2, 3], // 45: M
  [1, 1, 3, 3, 2, 1], // 46: N
  [1, 3, 3, 1, 2, 1], // 47: O
  [3, 1, 3, 1, 2, 1], // 48: P
  [2, 1, 1, 3, 3, 1], // 49: Q
  [2, 3, 1, 1, 3, 1], // 50: R
  [2, 1, 3, 1, 1, 3], // 51: S
  [2, 1, 3, 3, 1, 1], // 52: T
  [2, 1, 3, 1, 3, 1], // 53: U
  [3, 1, 1, 1, 2, 3], // 54: V
  [3, 1, 1, 3, 2, 1], // 55: W
  [3, 3, 1, 1, 2, 1], // 56: X
  [3, 1, 2, 1, 1, 3], // 57: Y
  [3, 1, 2, 3, 1, 1], // 58: Z
  [3, 3, 2, 1, 1, 1], // 59: [
  [3, 1, 4, 1, 1, 1], // 60: \
  [2, 2, 1, 4, 1, 1], // 61: ]
  [4, 3, 1, 1, 1, 1], // 62: ^
  [1, 1, 1, 2, 2, 4], // 63: _
  [1, 1, 1, 4, 2, 2], // 64: `
  [1, 2, 1, 1, 2, 4], // 65: a
  [1, 2, 1, 4, 2, 1], // 66: b
  [1, 4, 1, 1, 2, 2], // 67: c
  [1, 4, 1, 2, 2, 1], // 68: d
  [1, 1, 2, 2, 1, 4], // 69: e
  [1, 1, 2, 4, 1, 2], // 70: f
  [1, 2, 2, 1, 1, 4], // 71: g
  [1, 2, 2, 4, 1, 1], // 72: h
  [1, 4, 2, 1, 1, 2], // 73: i
  [1, 4, 2, 2, 1, 1], // 74: j
  [2, 4, 1, 2, 1, 1], // 75: k
  [2, 2, 1, 1, 1, 4], // 76: l
  [4, 1, 3, 1, 1, 1], // 77: m
  [2, 4, 1, 1, 1, 2], // 78: n
  [1, 3, 4, 1, 1, 1], // 79: o
  [1, 1, 1, 2, 4, 2], // 80: p
  [1, 2, 1, 1, 4, 2], // 81: q
  [1, 2, 1, 2, 4, 1], // 82: r
  [1, 1, 4, 2, 1, 2], // 83: s
  [1, 2, 4, 1, 1, 2], // 84: t
  [1, 2, 4, 2, 1, 1], // 85: u
  [4, 1, 1, 2, 1, 2], // 86: v
  [4, 2, 1, 1, 1, 2], // 87: w
  [4, 2, 1, 2, 1, 1], // 88: x
  [2, 1, 2, 1, 4, 1], // 89: y
  [2, 1, 4, 1, 2, 1], // 90: z
  [4, 1, 2, 1, 2, 1], // 91: {
  [1, 1, 1, 1, 4, 3], // 92: |
  [1, 1, 1, 3, 4, 1], // 93: }
  [1, 3, 1, 1, 4, 1], // 94: ~
  [1, 1, 4, 1, 1, 3], // 95: DEL
  [1, 1, 4, 3, 1, 1], // 96: FNC 3
  [4, 1, 1, 1, 1, 3], // 97: FNC 2
  [4, 1, 1, 3, 1, 1], // 98: Shift
  [1, 1, 3, 1, 4, 1], // 99: Code C
  [1, 1, 4, 1, 3, 1], // 100: Code B
  [3, 1, 1, 1, 4, 1], // 101: FNC 4
  [4, 1, 1, 1, 3, 1], // 102: FNC 1
  [2, 1, 1, 4, 1, 2], // 103: Start A
  [2, 1, 1, 2, 1, 4], // 104: Start B
  [2, 1, 1, 2, 3, 2], // 105: Start C
  [2, 3, 3, 1, 1, 1, 2] // 106: Stop (7 values!)
];

// Helper to generate a valid SVG for Code-128
export function generateCode128SVG(code: string): string {
  let sum = 104; // Start B
  for (let i = 0; i < code.length; i++) {
    const val = code.charCodeAt(i) - 32;
    sum += val * (i + 1);
  }
  const checksum = sum % 103;

  const indices = [104];
  for (let i = 0; i < code.length; i++) {
    indices.push(code.charCodeAt(i) - 32);
  }
  indices.push(checksum);
  indices.push(106); // Stop

  let totalModules = 0;
  for (const idx of indices) {
    if (idx >= 0 && idx < CODE128_PATTERNS.length) {
      const pattern = CODE128_PATTERNS[idx];
      for (const w of pattern) {
        totalModules += w;
      }
    }
  }

  const margin = 10;
  const usableWidth = 280;
  const moduleWidth = usableWidth / (totalModules || 1);

  let html = `<svg viewBox="0 0 300 80" width="100%" height="80" xmlns="http://www.w3.org/2000/svg" style="background: white; display: block;">`;
  let currentX = margin;
  
  for (const idx of indices) {
    if (idx >= 0 && idx < CODE128_PATTERNS.length) {
      const pattern = CODE128_PATTERNS[idx];
      for (let pIdx = 0; pIdx < pattern.length; pIdx++) {
        const w = pattern[pIdx];
        const isBar = pIdx % 2 === 0;
        const width = w * moduleWidth;
        if (isBar) {
          html += `<rect x="${currentX}" y="5" width="${width}" height="70" fill="black" />`;
        }
        currentX += width;
      }
    }
  }
  
  html += `</svg>`;
  return html;
}

export interface RenderedBarcodeLabel {
  html: string;
  rawText: string;
  escposBytes: Uint8Array;
}

// Generate the barcode label simulation and esc/pos payload
export function generateSimulatedBarcodeLabel(
  barcode: string,
  productName: string,
  unitName: string,
  _config: PrinterConfig
): RenderedBarcodeLabel {
  const builder = new EscPosBuilder();
  builder.initialize()
    .alignCenter()
    .bold(true)
    .fontSize('large')
    .text(productName.toUpperCase())
    .lineFeed()
    .bold(false)
    .fontSize('normal')
    .text(unitName.toUpperCase())
    .lineFeed()
    .text('--------------------------------')
    .lineFeed()
    .barcode(barcode)
    .lineFeed(3)
    .cut();

  let txt = `================================\n`;
  txt += `PRODUCT: ${productName.toUpperCase()}\n`;
  txt += `UNIT:    ${unitName.toUpperCase()}\n`;
  txt += `BARCODE: ${barcode}\n`;
  txt += `================================\n`;

  const svgBarcode = generateCode128SVG(barcode);

  const labelHtml = `
    <div class="barcode-label-preview" style="width: 280px; background: #ffffff; color: #1a1a1a; padding: 20px 16px; box-shadow: 0 6px 20px rgba(0,0,0,0.15); border-radius: 8px; font-family: 'Courier New', Courier, monospace; margin: 0 auto; border: 1px solid #e2e8f0; box-sizing: border-box; text-align: center; position: relative;">
      <h3 style="margin: 4px 0 2px 0; font-size: 18px; font-weight: 900; color: #0f172a; word-wrap: break-word;">${productName.toUpperCase()}</h3>
      <div style="font-size: 12px; font-weight: bold; color: #64748b; margin-bottom: 12px; letter-spacing: 0.5px;">${unitName.toUpperCase()}</div>
      <div style="margin: 10px 0; display: flex; justify-content: center; align-items: center; border: 1px solid #f1f5f9; padding: 8px; border-radius: 4px; background: #ffffff;">
        ${svgBarcode}
      </div>
      <div style="font-size: 10px; font-weight: bold; letter-spacing: 2px; color: #0f172a; margin-top: 4px;">
        ${barcode}
      </div>
    </div>
  `;

  return {
    html: labelHtml,
    rawText: txt,
    escposBytes: builder.getBytes()
  };
}

function registerDisconnectListener() {
  const isNative = typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor.isNativePlatform();
  if (isNative && typeof (window as any).bluetoothSerial !== 'undefined' && typeof (window as any).bluetoothSerial.registerOnDisconnect === 'function') {
    (window as any).bluetoothSerial.registerOnDisconnect(
      () => {
        console.log('[PrinterService] Bluetooth disconnected natively (registerOnDisconnect)');
        printerStatus = 'Disconnected';
        stopConnectionPoller();
        window.dispatchEvent(new CustomEvent('printer-disconnected'));
      },
      (err: any) => {
        console.error('[PrinterService] Disconnect listener register error:', err);
      }
    );
  }
  // Always start the polling watcher as a safety net
  startConnectionPoller();
}

// Complete Printer Module implementation
export const bluetoothPrinter = {
  // Get status
  getPrinterStatus(): 'Connected' | 'Disconnected' | 'Connecting' {
    return printerStatus;
  },

  // Check connection
  isConnected(): boolean {
    return printerStatus === 'Connected';
  },

  // Scan available devices
  async scanDevices(): Promise<{ name: string; mac: string }[]> {
    const isNative = typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor.isNativePlatform();
    if (isNative && typeof (window as any).bluetoothSerial !== 'undefined') {
      return new Promise((resolve) => {
        const performList = () => {
          (window as any).bluetoothSerial.list(
            (devices: any[]) => {
              const mapped = devices.map((d: any) => ({
                name: d.name || 'Unknown Device',
                mac: d.address || d.id || ''
              }));
              resolve(mapped);
            },
            (err: any) => {
              console.error('[PrinterService] list paired devices failed, trying discovery:', err);
              // Fallback: discover unpaired devices
              (window as any).bluetoothSerial.discoverUnpaired(
                (unpaired: any[]) => {
                  const mapped = unpaired.map((d: any) => ({
                    name: d.name || 'Unknown Device',
                    mac: d.address || d.id || ''
                  }));
                  resolve(mapped);
                },
                () => resolve([])
              );
            }
          );
        };

        (window as any).bluetoothSerial.isEnabled(
          () => {
            performList();
          },
          () => {
            // Prompt user to enable Bluetooth
            (window as any).bluetoothSerial.enable(
              () => {
                // User enabled Bluetooth, wait a brief moment for adapter initialization and scan
                setTimeout(performList, 500);
              },
              (err: any) => {
                console.error('[PrinterService] Bluetooth activation request rejected:', err);
                resolve([]);
              }
            );
          }
        );
      });
    }

    // Web mockup list
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve([
          { name: "ATPOS H58BT", mac: "00:11:22:33:44:55" },
          { name: "MOCK-58MM-PRINTER", mac: "AA:BB:CC:DD:EE:FF" },
          { name: "DIRECT-PRINT-THERMAL", mac: "12:34:56:78:9A:BC" }
        ]);
      }, 1200);
    });
  },

  // Connect printer
  async connectPrinter(mac: string, name?: string): Promise<boolean> {
    printerStatus = 'Connecting';
    const isNative = typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor.isNativePlatform();
    if (isNative && typeof (window as any).bluetoothSerial !== 'undefined') {
      return new Promise((resolve) => {
        const performConnect = () => {
          // Disconnect first just to clear any stale state
          (window as any).bluetoothSerial.disconnect(() => {}, () => {});

          (window as any).bluetoothSerial.connect(
            mac,
            () => {
              printerStatus = 'Connected';
              db.setSetting('printer_name', name || 'Thermal Printer');
              db.setSetting('printer_mac', mac);
              console.log('[PrinterService] Native Bluetooth connected to', mac);
              registerDisconnectListener();
              resolve(true);
            },
            (err: any) => {
              console.error('[PrinterService] Native Bluetooth connection failed:', err);
              printerStatus = 'Disconnected';
              resolve(false);
            }
          );
        };

        (window as any).bluetoothSerial.isEnabled(
          () => {
            performConnect();
          },
          () => {
            // Prompt user to enable Bluetooth
            (window as any).bluetoothSerial.enable(
              () => {
                setTimeout(performConnect, 500);
              },
              (err: any) => {
                console.error('[PrinterService] Bluetooth connection aborted: Bluetooth off', err);
                printerStatus = 'Disconnected';
                resolve(false);
              }
            );
          }
        );
      });
    }

    // Web fallback
    return new Promise((resolve) => {
      setTimeout(() => {
        if (mac) {
          printerStatus = 'Connected';
          db.setSetting('printer_name', name || 'Thermal Printer');
          db.setSetting('printer_mac', mac);
          resolve(true);
        } else {
          printerStatus = 'Disconnected';
          resolve(false);
        }
      }, 1000);
    });
  },

  // Disconnect printer
  async disconnectPrinter(): Promise<boolean> {
    stopConnectionPoller();
    const isNative = typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor.isNativePlatform();
    if (isNative && typeof (window as any).bluetoothSerial !== 'undefined') {
      return new Promise((resolve) => {
        (window as any).bluetoothSerial.disconnect(
          () => {
            printerStatus = 'Disconnected';
            db.setSetting('printer_name', '');
            db.setSetting('printer_mac', '');
            resolve(true);
          },
          () => {
            printerStatus = 'Disconnected';
            resolve(true);
          }
        );
      });
    }

    printerStatus = 'Disconnected';
    db.setSetting('printer_name', '');
    db.setSetting('printer_mac', '');
    return Promise.resolve(true);
  },

  // Reconnect printer
  async reconnectPrinter(mac: string, name?: string): Promise<boolean> {
    if (!mac) {
      printerStatus = 'Disconnected';
      return false;
    }
    const isNative = typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor.isNativePlatform();
    if (isNative && typeof (window as any).bluetoothSerial !== 'undefined') {
      const alreadyConnected = await new Promise<boolean>((resolve) => {
        (window as any).bluetoothSerial.isConnected(
          () => resolve(true),
          () => resolve(false)
        );
      });
      if (alreadyConnected) {
        printerStatus = 'Connected';
        registerDisconnectListener();
        return true;
      }
    }
    return this.connectPrinter(mac, name);
  },

  // Main printing method
  async printReceipt(bill: Bill, config: PrinterConfig): Promise<boolean> {
    const isNative = typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor.isNativePlatform();
    const receipt = generateSimulatedReceipt(bill, config);

    console.log(`Sending ESC/POS commands (${receipt.escposBytes.length} bytes) to ATPOS H58BT (MAC: ${config.printer_mac})`);

    if (isNative && typeof (window as any).bluetoothSerial !== 'undefined') {
      // Double check connection status
      const connected = await new Promise<boolean>((resolve) => {
        (window as any).bluetoothSerial.isConnected(
          () => resolve(true),
          () => resolve(false)
        );
      });

      if (!connected) {
        console.warn("[PrinterService] Printer is disconnected. Trying to reconnect...");
        const ok = await this.reconnectPrinter(config.printer_mac, config.printer_name);
        if (!ok) {
          console.error("[PrinterService] Reconnect failed. Cannot print.");
          return false;
        }
      }

      return new Promise((resolve) => {
        (window as any).bluetoothSerial.write(
          receipt.escposBytes,
          () => {
            console.log('[PrinterService] Successfully sent ESC/POS bytes to bluetooth serial');
            resolve(true);
          },
          (err: any) => {
            console.error('[PrinterService] Write to bluetooth serial failed:', err);
            resolve(false);
          }
        );
      });
    }

    // Web simulation print text
    console.log('[PrinterService] Web simulation output:\n', receipt.rawText);
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(true);
      }, 1200);
    });
  },

  // Test Print
  async testPrint(config: PrinterConfig): Promise<boolean> {
    const mockBill: Bill = {
      id: 9999,
      bill_id: 'BILL_TEST_9999',
      bill_number: 9999,
      customer_name: 'TEST CUSTOMER',
      customer_phone: '9876543210',
      subtotal: 100,
      discount: 10,
      grand_total: 90,
      payment_mode: 'UPI',
      status: 'Completed',
      print_status: 'PRINT_PENDING',
      created_at: new Date().toISOString(),
      items: [
        { product_id: 99, product_name: 'Test Print Success', quantity: 1, unit: 'Piece', price: 100, total: 100 }
      ]
    };
    return this.printReceipt(mockBill, config);
  },

  // Print Barcode Label
  async printBarcodeLabel(
    barcode: string,
    productName: string,
    unitName: string,
    config: PrinterConfig
  ): Promise<boolean> {
    const isNative = typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor.isNativePlatform();
    const label = generateSimulatedBarcodeLabel(barcode, productName, unitName, config);

    console.log(`Sending ESC/POS barcode label commands (${label.escposBytes.length} bytes) to ATPOS H58BT (MAC: ${config.printer_mac})`);

    if (isNative && typeof (window as any).bluetoothSerial !== 'undefined') {
      const connected = await new Promise<boolean>((resolve) => {
        (window as any).bluetoothSerial.isConnected(
          () => resolve(true),
          () => resolve(false)
        );
      });

      if (!connected) {
        console.warn("[PrinterService] Printer is disconnected. Trying to reconnect...");
        const ok = await this.reconnectPrinter(config.printer_mac, config.printer_name);
        if (!ok) {
          console.error("[PrinterService] Reconnect failed. Cannot print.");
          return false;
        }
      }

      return new Promise((resolve) => {
        (window as any).bluetoothSerial.write(
          label.escposBytes,
          () => {
            console.log('[PrinterService] Successfully sent ESC/POS label bytes to bluetooth serial');
            resolve(true);
          },
          (err: any) => {
            console.error('[PrinterService] Write to bluetooth serial failed:', err);
            resolve(false);
          }
        );
      });
    }

    // Web simulation print text
    console.log('[PrinterService] Web simulation label output:\n', label.rawText);
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(true);
      }, 1000);
    });
  }
};

// Deprecated old top-level printReceipt function - maintained for backward compatibility inside App.tsx Reprint
export async function printReceipt(bill: Bill, config: PrinterConfig): Promise<boolean> {
  // If printer status is disconnected, we simulate auto-reconnecting or prompt
  if (bluetoothPrinter.getPrinterStatus() !== 'Connected') {
    // Attempt auto-connect
    if (config.printer_mac) {
      const ok = await bluetoothPrinter.connectPrinter(config.printer_mac, config.printer_name);
      if (!ok) return false;
    } else {
      return false;
    }
  }
  return bluetoothPrinter.printReceipt(bill, config);
}
