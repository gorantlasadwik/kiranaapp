// ============================================================
// Sai Ram Kirana POS — Background Sync Engine
// Bidirectional offline-first sync: LocalStorage ↔ Supabase
//
// Triggers:
//   • App startup (after 2s delay for local read to settle)
//   • Every 5 minutes (auto polling)
//   • After every bill save (called from store.ts)
//   • Manual trigger from settings page
//
// Sync Order:
//   1. Pull remote changes since last_sync_at (cloud → local)
//   2. Push local sync_queue items to cloud (local → cloud)
//   3. Update last_sync_at
//   4. Trigger daily backup (if not done today)
// ============================================================

import { db } from './db';
import type { SyncItem } from './db';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { processHostPrintJobs, isThisDeviceHost } from './utils/printerHostManager';
import { bluetoothPrinter } from './utils/printerService';

const MAX_RETRIES = 5;

class SyncEngine {
  private supabase: SupabaseClient | null = null;
  private isSyncing: boolean = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
  private realtimeChannel: any = null;
  private uiRefreshTimeout: any = null;
  private visibilityListener: (() => void) | null = null;
  private debounceTimeout: any = null;           // ← debounce for rapid calls
  private lastRealtimeEventAt: number = 0;       // ← tracks last realtime event time

  constructor() {
    this.initSupabase();
    db.onQueueItemAdded = () => {
      this.triggerSync(false).catch((err) => {
        console.error('[SyncEngine] Trigger sync from callback failed:', err);
      });
    };
  }

  // ─── SUPABASE CLIENT (credentials from .env ONLY) ──────
  //     Uses the same VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
  //     as db.ts — no localStorage reads for credentials.

  private initSupabase() {
    const url     = (import.meta as any).env?.VITE_SUPABASE_URL      || '';
    const anonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';
    if (url && anonKey) {
      this.supabase = createClient(url, anonKey);
    } else {
      this.supabase = null;
    }
  }

  reloadClient() {
    this.initSupabase();
    // Restart subscription with new client credentials
    if (this.intervalId) {
      this.setupRealtimeSubscription();
    }
  }

  isOnline(): boolean {
    return navigator.onLine;
  }

  isConfigured(): boolean {
    return this.supabase !== null;
  }

  // ─── START / STOP ────────────────────────────────────────

