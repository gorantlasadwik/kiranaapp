import { jsPDF } from 'jspdf';
import type { Bill } from '../db';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';

// Helper to format Date nicely
function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getFullYear()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Generates a PDF blob of a Bill receipt.
 */
export function generateBillPDF(bill: Bill, storeName: string): Blob {
  const logoImg = document.getElementById('bill-logo-element') as HTMLImageElement | null;
  const hasLogo = logoImg && logoImg.complete && logoImg.naturalWidth > 0;
  const yShift = hasLogo ? 14 : 0;

  const doc = new jsPDF({
    unit: 'mm',
    format: [80, 150 + yShift + (bill.items.length * 10)] // standard 80mm thermal roll format scaled by items
  });

  doc.setFont('Helvetica', 'normal');

  // Draw Logo if available
  if (hasLogo && logoImg) {
    try {
      doc.addImage(logoImg, 'PNG', 34, 4, 12, 12);
    } catch (e) {
      console.error('Failed to add logo to PDF:', e);
    }
  }

  // Title
  doc.setFontSize(14);
  doc.setFont('Helvetica', 'bold');
  doc.text(storeName.toUpperCase(), 40, 12 + yShift, { align: 'center' });
  
  doc.setFontSize(9);
  doc.setFont('Helvetica', 'normal');
  doc.text("INVOICE / RECEIPT", 40, 17 + yShift, { align: 'center' });
  
  doc.line(5, 20 + yShift, 75, 20 + yShift);

  // Metadata
  doc.setFontSize(8);
  doc.text(`Bill No: #${bill.bill_number}`, 6, 25 + yShift);
  doc.text(`Date: ${formatDate(bill.created_at)}`, 6, 29 + yShift);
  doc.text(`Cust: ${bill.customer_name || 'Guest'} (${bill.customer_phone || 'NA'})`, 6, 33 + yShift);
  doc.text(`Mode: ${bill.payment_mode}`, 6, 37 + yShift);

  doc.line(5, 40 + yShift, 75, 40 + yShift);

  // Items Header
  doc.setFont('Helvetica', 'bold');
  doc.text("Item", 6, 44 + yShift);
  doc.text("Qty/Unit", 38, 44 + yShift);
  doc.text("Price", 54, 44 + yShift);
  doc.text("Total", 74, 44 + yShift, { align: 'right' });
  doc.setFont('Helvetica', 'normal');

  doc.line(5, 46 + yShift, 75, 46 + yShift);

  let y = 51 + yShift;
  bill.items.forEach(item => {
    // Wrap product name if too long
    const name = item.product_name.length > 18 
      ? item.product_name.substring(0, 16) + '..' 
      : item.product_name;

    doc.text(name, 6, y);
    doc.text(`${item.quantity} ${item.unit}`, 38, y);
    doc.text(`₹${item.price.toFixed(0)}`, 54, y);
    doc.text(`₹${item.total.toFixed(0)}`, 74, y, { align: 'right' });
    y += 6;
  });

  doc.line(5, y - 2, 75, y - 2);

  // Totals
  y += 3;
  doc.text("Subtotal:", 38, y);
  doc.text(`₹${bill.subtotal.toFixed(2)}`, 74, y, { align: 'right' });
  
  if (bill.discount > 0) {
    y += 5;
    doc.text("Discount:", 38, y);
    doc.text(`-₹${bill.discount.toFixed(2)}`, 74, y, { align: 'right' });
  }

  y += 5;
  doc.setFont('Helvetica', 'bold');
  doc.text("Grand Total:", 38, y);
  doc.text(`₹${bill.grand_total.toFixed(2)}`, 74, y, { align: 'right' });
  doc.setFont('Helvetica', 'normal');

  doc.line(5, y + 3, 75, y + 3);

  // Footer
  y += 8;
  doc.setFontSize(8);
  doc.text("Thank you for shopping with us!", 40, y, { align: 'center' });
  y += 4;
  doc.text("Please visit again!", 40, y, { align: 'center' });

  return doc.output('blob');
}

/**
 * Generates a PDF statement of a Customer's Khata account.
 */
