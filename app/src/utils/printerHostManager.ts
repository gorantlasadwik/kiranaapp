/**
 * Printer Host Manager
 * ====================
 * Implements the multi-device Bluetooth printing architecture for Sai Ram Kirana POS.
 *
 * Roles:
 *   - PRINTER HOST: The device that is physically connected to the Bluetooth thermal printer.
 *   - NON-HOST:     Any other device. Submits print_jobs to Supabase; host processes them.
 *
 * Key Rules (from PRD):
 *   Rule 1: Bill is ALWAYS saved before printing.
 *   Rule 2: Bills are never lost — print failure ≠ bill loss.
 *   Rule 3: Only check current_printer_host; never scan all devices.
 *   Rule 4: Every print job must return a status.
 */

import { db } from '../db';
import type { PrintJob, PrintJobStatus, Bill } from '../db';
import { bluetoothPrinter } from './printerService';
import type { PrinterConfig } from './printerService';

export const PRINTER_HOST_STALE_AFTER_MS = 15_000;
export const PRINT_JOB_ACK_TIMEOUT_MS = 2_000;
export const PRINT_JOB_TOTAL_TIMEOUT_MS = 17_000;

export interface PrinterHostAvailability {
  hostId: string;
  connected: boolean;
  lastSeen: string;
  lastSeenAgeMs: number | null;
  isAvailable: boolean;
}

// ─── HOST CLAIM / RELEASE ────────────────────────────────────────────────────

/**
 * Called when THIS device successfully connects to the Bluetooth printer.
 * Claims the printer host role in Supabase settings so all other devices know.
 */
export async function claimPrinterHost(deviceId: string, mac: string): Promise<void> {
  if (!deviceId) return;
  const now = new Date().toISOString();
  db.setSetting('current_printer_host', deviceId);
  db.setSetting('printer_host_connected', 'true');
  db.setSetting('printer_host_last_seen', now);
  console.log(`[PrinterHost] Device ${deviceId} claimed printer host (MAC: ${mac})`);
}

/**
 * Called when THIS device disconnects from the Bluetooth printer.
 * Clears the host in Supabase only if this device was the current host.
 */
export async function releasePrinterHost(deviceId: string): Promise<void> {
  if (!deviceId) return;
  const current = db.getSetting('current_printer_host');
  if (current === deviceId) {
    db.setSetting('current_printer_host', '');
    db.setSetting('printer_host_connected', 'false');
    db.setSetting('printer_host_last_seen', '');
    console.log(`[PrinterHost] Device ${deviceId} released printer host`);
  }
}

// ─── HOST IDENTITY ───────────────────────────────────────────────────────────

/** Returns the device_id of the current printer host (empty string if none). */
export function getCurrentHost(): string {
  return db.getSetting('current_printer_host', '');
}

/** Returns true if THIS device is the printer host. */
export function isThisDeviceHost(): boolean {
  const myId = getMyDeviceId();
  const host  = getCurrentHost();
  return !!(myId && host && myId === host);
}

/** Returns this device's unique ID, auto-generating one if not set. */
export function getMyDeviceId(): string {
  let id = db.getSetting('device_id', '');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
    db.setSetting('device_id', id);
    console.log(`[PrinterHost] Generated new device_id: ${id}`);
  }
  return id;
}

function buildPrinterHostAvailability(hostId: string, connectedStr: string, lastSeen: string): PrinterHostAvailability {
  let lastSeenAgeMs: number | null = null;
  if (lastSeen) {
    const lastSeenTime = new Date(lastSeen).getTime();
    if (!Number.isNaN(lastSeenTime)) {
      lastSeenAgeMs = Date.now() - lastSeenTime;
    }
  }

  const connected = connectedStr === 'true';
  const fresh = lastSeenAgeMs !== null && lastSeenAgeMs >= 0 && lastSeenAgeMs < PRINTER_HOST_STALE_AFTER_MS;

  return {
    hostId,
    connected,
    lastSeen,
    lastSeenAgeMs,
    isAvailable: !!hostId && connected && fresh,
  };
}

export function getLocalPrinterHostAvailability(): PrinterHostAvailability {
  return buildPrinterHostAvailability(
    db.getSetting('current_printer_host', ''),
    db.getSetting('printer_host_connected', 'false'),
    db.getSetting('printer_host_last_seen', '')
  );
}