  start() {
    if (this.intervalId) return;

    // ── Safety-net polling: every 5 minutes ─────────────────────────────
    // Realtime subscription handles all instant bidirectional changes.
    // This poll only catches edge cases where realtime drops (e.g. reconnect)
    // or the queue has pending items that haven't pushed yet.
    this.intervalId = setInterval(() => {
      const pendingCount = db.getSyncQueue()
        .filter(q => q.status === 'pending' || q.status === 'failed').length;
      const realtimeHealthy = (Date.now() - this.lastRealtimeEventAt) < 5 * 60 * 1000;

      if (pendingCount > 0) {
        // Always sync if we have pending local changes to push
        console.log(`[SyncEngine] Safety poll: ${pendingCount} pending items — triggering sync.`);
        this.triggerSync();
      } else if (!realtimeHealthy) {
        // Realtime may have dropped — do a delta pull to catch up
        console.log('[SyncEngine] Safety poll: realtime inactive, doing delta pull.');
        this.triggerSync();
      } else {
        console.log('[SyncEngine] Safety poll: realtime healthy, queue empty — skipping.');
      }
    }, 5 * 60 * 1000); // 5 minutes

    // Heartbeat timer every 8 seconds
    this.heartbeatIntervalId = setInterval(() => {
      this.sendHeartbeat();
    }, 8 * 1000);

    this.setupRealtimeSubscription();

    // Listen for app visibility changes (resume from background)
    if (typeof window !== 'undefined') {
      this.visibilityListener = () => {
        if (document.visibilityState === 'visible') {
          console.log('[SyncEngine] App resumed (foreground). Checking sync...');
          const lastSyncStr = db.getSetting('last_sync_at');
          const lastSync = lastSyncStr ? new Date(lastSyncStr).getTime() : 0;
          const now = Date.now();
          if (now - lastSync > 60 * 1000) {
            console.log('[SyncEngine] Last sync was > 1m ago. Triggering sync...');
            this.triggerSync();
          }
        }
      };
      window.addEventListener('visibilitychange', this.visibilityListener);
    }

    // First sync after 3 seconds (let app boot settle)
    setTimeout(() => this.triggerSync(), 3000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
    if (this.realtimeChannel) {
      this.realtimeChannel.unsubscribe();
      this.realtimeChannel = null;
    }
    if (this.visibilityListener && typeof window !== 'undefined') {
      window.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
  }

  async sendHeartbeat() {
    if (!isThisDeviceHost() || !this.supabase) return;
    try {
      const now = new Date().toISOString();
      const isConnected = bluetoothPrinter.isConnected();
      
      db.setSetting('printer_host_last_seen', now);
      db.setSetting('printer_host_connected', isConnected ? 'true' : 'false');
      
      console.log(`[SyncEngine] Heartbeat sent: connected=${isConnected}, last_seen=${now}`);
    } catch (e) {
      console.error('[SyncEngine] Failed to send heartbeat:', e);
    }
  }

  setupRealtimeSubscription() {
    if (!this.supabase) return;
    try {
      if (this.realtimeChannel) {
        this.realtimeChannel.unsubscribe();
      }

      const tablesToListen = [
        'products', 'barcodes', 'product_aliases', 'units', 'categories', 
        'catalog_categories', 'product_categories',
        'voice_memory', 'customers', 'khata_transactions', 'khata', 'bills',
        'voice_phrase_cache', 'voice_corrections', 'barcode_master', 'settings'
      ];

      this.realtimeChannel = this.supabase
        .channel('sairam_realtime_db');

      // 1. Listen to all catalog & transactional tables
      for (const table of tablesToListen) {
        this.realtimeChannel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          (payload: any) => {
            // Stamp the realtime health timestamp
            this.lastRealtimeEventAt = Date.now();
            console.log(`[SyncEngine] Realtime event on ${table}:`, payload.eventType, payload.new || payload.old);
            const record = payload.eventType === 'DELETE' ? payload.old : payload.new;

            if (['bills', 'khata_transactions', 'khata', 'customers', 'settings'].includes(table)) {
              // Trigger a fast delta pull to sync related details (e.g. bill items, settings, or khata balance updates)
              db.pullFromSupabase().then(() => {
                this.debounceUIRefresh();
              }).catch((err) => {
                console.error(`[SyncEngine] Realtime pull failed for ${table}:`, err);
              });
            } else {
              db.handleRemoteRealtimeChange(table, payload.eventType, record);
              this.debounceUIRefresh();
            }
          }
        );
      }

      // 2. Listen to print jobs (INSERT)
      this.realtimeChannel.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'print_jobs' },
        async (payload: any) => {
          console.log('[SyncEngine] Realtime print job inserted:', payload.new);
          const newJob = payload.new;
          const myDeviceId = db.getSetting('device_id');
          if (isThisDeviceHost() && newJob && newJob.host_device_id === myDeviceId && newJob.status === 'PENDING') {
            console.log('[SyncEngine] Realtime print job is for us. Processing immediately!');
            const localJobs = db.getPrintJobs();
            if (!localJobs.some(j => j.id === newJob.id)) {
              localJobs.push(newJob);
              db.saveList('sr_print_jobs', localJobs);
            }
            const { useStore } = await import('./store');
            const { printerConfig } = useStore.getState();
            await processHostPrintJobs(printerConfig);
          }
        }
      );

      this.realtimeChannel.subscribe((status: any) => {
        console.log('[SyncEngine] Realtime subscription status:', status);
      });
    } catch (e) {
      console.error('[SyncEngine] Failed to setup realtime subscription:', e);
    }
  }

  private debounceUIRefresh() {
    if (this.uiRefreshTimeout) {
      clearTimeout(this.uiRefreshTimeout);
    }
    this.uiRefreshTimeout = setTimeout(async () => {
      console.log('[SyncEngine] Realtime batch complete. Refreshing UI state...');
      const { useStore } = await import('./store');
      useStore.getState().loadStoreData().catch(() => {});
    }, 300);
  }

  // ─── CHEAP REMOTE-CHANGE CHECK ───────────────────────────
  // Before doing a full pull, we do a single cheap count query:
  // "Does Supabase have any records updated after our last sync?"
  // If not, skip the pull entirely (saves 200-400ms every idle poll).
  private async hasRemoteChangesSince(since: string): Promise<boolean> {
    if (!this.supabase) return false;
    try {
      // Query the cheapest possible thing: one row from any catalog table
      // updated after since. We use products as the primary sentinel.
      const tables = ['products', 'barcodes', 'categories', 'customers', 'units', 'bills', 'khata_transactions', 'catalog_categories', 'product_categories'];
      const results = await Promise.all(
        tables.map(t =>
          this.supabase!.from(t)
            .select('id', { count: 'exact', head: true })
            .gt('updated_at', since)
            .limit(1)
        )
      );
      const hasAny = results.some(r => (r.count ?? 0) > 0);
      console.log(`[SyncEngine] hasRemoteChangesSince(${since}): ${hasAny}`);
      return hasAny;
    } catch (e) {
      // On error, assume changes exist (safe default: pull anyway)
      return true;
    }
  }

  // ─── MAIN SYNC TRIGGER ──────────────────────────────────

  private onSyncCompleteCallback: (() => void) | null = null;

  registerOnSyncComplete(cb: () => void) {
    this.onSyncCompleteCallback = cb;
  }

  async triggerSync(isManual: boolean = false): Promise<number> {
    // ── Debounce non-manual calls ─────────────────────────────────────────
    // Multiple rapid triggerSync() calls from different operations (product
    // saves, bill creates, etc.) get collapsed into a single sync cycle.
    // Manual syncs (from the UI) bypass debounce and run immediately.
    if (!isManual) {
      if (this.isSyncing) return 0;               // already running, skip
      if (this.debounceTimeout) {
        // A debounced sync is already scheduled — just wait for it
        return 0;
      }
      return new Promise<number>((resolve) => {
        this.debounceTimeout = setTimeout(async () => {
          this.debounceTimeout = null;
          const result = await this._doSync(false);
          resolve(result);
        }, 300);
      });
    }
    // Manual: cancel any pending debounce and run immediately
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
    return this._doSync(true);
  }

  private async _doSync(isManual: boolean): Promise<number> {
    if (this.isSyncing) return 0;
    if (!this.isOnline()) {
      console.log('[SyncEngine] Offline. Sync postponed.');
      return 0;
    }

    this.isSyncing = true;
    this.initSupabase();

    const startTime = Date.now();
    let pushedCount = 0;
    let showPopup = false;
    let store: any = null;

    try {
      const { useStore } = await import('./store');
      store = useStore;
      store.getState().setSyncing(true);

      const pendingQueue = db.getSyncQueue().filter(q => q.status === 'pending' || q.status === 'failed');
      const pendingQueueCount = pendingQueue.length;

      if (isManual) {
        showPopup = true;
        store.setState({
          showSyncPopup: true,
          syncTotalCount: pendingQueueCount > 0 ? pendingQueueCount : 1,
          syncCurrentCount: 0,
          syncProgressText: 'Downloading remote updates...'
        });

        // 1. Pull changes in bulk since last sync
        await db.pullFromSupabase();

        // 2. Push local changes in bulk
        if (pendingQueueCount > 0) {
          store.setState({
            syncProgressText: `Uploading local changes (${pendingQueueCount} items)...`
          });
          pushedCount = await this.pushQueueToCloud(true);
        } else {
          console.log('[SyncEngine] Manual sync: no local changes to upload.');
        }

      } else {
        // Debounced/automatic background safety-net sync
        if (pendingQueueCount > 10) {
          showPopup = true;
          store.setState({
            showSyncPopup: true,
            syncTotalCount: pendingQueueCount > 0 ? pendingQueueCount : 1,
            syncCurrentCount: 0,
            syncProgressText: 'Downloading remote updates...'
          });
        }

        // ── Smart delta sync: only pull if Supabase has new changes ──────────
        // hasRemoteChangesSince() runs 5 lightweight HEAD count queries in
        // parallel. If all return 0, we skip the full pull RPC entirely.
        // This eliminates 200-400ms cost for the very common idle case.
        const lastSync = db.getSetting('last_sync_at') || new Date(0).toISOString();
        const shouldPull = await this.hasRemoteChangesSince(lastSync);

        if (showPopup) {
          store.setState({
            syncProgressText: shouldPull
              ? 'Syncing (\u2193 downloading + \u2191 uploading)...'
              : '\u2191 Uploading local changes...'
          });
        }

        if (shouldPull && pendingQueueCount > 0) {
          // Both pull and push needed — run in parallel for maximum speed
          const [, pushed] = await Promise.all([
            db.pullFromSupabase(),
            this.pushQueueToCloud(false)
          ]);
          pushedCount = pushed;
        } else if (shouldPull) {
          // Only remote changes, nothing to push
          await db.pullFromSupabase();
        } else if (pendingQueueCount > 0) {
          // Only local changes, nothing to pull — fastest path
          pushedCount = await this.pushQueueToCloud(false);
        } else {
          // Nothing to do — completely idle
          console.log('[SyncEngine] Delta check: no local or remote changes. Sync skipped.');
        }
      }


      if (isThisDeviceHost()) {
        try {
          const { printerConfig } = store.getState();
          await processHostPrintJobs(printerConfig);
        } catch (e) {
          console.error('[SyncEngine] processHostPrintJobs error:', e);
        }
      }

      const now = new Date().toISOString();
      db.setSetting('last_sync_at', now);

      db.runDailyBackup().then(() => {}, () => {});

      if (this.onSyncCompleteCallback) {
        try {
          this.onSyncCompleteCallback();
        } catch (e) {
          console.error('[SyncEngine] Sync complete callback failed:', e);
        }
      }

      if (pushedCount > 0) {
        console.log(`[SyncEngine] Sync complete. Pushed/pulled ${pushedCount} items.`);
      }
    } catch (err) {
      console.error('[SyncEngine] Sync cycle error:', err);
    } finally {
      if (showPopup && store) {
        const elapsed = Date.now() - startTime;
        if (elapsed < 800) {
          await new Promise(resolve => setTimeout(resolve, 800 - elapsed));
        }
        store.setState({ showSyncPopup: false });
      }

      this.isSyncing = false;
      if (store) {
        store.getState().setSyncing(false);
        const queue = db.getSyncQueue();
        store.setState({ syncQueueCount: queue.filter((q: any) => q.status === 'pending' || q.status === 'failed').length });
      }
    }

    return pushedCount;
  }

  // ─── PUSH: LOCAL QUEUE → CLOUD ──────────────────────────

  async pushQueueToCloud(isManual: boolean = false): Promise<number> {
    if (!this.supabase) return 0;

    // ── Compact: purge stale duplicate entries already in the queue ──────
    // (These accumulated before the addToSyncQueue deduplication fix.)
    // Keep only the latest entry per table+record_id combo, remove older ones.
    const rawQueue = db.getSyncQueue().filter(q => q.status === 'pending' || q.status === 'failed');
    if (rawQueue.length > 0) {
      const latestByKey: Record<string, typeof rawQueue[0]> = {};
      for (const item of rawQueue) {
        const key = `${item.table_name}::${item.record_id}`;
        if (!latestByKey[key] || item.id > latestByKey[key].id) {
          latestByKey[key] = item;
        }
      }
      const toKeepIds = new Set(Object.values(latestByKey).map(i => i.id));
      const toRemoveIds = rawQueue.filter(i => !toKeepIds.has(i.id)).map(i => i.id);
      if (toRemoveIds.length > 0) {
        console.log(`[SyncEngine] Compacted ${toRemoveIds.length} stale duplicate queue entries.`);
        for (const id of toRemoveIds) {
          db.removeFromSyncQueue(id);
        }
      }
    }

    const queue = db.getSyncQueue().filter(q => q.status === 'pending' || q.status === 'failed');
    if (!queue.length) return 0;

    if (isManual) {
      // Force reset retry count on manual sync to give stuck items a fresh chance
      queue.forEach(q => {
        if (q.status === 'failed' || (q.retry_count || 0) > 0) {
          q.retry_count = 0;
          db.markSyncQueueItem(q.id, 'pending', 0);
        }
      });
    }

    const retryable = queue.filter(q => (q.retry_count || 0) < MAX_RETRIES);
    if (!retryable.length) return 0;

    console.log(`[SyncEngine] Pushing ${retryable.length} items to cloud (optimized topological batching)...`);
    let syncedCount = 0;

    const { useStore } = await import('./store');
    const storeState = useStore.getState();
    const showPopup = storeState.showSyncPopup;

    let completedCount = 0;
    const totalItemsToProcess = retryable.length;

    const incrementProgress = (batchSize: number) => {
      completedCount += batchSize;
      if (showPopup) {
        useStore.setState({
          syncCurrentCount: Math.min(completedCount, totalItemsToProcess),
          syncProgressText: `Uploading local changes (${Math.min(completedCount, totalItemsToProcess)}/${totalItemsToProcess})...`
        });
      }
    };

    // Helper for sequential fallback
    const syncRecordAndRemove = async (item: SyncItem): Promise<boolean> => {
      const success = await this.syncRecord(item);
      if (success) {
        db.removeFromSyncQueue(item.id);
        syncedCount++;
        return true;
      } else {
        const retries = (item.retry_count || 0) + 1;
        if (retries >= MAX_RETRIES) {
          console.error(`[SyncEngine] Record ${item.table_name}:${item.record_id} failed after ${MAX_RETRIES} retries. Removed.`);
          db.removeFromSyncQueue(item.id);
        } else {
          db.markSyncQueueItem(item.id, 'failed', retries);
          console.warn(`[SyncEngine] Retry ${retries}/${MAX_RETRIES} for ${item.table_name}:${item.record_id}.`);
        }
        return false;
      }
    };

    // 1. Separate bills from catalog tables
    const billsItems = retryable.filter(item => item.table_name === 'bills');
    const catalogItems = retryable.filter(item => item.table_name !== 'bills');

    // 2. Process Catalog tables in topological dependency order
    const tableOrder = [
      'categories',
      'products',
      'units',
      'barcodes',
      'product_aliases',
      'unit_conversions',
      'customers',
      'khata_transactions',
      'voice_phrase_cache',
      'voice_memory',
      'voice_corrections',
      'settings',
      'print_jobs',
      'voice_logs'
    ];

    const softDeleteTables = ['customers', 'bills', 'khata_transactions', 'voice_phrase_cache'];

    // Group catalog items by table_name for processing
    const catalogByTable: Record<string, SyncItem[]> = {};
    for (const item of catalogItems) {
      if (!catalogByTable[item.table_name]) {
        catalogByTable[item.table_name] = [];
      }
      catalogByTable[item.table_name].push(item);
    }

    // A. Perform Bulk Upserts/Deletes Table-by-Table
    for (const table of tableOrder) {
      const tableItems = catalogByTable[table];
      if (!tableItems || !tableItems.length) continue;

      // Group by record_id to find the latest state of each unique record
      const uniqueRecords: Record<string, { latestItem: SyncItem, allItems: SyncItem[] }> = {};
      for (const item of tableItems) {
        if (!uniqueRecords[item.record_id]) {
          uniqueRecords[item.record_id] = { latestItem: item, allItems: [] };
        } else {
          // If this item is newer (larger ID), make it the latestItem
          if (item.id > uniqueRecords[item.record_id].latestItem.id) {
            uniqueRecords[item.record_id].latestItem = item;
          }
        }
        uniqueRecords[item.record_id].allItems.push(item);
      }

      // Group records into upserts vs deletes based on their latest action
      const upserts: any[] = [];
      const upsertQueueItems: SyncItem[] = [];
      const deletes: string[] = [];
      const deleteQueueItems: SyncItem[] = [];

      for (const recordId of Object.keys(uniqueRecords)) {
        const { latestItem, allItems } = uniqueRecords[recordId];
        if (latestItem.action === 'DELETE') {
          deletes.push(recordId);
          deleteQueueItems.push(...allItems);
        } else {
          try {
            let payload = JSON.parse(latestItem.payload);
            payload = this.sanitizePayload(table, payload);
            upserts.push(payload);
            upsertQueueItems.push(...allItems);
          } catch (e) {
            console.error('[SyncEngine] Invalid JSON payload in bulk queue item:', latestItem.payload);
            // Fallback: mark these specific items as success/failed individually
            for (const item of allItems) {
              db.removeFromSyncQueue(item.id);
            }
            incrementProgress(allItems.length);
          }
        }
      }

      const idCol = table === 'settings' ? 'key' : 'id';

      // Execute Bulk Upserts — chunked into pages of 500 rows
      // (Supabase REST has a practical payload limit around 500 rows)
      if (upserts.length > 0) {
        const CHUNK_SIZE = 500;
        let bulkError = false;
        for (let ci = 0; ci < upserts.length; ci += CHUNK_SIZE) {
          const chunk = upserts.slice(ci, ci + CHUNK_SIZE);
          const { error } = await this.supabase.from(table).upsert(chunk);
          if (error) {
            console.error(`[SyncEngine] Bulk upsert chunk failed on ${table}. Falling back to sequential sync.`, error);
            bulkError = true;
            break;
          }
        }
        if (bulkError) {
          console.warn(`[SyncEngine] Bulk upsert failed on ${table}. Syncing ${upsertQueueItems.length} items with parallel workers...`);
          const CONCURRENCY = 15;
          let idx = 0;
          const runFallbackWorker = async () => {
            while (idx < upsertQueueItems.length) {
              const item = upsertQueueItems[idx++];
              if (item) {
                await syncRecordAndRemove(item);
                incrementProgress(1);
              }
            }
          };
          const workers = Array.from(
            { length: Math.min(CONCURRENCY, upsertQueueItems.length) },
            () => runFallbackWorker()
          );
          await Promise.all(workers);
        } else {
          for (const item of upsertQueueItems) {
            db.removeFromSyncQueue(item.id);
            syncedCount++;
          }
          incrementProgress(upsertQueueItems.length);
        }
      }

      // Execute Bulk Deletes
      if (deletes.length > 0) {
        let error;
        if (softDeleteTables.includes(table)) {
          const res = await this.supabase.from(table).update({ is_deleted: true }).in(idCol, deletes);
          error = res.error;
        } else {
          const res = await this.supabase.from(table).delete().in(idCol, deletes);
          error = res.error;
        }

        if (error) {
          console.error(`[SyncEngine] Bulk delete failed on ${table}. Syncing ${deleteQueueItems.length} delete items with parallel workers.`, error);
          const CONCURRENCY = 15;
          let idx = 0;
          const runDeleteWorker = async () => {
            while (idx < deleteQueueItems.length) {
              const item = deleteQueueItems[idx++];
              if (item) {
                await syncRecordAndRemove(item);
                incrementProgress(1);
              }
            }
          };
          const workers = Array.from(
            { length: Math.min(CONCURRENCY, deleteQueueItems.length) },
            () => runDeleteWorker()
          );
          await Promise.all(workers);
        } else {
          for (const item of deleteQueueItems) {
            db.removeFromSyncQueue(item.id);
            syncedCount++;
          }
          incrementProgress(deleteQueueItems.length);
        }
      }
    }

    // 3. Process remaining tables not in topological order (if any)
    for (const table of Object.keys(catalogByTable)) {
      if (tableOrder.includes(table)) continue;
      const tableItems = catalogByTable[table];
      if (!tableItems || !tableItems.length) continue;
      console.warn(`[SyncEngine] Table ${table} is not in topological order list. Processing in parallel.`);
      const CONCURRENCY = 15;
      let idx = 0;
      const runRemainingWorker = async () => {
        while (idx < tableItems.length) {
          const item = tableItems[idx++];
          if (item) {
            await syncRecordAndRemove(item);
            incrementProgress(1);
          }
        }
      };
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, tableItems.length) },
        () => runRemainingWorker()
      );
      await Promise.all(workers);
    }

    // 4. Process Bills with parallel workers (concurrency = 20)
    // Each bill uses its own RPC call which is independent. Running 20 in
    // parallel reduces 500-bill sync from ~50s → ~2.5s.
    if (billsItems.length > 0) {
      console.log(`[SyncEngine] Processing ${billsItems.length} bill transactions (parallel, concurrency=20)...`);
      const BILL_CONCURRENCY = 20;
      let billIdx = 0;
      const runWorker = async () => {
        while (billIdx < billsItems.length) {
          const item = billsItems[billIdx++];
          await syncRecordAndRemove(item);
          incrementProgress(1);
        }
      };
      const workers = Array.from(
        { length: Math.min(BILL_CONCURRENCY, billsItems.length) },
        () => runWorker()
      );
      await Promise.all(workers);
    }

    return syncedCount;
  }

  private sanitizePayload(table: string, payload: any): any {
    const schemaColumns: Record<string, string[]> = {
      products: [
        'id', 'display_name', 'category_id', 'retail_price', 'wholesale_price',
        'notes', 'stock', 'is_deleted', 'deleted_at', 'created_at', 'updated_at', 'version',
        'product_type', 'default_quantity', 'variant_group', 'image_url', 'image_source', 'image_last_updated'
      ],
      categories: [
        'id', 'name', 'is_deleted', 'deleted_at', 'created_at', 'updated_at', 'version'
      ],
      catalog_categories: [
        'id', 'name', 'image_url', 'display_order', 'is_system', 'is_deleted', 'deleted_at', 'created_at', 'updated_at', 'version'
      ],
      product_categories: [
        'id', 'product_id', 'category_id', 'is_deleted', 'deleted_at', 'created_at', 'updated_at', 'version'
      ],
      barcodes: [
        'id', 'product_id', 'barcode', 'barcode_type', 'unit', 'is_system', 'is_active', 'is_deleted',
        'deleted_at', 'created_at', 'updated_at', 'version'
      ],
      product_aliases: [
        'id', 'product_id', 'alias', 'is_deleted', 'created_at', 'updated_at', 'version'
      ],
      units: [
        'id', 'product_id', 'unit_name', 'quantity', 'price', 'wholesale_price', 'is_deleted',
        'created_at', 'updated_at', 'version'
      ],
      unit_conversions: [
        'id', 'product_id', 'parent_unit', 'child_unit', 'conversion_factor',
        'is_deleted', 'created_at', 'updated_at', 'version'
      ],
      customers: [
        'id', 'name', 'phone', 'last_visit', 'total_bills', 'total_purchases',
        'is_deleted', 'deleted_at', 'created_at', 'updated_at', 'version'
      ],
      khata_transactions: [
        'id', 'customer_id', 'amount', 'transaction_type', 'description', 'image_url',
        'is_deleted', 'deleted_at', 'created_at', 'updated_at', 'version'
      ],
      voice_phrase_cache: [
        'id', 'phrase', 'product_id', 'quantity', 'unit', 'action', 'usage_count',
        'last_used', 'is_deleted', 'created_at', 'updated_at', 'version'
      ],
      voice_memory: [
        'id', 'key', 'product_id', 'quantity', 'unit', 'is_deleted',
        'created_at', 'updated_at', 'version'
      ],
      voice_corrections: [
        'id', 'phrase', 'wrong_product_id', 'correct_product_id', 'count',
        'last_used', 'is_deleted', 'created_at', 'updated_at', 'version'
      ],
      voice_logs: [
        'id', 'raw_input', 'resolved_to', 'confidence', 'device_id', 'created_at'
      ],
      barcode_master: [
        'barcode', 'product_name', 'brand', 'source', 'created_at', 'updated_at', 'version'
      ],
      settings: [
        'key', 'value', 'updated_at', 'version'
      ],
      print_jobs: [
        'id', 'bill_id', 'device_id', 'host_device_id', 'status', 'reason', 'created_at', 'updated_at'
      ]
    };

    const columns = schemaColumns[table];
    if (!columns) return payload;

    const sanitized: any = {};
    for (const col of columns) {
      if (payload[col] !== undefined) {
        sanitized[col] = payload[col];
      }
    }
    return sanitized;
  }

  // ─── SYNC SINGLE RECORD ──────────────────────────────────

  private async syncRecord(item: SyncItem): Promise<boolean> {
    if (!this.supabase) {
      // No Supabase configured — log and drop item as success
      console.log(`[SyncEngine-NoCloud] Skipped sync: ${item.action} ${item.table_name}:${item.record_id}`);
      return true;
    }

    let payload: any;
    try {
      payload = JSON.parse(item.payload);
      payload = this.sanitizePayload(item.table_name, payload);
    }
    catch { console.error('[SyncEngine] Invalid JSON payload:', item.payload); return true; }

    const table = item.table_name;

    try {
      // ── Bills: use transactional RPCs ──────────────────
      if (table === 'bills' && item.action === 'INSERT') {
        const { error } = await this.supabase.rpc('checkout_bill_v1', {
          p_bill_id:        payload.bill_id,
          p_customer_id:    payload.customer_id || null,
          p_customer_name:  payload.customer_name || 'Customer',
          p_customer_phone: payload.customer_phone || 'NA',
          p_subtotal:       payload.subtotal,
          p_discount:       payload.discount,
          p_grand_total:    payload.grand_total,
          p_payment_mode:   payload.payment_mode,
          p_status:         payload.status || 'Completed',
          p_items:          (payload.items || []).map((i: any) => ({
            product_id: i.product_id, product_name: i.product_name,
            quantity: i.quantity, unit: i.unit, price: i.price, total: i.total
          })),
          p_created_at: payload.created_at
        });
        if (error) {
          // Duplicate bill_id means already synced — treat as success
          if (error.code === '23505') {
            console.log('[SyncEngine] Bill already exists in cloud, skipping.');
            try {
              const { data: remoteBill } = await this.supabase
                .from('bills')
                .select('id')
                .eq('bill_id', payload.bill_id)
                .single();
              if (remoteBill && remoteBill.id) {
                db.updateLocalBillId(payload.bill_id, remoteBill.id);
              }
            } catch (fetchErr) {
              console.error('[SyncEngine] Failed to fetch remote ID for existing bill:', fetchErr);
            }
            return true;
          }
          console.error('[SyncEngine] checkout_bill_v1 failed:', error);
          return false;
        }

        // Successfully checked out. Fetch remote ID.
        try {
          const { data: remoteBill } = await this.supabase
            .from('bills')
            .select('id')
            .eq('bill_id', payload.bill_id)
            .single();
          if (remoteBill && remoteBill.id) {
            db.updateLocalBillId(payload.bill_id, remoteBill.id);
          }
        } catch (fetchErr) {
          console.error('[SyncEngine] Failed to fetch remote ID after checkout:', fetchErr);
        }
        return true;
      }

      if (table === 'bills' && item.action === 'UPDATE') {
        if (payload.status === 'Cancelled') {
          const { error } = await this.supabase.rpc('cancel_bill_v1', { p_bill_id: parseInt(item.record_id) });
          if (error) { console.error('[SyncEngine] cancel_bill_v1 failed:', error); return false; }
        } else if (payload.status === 'Completed') {
          const { error } = await this.supabase.rpc('undo_cancel_bill_v1', { p_bill_id: parseInt(item.record_id) });
          if (error) { console.error('[SyncEngine] undo_cancel_bill_v1 failed:', error); return false; }
        } else {
          const { error } = await this.supabase.rpc('update_bill_v1', { p_bill: payload });
          if (error) { console.error('[SyncEngine] update_bill_v1 failed:', error); return false; }
        }
        return true;
      }

      // ── Soft deletes ───────────────────────────────────
      const softDeleteTables = ['customers','bills','khata_transactions','voice_phrase_cache'];

      if (item.action === 'DELETE') {
        if (softDeleteTables.includes(table)) {
          const { error } = await this.supabase.from(table).update({ is_deleted: true }).eq('id', item.record_id);
          if (error) { console.error(`[SyncEngine] Soft delete failed on ${table}:`, error); return false; }
        } else {
          const { error } = await this.supabase.from(table).delete().eq('id', item.record_id);
          if (error) { console.error(`[SyncEngine] Delete failed on ${table}:`, error); return false; }
        }
        return true;
      }

      // ── Standard INSERT / UPDATE ───────────────────────
      if (item.action === 'INSERT') {
        const { error } = await this.supabase.from(table).upsert(payload);
        if (error) {
          if (error.code === '23505') { console.log(`[SyncEngine] ${table}:${item.record_id} already exists, skipping.`); return true; }
          console.error(`[SyncEngine] INSERT failed on ${table}:`, error);
          return false;
        }
      } else if (item.action === 'UPDATE') {
        const { error } = await this.supabase.from(table).update(payload).eq('id', item.record_id);
        if (error) { console.error(`[SyncEngine] UPDATE failed on ${table}:`, error); return false; }
      }

      return true;
    } catch (err) {
      console.error('[SyncEngine] Network error during sync:', err);
      return false;
    }
  }

  // ─── PULL/PUSH ALL DATA (FAILSAFE RECONCILIATION) ────────

  async pushAllLocalData(): Promise<number> {
    if (!this.supabase) return 0;
    console.log('[SyncEngine] Force-syncing all local tables to cloud...');
    let uploadCount = 0;

    try {
      // 1. Categories
      const categories = db.getRawList<any>('sr_categories');
      if (categories.length) {
        const sanitized = categories.map(c => this.sanitizePayload('categories', c));
        const { error } = await this.supabase.from('categories').upsert(sanitized);
        if (error) console.error('[SyncEngine] Categories bulk upsert error:', error);
        else uploadCount += sanitized.length;
      }

      // 1b. Catalog Categories
      const catalogCategories = db.getRawList<any>('sr_catalog_categories');
      if (catalogCategories.length) {
        const sanitized = catalogCategories.map(c => this.sanitizePayload('catalog_categories', c));
        const { error } = await this.supabase.from('catalog_categories').upsert(sanitized);
        if (error) console.error('[SyncEngine] Catalog Categories bulk upsert error:', error);
        else uploadCount += sanitized.length;
      }

      // 1c. Product Categories Mappings
      const productCategories = db.getRawList<any>('sr_product_categories');
      if (productCategories.length) {
        const sanitized = productCategories.map(pc => this.sanitizePayload('product_categories', pc));
        const { error } = await this.supabase.from('product_categories').upsert(sanitized);
        if (error) console.error('[SyncEngine] Product Categories bulk upsert error:', error);
        else uploadCount += sanitized.length;
      }

      // 2. Products
      const products = await db.getAllProductsRaw();
      if (products.length) {
        const sanitized = products.map(p => this.sanitizePayload('products', p));
        const { error } = await this.supabase.from('products').upsert(sanitized);
        if (error) console.error('[SyncEngine] Products bulk upsert error:', error);
        else uploadCount += sanitized.length;
      }

      // 3. Barcodes
      const barcodes = db.getRawList<any>('sr_barcodes');
      if (barcodes.length) {
        const sanitized = barcodes.map(b => this.sanitizePayload('barcodes', b));
        const { error } = await this.supabase.from('barcodes').upsert(sanitized);
        if (error) console.error('[SyncEngine] Barcodes bulk upsert error:', error);
        else uploadCount += sanitized.length;
      }

      // 4. Customers
      const customers = db.getRawList<any>('sr_customers');
      if (customers.length) {
        const sanitized = customers.map(c => this.sanitizePayload('customers', c));
        const { error } = await this.supabase.from('customers').upsert(sanitized);
        if (error) console.error('[SyncEngine] Customers bulk upsert error:', error);
        else {
          uploadCount += sanitized.length;
          // Also rebuild/upsert khata records for customers
          const khataMapRaw = localStorage.getItem('sr_khata') || '{}';
          try {
            const khataMap = JSON.parse(khataMapRaw);
            const khataPayloads = Object.entries(khataMap).map(([custId, bal]) => ({
              customer_id: parseInt(custId),
              balance: parseFloat(bal as string),
              is_deleted: false,
              last_updated: new Date().toISOString()
            }));
            if (khataPayloads.length) {
              await this.supabase.from('khata').upsert(khataPayloads);
            }
          } catch (e) {
            console.error('[SyncEngine] Khata sync error:', e);
          }
        }
      }

      // 5. Khata Transactions
      const txs = db.getRawList<any>('sr_khata_txs');
      if (txs.length) {
        const sanitized = txs.map(t => this.sanitizePayload('khata_transactions', t));
        const { error } = await this.supabase.from('khata_transactions').upsert(sanitized);
        if (error) console.error('[SyncEngine] Khata transactions bulk upsert error:', error);
        else uploadCount += sanitized.length;
      }

      // 6. Voice Cache & Voice Memory
      const voiceCache = db.getRawList<any>('sr_voice_cache');
      if (voiceCache.length) {
        const sanitized = voiceCache.map(c => this.sanitizePayload('voice_phrase_cache', c));
        const { error } = await this.supabase.from('voice_phrase_cache').upsert(sanitized);
        if (error) console.error('[SyncEngine] Voice phrase cache bulk upsert error:', error);
        else uploadCount += sanitized.length;
      }
      const voiceMem = db.getRawList<any>('sr_voice_memory');
      if (voiceMem.length) {
        const sanitized = voiceMem.map(m => this.sanitizePayload('voice_memory', m));
        const { error } = await this.supabase.from('voice_memory').upsert(sanitized);
        if (error) console.error('[SyncEngine] Voice memory bulk upsert error:', error);
        else uploadCount += sanitized.length;
      }

      // 6b. Voice Corrections
      const voiceCorrections = db.getRawList<any>('sr_voice_corrections');
      if (voiceCorrections.length) {
        const sanitized = voiceCorrections.map(c => this.sanitizePayload('voice_corrections', c));
        const { error } = await this.supabase.from('voice_corrections').upsert(sanitized);
        if (error) console.error('[SyncEngine] Voice corrections bulk upsert error:', error);
        else uploadCount += sanitized.length;
      }

      // 6c. Voice Logs
      const voiceLogs = db.getRawList<any>('sr_voice_logs');
      if (voiceLogs.length) {
        const sanitized = voiceLogs.map(l => {
          // Map predicted / final product IDs and confidence to match Supabase schema
          return {
            raw_input: l.transcript,
            resolved_to: l.final_product_id,
            confidence: l.confidence / 100,
            device_id: db.getSetting('device_id') || 'unknown',
            created_at: l.created_at
          };
        });
        const { error } = await this.supabase.from('voice_logs').upsert(sanitized);
        if (error) console.error('[SyncEngine] Voice logs bulk upsert error:', error);
        else uploadCount += sanitized.length;
      }

      // 7. Barcode Master
      const master = db.getRawList<any>('sr_barcode_master');
      if (master.length) {
        const sanitized = master.map(m => this.sanitizePayload('barcode_master', m));
        const { error } = await this.supabase.from('barcode_master').upsert(sanitized);
        if (error) console.error('[SyncEngine] Barcode master bulk upsert error:', error);
        else uploadCount += sanitized.length;
      }

      // 7b. Print Jobs (only push locally-created jobs; host reads from cloud)
      const printJobs = db.getRawList<any>('sr_print_jobs');
      if (printJobs.length) {
        const sanitized = printJobs.map(j => this.sanitizePayload('print_jobs', j));
        const { error } = await this.supabase.from('print_jobs').upsert(sanitized);
        if (error) console.error('[SyncEngine] Print jobs bulk upsert error:', error);
        else uploadCount += sanitized.length;
      }

      // 8. Bills (RPC reconciliation)
      const bills = db.getRawList<any>('sr_bills');
      if (bills.length) {
        const { data: remoteBills, error: fetchErr } = await this.supabase.from('bills').select('bill_id');
        if (fetchErr) {
          console.error('[SyncEngine] Fetching remote bills failed:', fetchErr);
        } else {
          const remoteBillIds = new Set(remoteBills?.map((b: any) => b.bill_id) || []);
          for (const localBill of bills) {
            if (!remoteBillIds.has(localBill.bill_id)) {
              // RPC Insert
              const { error } = await this.supabase.rpc('checkout_bill_v1', {
                p_bill_id:        localBill.bill_id,
                p_customer_id:    localBill.customer_id || null,
                p_customer_name:  localBill.customer_name || 'Customer',
                p_customer_phone: localBill.customer_phone || 'NA',
                p_subtotal:       localBill.subtotal,
                p_discount:       localBill.discount,
                p_grand_total:    localBill.grand_total,
                p_payment_mode:   localBill.payment_mode,
                p_status:         localBill.status || 'Completed',
                p_items:          (localBill.items || []).map((i: any) => ({
                  product_id: i.product_id, product_name: i.product_name,
                  quantity: i.quantity, unit: i.unit, price: i.price, total: i.total
                })),
                p_created_at: localBill.created_at
              });
              if (error) {
                console.error('[SyncEngine] Checkout bill RPC failed during full upload:', error);
              } else {
                uploadCount++;
                try {
                  const { data: remoteBill } = await this.supabase
                    .from('bills')
                    .select('id')
                    .eq('bill_id', localBill.bill_id)
                    .single();
                  if (remoteBill && remoteBill.id) {
                    db.updateLocalBillId(localBill.bill_id, remoteBill.id);
                  }
                } catch (fetchErr) {
                  console.error('[SyncEngine] Failed to fetch remote ID in full upload:', fetchErr);
                }
              }
            } else {
              // Fetch remote ID to ensure local is up-to-date
              let targetId = localBill.id;
              try {
                const { data: remoteBill } = await this.supabase
                  .from('bills')
                  .select('id')
                  .eq('bill_id', localBill.bill_id)
                  .single();
                if (remoteBill && remoteBill.id) {
                  db.updateLocalBillId(localBill.bill_id, remoteBill.id);
                  targetId = remoteBill.id;
                }
              } catch (fetchErr) {
                console.error('[SyncEngine] Failed to fetch remote ID for cancel alignment:', fetchErr);
              }

              // If it exists in cloud but the local one is cancelled, call cancel RPC
              if (localBill.status === 'Cancelled') {
                const { error } = await this.supabase.rpc('cancel_bill_v1', { p_bill_id: targetId });
                if (error) console.error('[SyncEngine] Cancel bill RPC failed during full upload:', error);
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('[SyncEngine] Error during pushAllLocalData:', e);
    }

    return uploadCount;
  }

  // ─── STATS / STATUS ─────────────────────────────────────

  getSyncStats() {
    const queue = db.getSyncQueue();
    return {
      total:    queue.length,
      pending:  queue.filter(q => q.status === 'pending').length,
      failed:   queue.filter(q => q.status === 'failed').length,
      synced:   queue.filter(q => q.status === 'synced').length,
      lastSync: db.getSetting('last_sync_at') || null
    };
  }
}

export const syncEngine = new SyncEngine();
syncEngine.start();