export function generateKhataPDF(
  customerName: string, 
  customerPhone: string, 
  balance: number, 
  transactions: any[], 
  storeName: string
): Blob {
  const doc = new jsPDF();

  doc.setFont('Helvetica', 'normal');

  // Title / Header
  doc.setFontSize(18);
  doc.setFont('Helvetica', 'bold');
  doc.text(storeName.toUpperCase(), 14, 20);
  
  doc.setFontSize(12);
  doc.setFont('Helvetica', 'normal');
  doc.text("KHATA ACCOUNT LEDGER STATEMENT", 14, 26);

  // Draw Logo if available
  const logoImg = document.getElementById('bill-logo-element') as HTMLImageElement | null;
  if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
    try {
      doc.addImage(logoImg, 'PNG', 176, 8, 20, 20);
    } catch (e) {
      console.error('Failed to add logo to Khata PDF:', e);
    }
  }
  
  doc.line(14, 30, 196, 30);

  // Customer Summary Card
  doc.setFontSize(10);
  doc.text(`Customer Name: ${customerName}`, 14, 38);
  doc.text(`Phone Number: ${customerPhone}`, 14, 43);
  doc.text(`Statement Date: ${new Date().toLocaleDateString()}`, 14, 48);

  // Balance section
  doc.setFont('Helvetica', 'bold');
  doc.text(`Outstanding Balance: Rs. ${balance.toFixed(2)}`, 130, 38);
  doc.setFont('Helvetica', 'normal');

  doc.line(14, 52, 196, 52);

  // Transactions list
  doc.setFontSize(11);
  doc.setFont('Helvetica', 'bold');
  doc.text("Date", 16, 58);
  doc.text("Type", 50, 58);
  doc.text("Description", 80, 58);
  doc.text("Amount (Rs.)", 194, 58, { align: 'right' });
  doc.setFont('Helvetica', 'normal');

  doc.line(14, 60, 196, 60);

  let y = 66;
  doc.setFontSize(9);
  
  transactions.forEach(tx => {
    // Check page boundaries (297mm height)
    if (y > 270) {
      doc.addPage();
      y = 20;
      doc.setFontSize(11);
      doc.setFont('Helvetica', 'bold');
      doc.text("Date", 16, y);
      doc.text("Type", 50, y);
      doc.text("Description", 80, y);
      doc.text("Amount (Rs.)", 194, y, { align: 'right' });
      doc.setFont('Helvetica', 'normal');
      doc.line(14, y + 2, 196, y + 2);
      y += 8;
      doc.setFontSize(9);
    }

    const txDate = new Date(tx.created_at).toLocaleDateString();
    doc.text(txDate, 16, y);
    doc.text(tx.transaction_type, 50, y);
    
    const desc = tx.description.length > 45 
      ? tx.description.substring(0, 42) + '...' 
      : tx.description;
    doc.text(desc, 80, y);
    
    // Payments are represented negatively, format nicely
    const amt = Math.abs(tx.amount).toFixed(2);
    const sign = tx.amount < 0 ? '-' : '';
    doc.text(`${sign}${amt}`, 194, y, { align: 'right' });
    
    y += 6;
  });

  doc.line(14, y - 2, 196, y - 2);

  // Footer notice
  y += 10;
  doc.setFontSize(10);
  doc.setFont('Helvetica', 'bold');
  doc.text(`Total Outstanding Due: Rs. ${balance.toFixed(2)}`, 14, y);
  
  y += 10;
  doc.setFontSize(9);
  doc.setFont('Helvetica', 'normal');
  doc.text("Please settle the outstanding balance at your earliest convenience.", 14, y);
  y += 5;
  doc.text("You can pay via cash or UPI to sariramkirana@sbi.", 14, y);

  return doc.output('blob');
}

// Helper to convert Blob to Base64
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Opens WhatsApp with a prefilled message. Triggers a direct PDF download as a fallback,
 * or shares the file directly if Web Share or Capacitor native sharing is supported.
 */
export async function shareViaWhatsApp(
  phone: string, 
  messageText: string, 
  pdfBlobOrBlobs?: Blob | Blob[], 
  pdfFileNameOrNames?: string | string[]
) {
  // Format phone number
  let cleanPhone = phone.trim().replace(/[^0-9]/g, '');
  if (cleanPhone && cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone; // India country code default
  }

  const blobs = pdfBlobOrBlobs ? (Array.isArray(pdfBlobOrBlobs) ? pdfBlobOrBlobs : [pdfBlobOrBlobs]) : [];
  const fileNames = pdfFileNameOrNames ? (Array.isArray(pdfFileNameOrNames) ? pdfFileNameOrNames : [pdfFileNameOrNames]) : [];

  // 1. Try Capacitor Native Share if running on mobile
  if (Capacitor.isNativePlatform() && blobs.length > 0) {
    try {
      const fileUris: string[] = [];
      for (let i = 0; i < blobs.length; i++) {
        const blob = blobs[i];
        // Sanitize filename: replace spaces and special chars with underscores
        const rawName = fileNames[i] || `document_${i + 1}.pdf`;
        const safeFileName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const base64Data = await blobToBase64(blob);
        
        // Write to Cache directory
        await Filesystem.writeFile({
          path: safeFileName,
          data: base64Data,
          directory: Directory.Cache
        });
        
        // Get local file:// URI
        const uriResult = await Filesystem.getUri({
          directory: Directory.Cache,
          path: safeFileName
        });
        fileUris.push(uriResult.uri);
      }
      
      // Share native sheet (which lets user choose WhatsApp directly with file attached)
      await Share.share({
        title: fileNames[0] || 'Receipt Statement',
        text: messageText,
        url: fileUris[0], 
        dialogTitle: 'Share via'
      });
      return; // successfully shared natively!
    } catch (err) {
      console.error("Capacitor native share failed, falling back to web flow:", err);
    }
  }

  // 2. Try Web Share API (native share on desktop browser supporting it)
  if (blobs.length > 0 && navigator.share && navigator.canShare) {
    const files = blobs.map((blob, idx) => new File([blob], fileNames[idx] || `document_${idx + 1}.pdf`, { type: 'application/pdf' }));
    if (navigator.canShare({ files })) {
      try {
        await navigator.share({
          files,
          title: fileNames[0] || 'Receipt Statement',
          text: messageText
        });
        return; // successfully shared!
      } catch (err) {
        console.warn("Web Share failed, falling back to download + message link:", err);
      }
    }
  }

  // 3. Fallback: Browser download PDF(s)
  blobs.forEach((blob, idx) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileNames[idx] || `document_${idx + 1}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  // 4. Fallback: Open WhatsApp link with prefilled text summary
  const encodedText = encodeURIComponent(messageText);
  const url = cleanPhone
    ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`
    : `https://api.whatsapp.com/send?text=${encodedText}`;
  window.open(url, '_blank');
}