export async function getPrinterHostAvailability(remoteTimeoutMs = 350): Promise<PrinterHostAvailability> {
  let availability = getLocalPrinterHostAvailability();

  if (!db.supabase || !navigator.onLine) {
    return availability;
  }

  try {
    const fetchPromise = db.supabase
      .from('settings')
      .select('key, value')
      .in('key', ['current_printer_host', 'printer_host_connected', 'printer_host_last_seen']);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('PRINTER_HOST_CHECK_TIMEOUT')), remoteTimeoutMs);
    });

    const res = await Promise.race([fetchPromise, timeoutPromise]) as any;
    if (res?.data) {
      const settingsMap = new Map<string, string>();
      res.data.forEach((row: any) => settingsMap.set(row.key, row.value));

      const hostId = settingsMap.get('current_printer_host') || '';
      const connectedStr = settingsMap.get('printer_host_connected') || 'false';
      const lastSeen = settingsMap.get('printer_host_last_seen') || '';

      db.setSetting('current_printer_host', hostId);
      db.setSetting('printer_host_connected', connectedStr);
      db.setSetting('printer_host_last_seen', lastSeen);

      availability = buildPrinterHostAvailability(hostId, connectedStr, lastSeen);
    }
  } catch (e) {
    console.warn('[PrinterHost] Fast host check used local settings:', e);
  }

  return availability;
}

// ─── NON-HOST: SUBMIT PRINT JOB ──────────────────────────────────────────────

/**
 * Called by a non-host device after saving the bill.
 * Creates a print_job row in Supabase with status = PENDING.
 * Returns the created job (including local id for polling).
 */
export async function submitPrintJob(bill: Bill): Promise<PrintJob> {
  const myDeviceId = getMyDeviceId();
  const hostAvailability = getLocalPrinterHostAvailability();

  if (!hostAvailability.isAvailable) {
    throw new Error('NO_PRINTER_CONNECTED');
  }

  const job = await db.createPrintJob({
    bill_id: bill.bill_id,
    device_id: myDeviceId,
    host_device_id: hostAvailability.hostId,
    status: 'PENDING',
  });

  console.log(`[PrinterHost] Submitted print job #${job.id} for bill ${bill.bill_id} → host: ${hostAvailability.hostId}`);
  return job;
}

// ─── NON-HOST: WAIT FOR PRINT RESULT ─────────────────────────────────────────

/**
 * Polls locally every 1.5s for the print job result.
 * The underlying data is refreshed by the sync engine every 20s,
 * but we also trigger an immediate sync right after submitting the job
 * so the host picks it up faster.
 *
 * Returns the final status once it settles (not PENDING/PRINTING).
 * Returns 'PRINT_FAILED' on timeout.
 */
export async function waitForPrintJobResult(
  jobId: number,
  timeoutMs = PRINT_JOB_ACK_TIMEOUT_MS
): Promise<PrintJobStatus> {
  const start = Date.now();

  return new Promise(resolve => {
    const interval = setInterval(() => {
      const jobs = db.getPrintJobs();
      const job = jobs.find(j => j.id === jobId);

      if (!job) {
        clearInterval(interval);
        resolve('PRINT_FAILED');
        return;
      }

      const elapsed = Date.now() - start;
      const settled = job.status !== 'PENDING' && job.status !== 'PRINTING';

      if (settled) {
        clearInterval(interval);
        resolve(job.status);
        return;
      }

      if (elapsed >= timeoutMs) {
        clearInterval(interval);
        console.warn(`[PrinterHost] waitForPrintJobResult timed out for job #${jobId}`);
        // Mark it failed locally so UX doesn't hang
        db.updatePrintJobStatus(jobId, 'PRINT_FAILED', 'Timed out waiting for host response');
        resolve('PRINT_FAILED');
      }
    }, 1500);
  });
}

// ─── HOST: PROCESS PENDING JOBS ──────────────────────────────────────────────

/**
 * Called on the host device (by syncEngine) after every sync cycle.
 * Fetches all PENDING jobs assigned to this host and processes them.
 *
 * Flow per job:
 *   1. Mark job PRINTING immediately (this is the host ACK)
 *   2. Generate ESC/POS receipt from bill data
 *   3. Send to bluetoothSerial
 *   4. On success → PRINT_SUCCESS
 *   5. On fail → try reconnect → if still fail → PRINT_FAILED
 */
export async function processHostPrintJobs(printerConfig: PrinterConfig): Promise<void> {
  if (!isThisDeviceHost()) return;

  const myId = getMyDeviceId();
  const pendingJobs = db.getPendingJobsForHost(myId);

  if (!pendingJobs.length) return;

  console.log(`[PrinterHost] Processing ${pendingJobs.length} pending print job(s)...`);

  for (const job of pendingJobs) {
    if (!job.id) continue;

    // Mark as PRINTING immediately so other instances don't double-process
    await db.updatePrintJobStatus(job.id, 'PRINTING');

    try {
      // Reconstruct the bill from local storage or remote for printing
      const bills = db.getRawList<any>('sr_bills');
      let bill = bills.find((b: any) => b.bill_id === job.bill_id);

      if (!bill && db.supabase) {
        console.log(`[PrinterHost] Bill ${job.bill_id} not found locally. Fetching from Supabase...`);
        const { data: billData, error: billErr } = await db.supabase
          .from('bills')
          .select('*, customers(*), bill_items(*)')
          .eq('bill_id', job.bill_id)
          .single();
        
        if (!billErr && billData) {
          bill = {
            id: billData.id,
            bill_id: billData.bill_id,
            bill_number: billData.bill_number,
            customer_id: billData.customer_id,
            customer_name: billData.customers?.name || 'Customer',
            customer_phone: billData.customers?.phone || 'NA',
            subtotal: parseFloat(billData.subtotal),
            discount: parseFloat(billData.discount),
            grand_total: parseFloat(billData.grand_total),
            payment_mode: billData.payment_mode,
            status: billData.status,
            print_status: billData.print_status,
            created_at: billData.created_at,
            items: (billData.bill_items || []).map((i: any) => ({
              id: i.id,
              bill_id: i.bill_id,
              product_id: i.product_id,
              product_name: i.product_name,
              quantity: parseFloat(i.quantity),
              unit: i.unit,
              price: parseFloat(i.price),
              total: parseFloat(i.total)
            }))
          };
          // Cache the bill locally so we have it in history too
          const localBills = db.getRawList<any>('sr_bills');
          if (!localBills.some(b => b.bill_id === bill.bill_id)) {
            localBills.push(bill);
            db.saveList('sr_bills', localBills);
          }
        }
      }

      if (!bill) {
        console.error(`[PrinterHost] Bill ${job.bill_id} not found for job #${job.id}`);
        await db.updatePrintJobStatus(job.id, 'PRINT_FAILED', 'Bill data not found on this device');
        continue;
      }
      const isConnected = bluetoothPrinter.isConnected();
      if (!isConnected) {
        console.warn(`[PrinterHost] Printer disconnected. Attempting reconnect for job #${job.id}...`);
        const reconnected = await bluetoothPrinter.reconnectPrinter(
          printerConfig.printer_mac,
          printerConfig.printer_name
        );
        if (!reconnected) {
          console.error(`[PrinterHost] Reconnect failed for job #${job.id}`);
          await db.updatePrintJobStatus(job.id, 'PRINT_FAILED', 'Printer disconnected and reconnect failed');
          // Release host since we're no longer connected
          await releasePrinterHost(myId);
          continue;
        }
      }

      // Attempt the actual print
      const success = await bluetoothPrinter.printReceipt(bill as Bill, printerConfig);

      if (success) {
        await db.updatePrintJobStatus(job.id, 'PRINT_SUCCESS');
        console.log(`[PrinterHost] Job #${job.id} printed successfully (bill: ${job.bill_id})`);
      } else {
        await db.updatePrintJobStatus(job.id, 'PRINT_FAILED', 'Printer write failed');
        console.error(`[PrinterHost] Job #${job.id} print failed (bill: ${job.bill_id})`);
      }
    } catch (err: any) {
      console.error(`[PrinterHost] Unexpected error processing job #${job.id}:`, err);
      await db.updatePrintJobStatus(job.id, 'PRINT_FAILED', err?.message || 'Unknown error');
    }
  }
}

// ─── HOST: DIRECT PRINT (this device is the host) ───────────────────────────

/**
 * Host-path: this device is connected to the printer, so print directly.
 * Returns the final PrintJobStatus ('PRINT_SUCCESS' or 'PRINT_FAILED').
 * Also creates a print_job record for audit trail.
 */
export async function printDirectAsHost(bill: Bill, printerConfig: PrinterConfig): Promise<PrintJobStatus> {
  const myId = getMyDeviceId();

  // Create a job record for audit even for the host path
  const job = await db.createPrintJob({
    bill_id: bill.bill_id,
    device_id: myId,
    host_device_id: myId,
    status: 'PRINTING',
  });

  if (!job.id) return 'PRINT_FAILED';

  try {
    const isConnected = bluetoothPrinter.isConnected();
    if (!isConnected) {
      const ok = await bluetoothPrinter.reconnectPrinter(
        printerConfig.printer_mac,
        printerConfig.printer_name
      );
      if (!ok) {
        await db.updatePrintJobStatus(job.id, 'PRINT_FAILED', 'Printer offline');
        return 'PRINT_FAILED';
      }
    }

    const success = await bluetoothPrinter.printReceipt(bill, printerConfig);
    const finalStatus: PrintJobStatus = success ? 'PRINT_SUCCESS' : 'PRINT_FAILED';
    await db.updatePrintJobStatus(job.id, finalStatus, success ? undefined : 'Printer write failed');
    return finalStatus;
  } catch (err: any) {
    await db.updatePrintJobStatus(job.id, 'PRINT_FAILED', err?.message || 'Unknown error');
    return 'PRINT_FAILED';
  }
}
