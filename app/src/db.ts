import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

const DEFAULT_UPI_QR_PAYLOAD = 'upi://pay?pa=gpay-11232240371@okbizaxis&pn=Sai%20Ram%20Kirana&tn=undefined&am=undefined';
const OLD_DEFAULT_UPI_QR_PAYLOAD = 'upi://pay?pa=gpay-11232240371@okbizaxis&mc=5399&pn=Google%20Pay%20Merchant&oobe=fos123&qrst=stn&tr=1232240371&cu=INR';
const OLD_SUBHASH_UPI_QR_PAYLOAD = 'upi://pay?pa=gpay-11232240371@okbizaxis&pn=Subhash%2520Grosery%2520&mc=5411&aid=uGFeAgMIAwAFCw';
const OLD_SAIRAM_NO_PARAMS = 'upi://pay?pa=gpay-11232240371@okbizaxis&pn=Sai%20Ram%20Kirana';
const LEGACY_DEFAULT_UPI_ID = 'sairamkirana@sbi';

function normalizeUPISetting(value?: string): string {
  const cleanValue = (value || '').trim();
  if (!cleanValue || cleanValue === LEGACY_DEFAULT_UPI_ID || cleanValue === OLD_DEFAULT_UPI_QR_PAYLOAD || cleanValue === OLD_SUBHASH_UPI_QR_PAYLOAD || cleanValue === OLD_SAIRAM_NO_PARAMS) {
    return DEFAULT_UPI_QR_PAYLOAD;
  }
  return cleanValue;
}

// ============================================================
// Sai Ram Kirana POS — Database Service Layer
// Architecture: Offline-First (LocalStorage) + Cloud Sync (Supabase)
//
// WRITE RULE: Every write goes to LocalStorage FIRST, always.
//             Supabase sync happens in the background.
// READ RULE:  Always read from LocalStorage for speed.
//             Pull from Supabase only during sync cycles.
// ============================================================

// ============================================================
// INTERFACES
// ============================================================
export interface Product {
  id: number;
  display_name: string;
  category_id?: number;
  product_type?: 'WEIGHT' | 'VOLUME' | 'PACKAGED';
  default_quantity?: string;
  variant_group?: string;
  barcode?: string;
  barcodes?: string[];
  retail_price: number;
  wholesale_price: number;
  notes?: string;
  aliases?: string[];
  unit_conversions?: UnitConversion[];
  units?: UnitPricing[];
  stock?: number;
  is_deleted?: boolean;
  deleted_at?: string;
  created_at?: string;
  updated_at?: string;
  version?: number;
  updated_by?: string;
  image_url?: string;
  image_source?: string;
  image_last_updated?: string;
}

export interface CatalogCategory {
  id: string; // UUID
  name: string;
  image_url?: string;
  display_order: number;
  is_system: boolean;
  is_deleted?: boolean;
  deleted_at?: string;
  created_at?: string;
  updated_at?: string;
  version?: number;
  updated_by?: string;
}

export interface ProductCategory {
  id: string; // UUID
  product_id: number;
  category_id: string; // UUID
  is_deleted?: boolean;
  deleted_at?: string;
  created_at?: string;
  updated_at?: string;
  version?: number;
  updated_by?: string;
}

export interface Barcode {
  id: number;
  product_id: number;
  barcode: string;
  barcode_type: string;
  unit?: string;
  is_system?: boolean;
  is_active: boolean;
  is_deleted?: boolean;
  created_at?: string;
  updated_at?: string;
  version?: number;
  updated_by?: string;
}

export interface UnitPricing {
  id?: number;
  product_id?: number;
  unit_name: string;
  quantity: number;
  price: number;
  wholesale_price?: number;
}

export interface UnitConversion {
  id?: number;
  product_id?: number;
  parent_unit: string;
  child_unit: string;
  conversion_factor: number;
}

export interface Customer {
  id: number;
  name: string;
  phone?: string;
  last_visit?: string;
  total_bills: number;
  total_purchases: number;
  is_deleted?: boolean;
  deleted_at?: string;
  created_at?: string;
  updated_at?: string;
  version?: number;
  updated_by?: string;
}

export interface BillItem {
  id?: number;
  bill_id?: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit: string;
  price: number;
  total: number;
}

export interface Bill {
  id: number;
  bill_id: string;
  bill_number: number;
  customer_id?: number;
  customer_name?: string;
  customer_phone?: string;
  subtotal: number;
  discount: number;
  grand_total: number;
  payment_mode: 'Cash' | 'UPI' | 'Credit';
  status: 'Completed' | 'Cancelled';
  print_status: 'PRINTED' | 'PRINT_PENDING' | 'PRINT_SKIPPED';
  created_at: string;
  items: BillItem[];
  is_deleted?: boolean;
  deleted_at?: string;
  updated_at?: string;
  version?: number;
}

export interface KhataRecord {
  customer_id: number;
  customer_name: string;
  customer_phone?: string;
  balance: number;
  last_updated: string;
}

export interface KhataTransaction {
  id: number;
  customer_id: number;
  amount: number;
  transaction_type: 'Credit' | 'Payment';
  description: string;
  image_url?: string;
  created_at: string;
  is_deleted?: boolean;
  updated_at?: string;
  version?: number;
  updated_by?: string;
}

export interface SyncItem {
  id: number;
  table_name: string;
  record_id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: string;
  status: 'pending' | 'synced' | 'failed';
  retry_count: number;
  created_at: string;
  synced_at?: string;
}

export interface VoiceCacheEntry {
  id?: number;
  phrase: string;
  product_id: number;
  quantity: number;
  unit: string;
  action: 'ADD_ITEM' | 'REMOVE_ITEM' | 'UPDATE_ITEM';
  usage_count?: number;
  last_used?: string;
  is_deleted?: boolean;
  updated_at?: string;
  version?: number;
  updated_by?: string;
}

export interface VoiceMemoryEntry {
  id?: number;
  key: string;
  product_id: number;
  quantity: number;
  unit: string;
  is_deleted?: boolean;
  updated_at?: string;
  version?: number;
  action?: string;
  updated_by?: string;
}

export interface VoiceLog {
  id?: number;
  transcript: string;
  predicted_product_id: number | null;
  final_product_id: number | null;
  confidence: number;
  ai_used: boolean;
  execution_time_ms: number;
  success: boolean;
  created_at?: string;
}

export interface VoiceCorrection {
  id?: number;
  phrase: string;
  wrong_product_id: number;
  correct_product_id: number;
  count: number;
  last_used?: string;
  updated_by?: string;
}

export interface BarcodeMasterEntry {
  barcode: string;
  product_name: string;
  brand: string;
  source: string;
  created_at?: string;
  updated_at?: string;
  version?: number;
}

export type PrintJobStatus =
  | 'PENDING'
  | 'PRINTING'
  | 'PRINT_SUCCESS'
  | 'PRINT_FAILED'
  | 'NO_PRINTER_CONNECTED';

export interface PrintJob {
  id?: number;
  bill_id: string;
  device_id: string;
  host_device_id?: string;
  status: PrintJobStatus;
  reason?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AuditLog {
  id?: number;
  entity: string;
  entity_id?: string;
  action: string;
  old_value?: any;
  new_value?: any;
  user_info?: string;
  device_id?: string;
  created_at?: string;
}

export type MeasurementType = 'Weight' | 'Volume' | 'Piece' | 'Pack' | 'Length';

export interface Category {
  id: number;
  name: string;
  measurement_type: MeasurementType;
  default_units: string[];
  is_deleted?: boolean;
  updated_at?: string;
  version?: number;
}

// ============================================================
// SEED DATA (used only when LocalStorage is empty)
// ============================================================
const DEFAULT_PRODUCTS: Product[] = [];

const DEFAULT_CATEGORIES: Category[] = [
  { id: 1, name: 'weight',      measurement_type: 'Weight', default_units: ['KG','Gram'] },
  { id: 2, name: 'volume',      measurement_type: 'Volume', default_units: ['Litre','ML'] },
  { id: 3, name: 'cartoon',     measurement_type: 'Piece',  default_units: ['Carton','Pudha','Piece'] },
  { id: 4, name: 'bag',         measurement_type: 'Piece',  default_units: ['Bag','Piece'] },
  { id: 5, name: 'tray',        measurement_type: 'Piece',  default_units: ['Tray','Piece'] },
  { id: 7, name: 'sheet',       measurement_type: 'Piece',  default_units: ['Sheet','Piece'] }
];

const DEFAULT_BARCODES: Barcode[] = [];

const DEFAULT_CUSTOMERS: Customer[] = [];

const DEFAULT_KHATA: Record<number, number> = {};

// ============================================================
// DB SERVICE CLASS
// ============================================================
class DBService {
  private isNative: boolean = false;
  supabase: SupabaseClient | null = null;
  private sqliteConnection: SQLiteConnection | null = null;
  private sqliteDB: SQLiteDBConnection | null = null;
  private memoryCache: Record<string, string> = {};
  private productsCache: Product[] = [];
  private isCacheLoaded: boolean = false;
  private productFreqMap = new Map<number, number>();
  onQueueItemAdded?: () => void;

  constructor() {
    this.isNative = Capacitor.isNativePlatform();
    console.log('[DBService] isNative:', this.isNative);
  }

  // ─── INITIALIZATION ──────────────────────────────────────

  async init() {
    this.initSupabase();
    if (this.isNative) {
      try {
        this.sqliteConnection = new SQLiteConnection(CapacitorSQLite);
        const dbName = 'sairamkirana';
        const isConn = (await this.sqliteConnection.isConnection(dbName, false)).result;
        if (isConn) {
          this.sqliteDB = await this.sqliteConnection.retrieveConnection(dbName, false);
        } else {
          this.sqliteDB = await this.sqliteConnection.createConnection(dbName, false, 'no-encryption', 1, false);
        }
        await this.sqliteDB.open();
        
        // Setup simple key-value tables
        await this.sqliteDB.execute('CREATE TABLE IF NOT EXISTS local_store (key TEXT PRIMARY KEY, val TEXT);');
        
        // Cache SQLite entries locally in memory
        const res = await this.sqliteDB.query('SELECT key, val FROM local_store');
        if (res.values) {
          for (const row of res.values) {
            this.memoryCache[row.key] = row.val;
          }
        }
        console.log('[DBService] SQLite initialized successfully, cache size:', Object.keys(this.memoryCache).length);
      } catch (err) {
        console.error('[DBService] SQLite init failed, using LocalStorage fallback:', err);
      }
    }
    
    this._seedLocalStorage();
    
    // Store credentials for native background sync worker
    this.setRawItem('supabase_url', (import.meta as any).env?.VITE_SUPABASE_URL || '');
    this.setRawItem('supabase_anon_key', (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '');
    
    // Explicit migration for settings
    try {
      const settingsStr = this.getRawItem('sr_settings');
      if (settingsStr) {
        const settings = JSON.parse(settingsStr);
        if (settings.upi_id === OLD_DEFAULT_UPI_QR_PAYLOAD || settings.upi_id === OLD_SUBHASH_UPI_QR_PAYLOAD || settings.upi_id === OLD_SAIRAM_NO_PARAMS || settings.upi_id === LEGACY_DEFAULT_UPI_ID) {
          settings.upi_id = DEFAULT_UPI_QR_PAYLOAD;
          this.setRawItem('sr_settings', JSON.stringify(settings));
        }
      }
    } catch (e) {
      console.error('[DBService] Settings migration error:', e);
    }

    // Rebuild products cache on startup
    await this.rebuildProductsCache();

    // Background cloud sync after local is ready (only if database is initialized)
    const isInitialized = this.getSetting('local_database_initialized') === 'true';
    if (navigator.onLine && isInitialized) {
      setTimeout(() => {
        this.fullSync().catch(e => console.error('[DBService] Startup sync error:', e));
      }, 2000);
    }
  }

  private _seedLocalStorage() {
    const checkItem = (key: string) => {
      return this.getRawItem(key);
    };

    if (!checkItem('sr_products'))      this.saveList('sr_products',      DEFAULT_PRODUCTS);
    if (!checkItem('sr_barcodes'))      this.saveList('sr_barcodes',      DEFAULT_BARCODES);
    if (!checkItem('sr_customers'))     this.saveList('sr_customers',     DEFAULT_CUSTOMERS);
    if (!checkItem('sr_categories'))    this.saveList('sr_categories',    DEFAULT_CATEGORIES);
    if (!checkItem('sr_bills'))         this.saveList('sr_bills',         []);
    if (!checkItem('sr_sync_queue'))    this.saveList('sr_sync_queue',    []);
    if (!checkItem('sr_voice_cache'))   this.saveList('sr_voice_cache',   []);
    if (!checkItem('sr_voice_memory'))     this.saveList('sr_voice_memory',     []);
    if (!checkItem('sr_voice_logs'))        this.saveList('sr_voice_logs',        []);
    if (!checkItem('sr_voice_corrections')) this.saveList('sr_voice_corrections', []);
    if (!checkItem('sr_barcode_master'))    this.saveList('sr_barcode_master',    []);
    if (!checkItem('sr_audit_logs'))        this.saveList('sr_audit_logs',        []);
    if (!checkItem('sr_product_aliases'))   this.saveList('sr_product_aliases',   []);
    if (!checkItem('sr_units'))             this.saveList('sr_units',             []);
    if (!checkItem('sr_catalog_categories')) this.saveList('sr_catalog_categories', []);
    if (!checkItem('sr_product_categories')) this.saveList('sr_product_categories', []);

    if (!checkItem('sr_khata')) {
      const json = JSON.stringify(DEFAULT_KHATA);
      this.setRawItem('sr_khata', json);
    }
    if (!checkItem('sr_khata_txs')) {
      this.saveList('sr_khata_txs', []);
    }
    if (!checkItem('sr_settings')) {
      const json = JSON.stringify({
        store_name: 'Sai Ram Kirana', upi_id: DEFAULT_UPI_QR_PAYLOAD,
        admin_password: 'Sairam@123', printer_name: '', printer_mac: '',
        device_status: '', trusted_token: '', device_details: '{}'
      });
      this.setRawItem('sr_settings', json);
    }
  }

  // ─── SUPABASE CLIENT (credentials from .env ONLY) ──────
  //     VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be
  //     set in app/.env — never stored in localStorage.

  initSupabase() {
    const url     = (import.meta as any).env?.VITE_SUPABASE_URL     || '';
    const anonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';
    if (url && anonKey) {
      this.supabase = createClient(url, anonKey);
    } else {
      this.supabase = null;
    }
  }

  isCloudAvailable(): boolean {
    return navigator.onLine && this.supabase !== null;
  }

  // ─── LOCAL STORAGE HELPERS ───────────────────────────────

  private getRawItem(key: string): string | null {
    return this.memoryCache[key] || localStorage.getItem(key);
  }

  private setRawItem(key: string, val: string): void {
    this.memoryCache[key] = val;
    localStorage.setItem(key, val);
    if (this.isNative && this.sqliteDB) {
      this.sqliteDB.run('INSERT OR REPLACE INTO local_store (key, val) VALUES (?, ?)', [key, val])
        .catch(err => console.error('[DBService] SQLite setRawItem error', key, err));
    }
  }

  private removeRawItem(key: string): void {
    delete this.memoryCache[key];
    localStorage.removeItem(key);
    if (this.isNative && this.sqliteDB) {
      this.sqliteDB.run('DELETE FROM local_store WHERE key = ?', [key])
        .catch(err => console.error('[DBService] SQLite removeRawItem error', key, err));
    }
  }

  private getList<T>(key: string): T[] {
    try {
      const raw = this.getRawItem(key) || '[]';
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  public saveList<T>(key: string, list: T[]): void {
    const json = JSON.stringify(list);
    this.setRawItem(key, json);
    localStorage.setItem(`backup_${key}.json`, json); // local backup
  }

  private _nextId<T extends { id: number }>(list: T[]): number {
    // Generate a unique 32-bit integer ID based on time-offset since 2026-01-01
    // to prevent multi-device ID conflicts while staying well within the signed 32-bit int limit (2,147,483,647).
    let id = (Math.floor(Date.now() / 1000) - 1760000000) + Math.floor(Math.random() * 100000);
    while (list.some(x => x.id === id)) {
      id = id + 1 + Math.floor(Math.random() * 10);
    }
    return id;
  }

  // ─── AUDIT LOG ───────────────────────────────────────────

  addAuditLog(entity: string, action: string, oldVal?: any, newVal?: any, entityId?: string) {
    const logs = this.getList<AuditLog>('sr_audit_logs');
    logs.push({
      entity, action,
      entity_id: entityId,
      old_value: oldVal,
      new_value: newVal,
      created_at: new Date().toISOString()
    });
    // Keep only latest 500 entries locally
    if (logs.length > 500) logs.splice(0, logs.length - 500);
    this.saveList('sr_audit_logs', logs);
  }

  // ─── SYNC QUEUE ──────────────────────────────────────────

  getSyncQueue(): SyncItem[] {
    return this.getList<SyncItem>('sr_sync_queue');
  }

  getRawList<T>(key: string): T[] {
    return this.getList<T>(key);
  }

  addToSyncQueue(tableName: string, recordId: string, action: 'INSERT' | 'UPDATE' | 'DELETE', payload: any) {
    const queue = this.getSyncQueue();

    // ── Deduplication: collapse repeated pending entries for same record ──
    // If a pending/failed entry already exists for this table+record, update it
    // in-place instead of appending. This prevents queue bloat when the same
    // product is edited multiple times before the next sync cycle.
    const existingIdx = queue.findIndex(
      q => q.table_name === tableName &&
           q.record_id  === String(recordId) &&
           (q.status === 'pending' || q.status === 'failed')
    );

    if (existingIdx !== -1) {
      const existing = queue[existingIdx];
      // Promote INSERT→UPDATE only if the incoming action is UPDATE/DELETE
      // (never downgrade a DELETE back to UPDATE)
      if (existing.action !== 'DELETE') {
        queue[existingIdx] = {
          ...existing,
          action,
          payload: JSON.stringify(payload),
          status: 'pending',
          retry_count: 0,
          created_at: new Date().toISOString()
        };
        this.saveList('sr_sync_queue', queue);
        if (this.onQueueItemAdded) this.onQueueItemAdded();
        return;
      }
      // If existing is DELETE, keep it — don't allow re-inserts to override
      if (action !== 'INSERT') return;
    }

    const newId = this._nextId(queue);
    queue.push({
      id: newId, table_name: tableName, record_id: String(recordId),
      action, payload: JSON.stringify(payload),
      status: 'pending', retry_count: 0,
      created_at: new Date().toISOString()
    });
    this.saveList('sr_sync_queue', queue);
    if (this.onQueueItemAdded) this.onQueueItemAdded();
  }

  removeFromSyncQueue(id: number) {
    const queue = this.getSyncQueue().filter(q => q.id !== id);
    this.saveList('sr_sync_queue', queue);
  }

  markSyncQueueItem(id: number, status: 'pending' | 'synced' | 'failed', retry_count?: number) {
    const queue = this.getSyncQueue();
    const idx = queue.findIndex(q => q.id === id);
    if (idx !== -1) {
      queue[idx].status = status;
      if (status === 'synced') queue[idx].synced_at = new Date().toISOString();
      if (retry_count !== undefined) queue[idx].retry_count = retry_count;
      this.saveList('sr_sync_queue', queue);
    }
  }

  // ─── BIDIRECTIONAL SYNC ──────────────────────────────────

  /**
   * fullSync: pull changes from Supabase first (to get admin-made changes),
   * then push local queue to Supabase.
   */
  async fullSync(): Promise<void> {
    if (!this.isCloudAvailable()) return;
    try {
      await this.pullFromSupabase();
      this.setSetting('last_sync_at', new Date().toISOString());
      this.runDailyBackup().catch(() => {});
    } catch (err) {
      console.error('[DBService] Full sync failed:', err);
    }
  }

  private async _fetchAllRows(tableName: string): Promise<any[]> {
    if (!this.supabase) return [];
    let allData: any[] = [];
    let offset = 0;
    const limit = 1000;
    let finished = false;
    while (!finished) {
      const { data, error } = await this.supabase
        .from(tableName)
        .select('*')
        .range(offset, offset + limit - 1);
      if (error) {
        throw new Error(`Failed to fetch all rows for ${tableName}: ${error.message}`);
      }
      if (!data || data.length === 0) {
        finished = true;
      } else {
        allData = [...allData, ...data];
        offset += data.length;
        if (data.length < limit) {
          finished = true;
        }
      }
    }
    return allData;
  }

  async forceFullSync(): Promise<void> {
    if (!this.supabase) {
      console.warn('[DBService] Supabase client not initialized, forceFullSync aborted.');
      return;
    }
    console.log('[DBService] Starting Emergency Force Full Sync with pagination...');
    
    try {
      const [
        categories,
        products,
        barcodes,
        aliases,
        units,
        _conversions,
        customers,
        khata,
        khataTxs,
        voiceCache,
        voiceMemory,
        voiceCorrections,
        bills,
        billItems
      ] = await Promise.all([
        this._fetchAllRows('categories'),
        this._fetchAllRows('products'),
        this._fetchAllRows('barcodes'),
        this._fetchAllRows('product_aliases'),
        this._fetchAllRows('units'),
        this._fetchAllRows('unit_conversions'),
        this._fetchAllRows('customers'),
        this._fetchAllRows('khata'),
        this._fetchAllRows('khata_transactions'),
        this._fetchAllRows('voice_phrase_cache'),
        this._fetchAllRows('voice_memory'),
        this._fetchAllRows('voice_corrections'),
        this._fetchAllRows('bills'),
        this._fetchAllRows('bill_items')
      ]);

      this.saveList('sr_categories', categories);
      this.saveList('sr_products', products);
      this.saveList('sr_barcodes', barcodes);
      this.saveList('sr_product_aliases', aliases);
      this.saveList('sr_units', units);
      this.saveList('sr_customers', customers);
      
      const khataMap: Record<number, number> = {};
      khata.forEach((k: any) => {
        khataMap[k.customer_id] = parseFloat(k.balance);
      });
      this.setRawItem('sr_khata', JSON.stringify(khataMap));
      
      this.saveList('sr_khata_txs', khataTxs);
      this.saveList('sr_voice_cache', voiceCache);
      this.saveList('sr_voice_memory', voiceMemory);
      this.saveList('sr_voice_corrections', voiceCorrections);

      // Merge bills and bill items using the dedicated helper to be robust
      this._mergeBillsFromRemote(bills, billItems);

      this.setSetting('last_sync_at', new Date().toISOString());

      await this.rebuildProductsCache();
      console.log('[DBService] Force Full Sync Completed successfully with all tables.');
    } catch (err: any) {
      console.error('[DBService] Force Full Sync failed:', err);
      throw new Error(`Failed to complete full sync: ${err.message || err}`);
    }
  }

  /**
   * Pull all changes from Supabase since last sync.
   * Merge by version number (higher wins). Log conflicts.
   */
  async pullFromSupabase(): Promise<void> {
    if (!this.supabase) return;

    const lastSync = this.getSetting('last_sync_at');
    const since = lastSync ? new Date(lastSync) : new Date(0);

    try {
      const { data, error } = await this.supabase.rpc('pull_changes_since', {
        p_since: since.toISOString()
      });
      if (error) { console.error('[DBService] pull_changes_since error:', error); return; }
      if (!data) return;

      console.log('[DBService] Pull received data from Supabase');

      // Merge each entity type with a brief yield to keep the main thread responsive
      this._mergeRemoteIntoLocal('sr_products',       data.products       || []);
      await new Promise(resolve => setTimeout(resolve, 15));
      this._mergeRemoteIntoLocal('sr_barcodes',       data.barcodes       || []);
      await new Promise(resolve => setTimeout(resolve, 15));
      this._mergeRemoteIntoLocal('sr_customers',      data.customers      || []);
      await new Promise(resolve => setTimeout(resolve, 15));
      this._mergeRemoteIntoLocal('sr_categories',     data.categories     || []);
      await new Promise(resolve => setTimeout(resolve, 15));
      this._mergeRemoteIntoLocal('sr_catalog_categories', data.catalog_categories || []);
      await new Promise(resolve => setTimeout(resolve, 15));
      this._mergeRemoteIntoLocal('sr_product_categories', data.product_categories || []);
      await new Promise(resolve => setTimeout(resolve, 15));
      this._mergeRemoteIntoLocal('sr_voice_cache',    data.voice_phrase_cache || []);
      await new Promise(resolve => setTimeout(resolve, 15));
      this._mergeRemoteIntoLocal('sr_voice_memory',   data.voice_memory   || []);
      await new Promise(resolve => setTimeout(resolve, 15));
      this._mergeRemoteIntoLocal('sr_voice_corrections', data.voice_corrections || []);
      await new Promise(resolve => setTimeout(resolve, 15));
      this._mergeRemoteIntoLocal('sr_voice_logs',        data.voice_logs        || []);
      await new Promise(resolve => setTimeout(resolve, 15));
      this._mergeRemoteIntoLocal('sr_barcode_master', data.barcode_master || []);
      await new Promise(resolve => setTimeout(resolve, 15));
      this._mergeRemoteIntoLocal('sr_product_aliases', data.product_aliases || []);
      await new Promise(resolve => setTimeout(resolve, 15));
      this._mergeRemoteIntoLocal('sr_units',           data.units           || []);
      await new Promise(resolve => setTimeout(resolve, 15));

      // Print jobs: merge from remote (host writes updates; non-host reads them)
      if (data.print_jobs && data.print_jobs.length > 0) {
        this._mergePrintJobsFromRemote(data.print_jobs);
        await new Promise(resolve => setTimeout(resolve, 15));
      }

      // Bills: merge but do NOT overwrite local pending bills
      this._mergeBillsFromRemote(data.bills || [], data.bill_items || []);
      await new Promise(resolve => setTimeout(resolve, 15));

      // Khata: merge remote changed balances into local khata map
      if (data.khata && data.khata.length > 0) {
        const khataMap = this.getKhataMap();
        data.khata.forEach((k: any) => { khataMap[k.customer_id] = parseFloat(k.balance); });
        this.setRawItem('sr_khata', JSON.stringify(khataMap));
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      if (data.khata_transactions && data.khata_transactions.length > 0) {
        this._mergeRemoteIntoLocal('sr_khata_txs', data.khata_transactions);
        await new Promise(resolve => setTimeout(resolve, 15));
      }

      // Settings from remote (merge carefully — only pull non-credential settings)
      if (data.settings && data.settings.length > 0) {
        const remoteSettings: Record<string,string> = {};
        data.settings.forEach((s: any) => { remoteSettings[s.key] = s.value; });
        const localSettings = JSON.parse(this.getRawItem('sr_settings') || '{}');
        const mergedSettings = { ...localSettings };
        // Only pull store display settings & printer host settings, not credentials
        const pullableKeys = ['store_name','upi_id','qr_merchant_name','current_printer_host','printer_host_connected','printer_host_last_seen'];
        pullableKeys.forEach(k => {
          if (remoteSettings[k]) mergedSettings[k] = k === 'upi_id' ? normalizeUPISetting(remoteSettings[k]) : remoteSettings[k];
        });
        this.setRawItem('sr_settings', JSON.stringify(mergedSettings));
        await new Promise(resolve => setTimeout(resolve, 15));
      }

      await new Promise(resolve => setTimeout(resolve, 30));
      await this.rebuildProductsCache();
    } catch (err) {
      console.error('[DBService] pullFromSupabase error:', err);
    }
  }

  async checkDatabaseDiscrepancies(): Promise<{
    toUploadCount: number;
    toDownloadCount: number;
    toUpload: { table: string; id: string; action: string; record: any }[];
    toDownload: { table: string; id: any }[];
  }> {
    if (!this.supabase) {
      return { toUploadCount: 0, toDownloadCount: 0, toUpload: [], toDownload: [] };
    }

    const discrepancies: {
      toUpload: { table: string; id: string; action: string; record: any }[];
      toDownload: { table: string; id: any }[];
    } = { toUpload: [], toDownload: [] };

    try {
      const [
        remoteProductsRes,
        remoteBarcodesRes,
        remoteUnitsRes,
        remoteCategoriesRes,
        remoteAliasesRes,
        remoteCustomersRes,
        remoteKhataTxsRes,
        remoteBillsRes,
        remoteCatalogCategoriesRes,
        remoteProductCategoriesRes
      ] = await Promise.all([
        this.supabase.from('products').select('id, version, updated_at'),
        this.supabase.from('barcodes').select('id, version, updated_at'),
        this.supabase.from('units').select('id, version, updated_at'),
        this.supabase.from('categories').select('id, version, updated_at'),
        this.supabase.from('product_aliases').select('id, version, updated_at'),
        this.supabase.from('customers').select('id, version, updated_at'),
        this.supabase.from('khata_transactions').select('id, version, updated_at'),
        this.supabase.from('bills').select('id, bill_id, version, updated_at, status'),
        this.supabase.from('catalog_categories').select('id, version, updated_at'),
        this.supabase.from('product_categories').select('id, version, updated_at')
      ]);

      const remoteProductsMap = new Map<number, any>((remoteProductsRes.data || []).map(r => [r.id, r]));
      const remoteBarcodesMap = new Map<number, any>((remoteBarcodesRes.data || []).map(r => [r.id, r]));
      const remoteUnitsMap = new Map<number, any>((remoteUnitsRes.data || []).map(r => [r.id, r]));
      const remoteCategoriesMap = new Map<number, any>((remoteCategoriesRes.data || []).map(r => [r.id, r]));
      const remoteAliasesMap = new Map<number, any>((remoteAliasesRes.data || []).map(r => [r.id, r]));
      const remoteCustomersMap = new Map<number, any>((remoteCustomersRes.data || []).map(r => [r.id, r]));
      const remoteKhataTxsMap = new Map<number, any>((remoteKhataTxsRes.data || []).map(r => [r.id, r]));
      const remoteBillsMap = new Map<string, any>((remoteBillsRes.data || []).map(r => [r.bill_id, r]));
      const remoteCatalogCategoriesMap = new Map<string, any>((remoteCatalogCategoriesRes.data || []).map(r => [r.id, r]));
      const remoteProductCategoriesMap = new Map<string, any>((remoteProductCategoriesRes.data || []).map(r => [r.id, r]));

      const tablesToCheck = [
        { name: 'products', localKey: 'sr_products', remoteMap: remoteProductsMap },
        { name: 'barcodes', localKey: 'sr_barcodes', remoteMap: remoteBarcodesMap },
        { name: 'units', localKey: 'sr_units', remoteMap: remoteUnitsMap },
        { name: 'categories', localKey: 'sr_categories', remoteMap: remoteCategoriesMap },
        { name: 'catalog_categories', localKey: 'sr_catalog_categories', remoteMap: remoteCatalogCategoriesMap },
        { name: 'product_categories', localKey: 'sr_product_categories', remoteMap: remoteProductCategoriesMap },
        { name: 'product_aliases', localKey: 'sr_product_aliases', remoteMap: remoteAliasesMap },
        { name: 'customers', localKey: 'sr_customers', remoteMap: remoteCustomersMap },
        { name: 'khata_transactions', localKey: 'sr_khata_txs', remoteMap: remoteKhataTxsMap }
      ];

      for (const t of tablesToCheck) {
        const localItems = this.getList<any>(t.localKey);
        const localMap = new Map<any, any>(localItems.map(item => [item.id, item]));

        for (const local of localItems) {
          const remote = (t.remoteMap as Map<any, any>).get(local.id);
          if (!remote) {
            discrepancies.toUpload.push({ table: t.name, id: String(local.id), action: 'INSERT', record: local });
          } else {
            const localVer = local.version || 0;
            const remoteVer = remote.version || 0;
            const localTime = new Date(local.updated_at || 0).getTime();
            const remoteTime = new Date(remote.updated_at || 0).getTime();

            if (localVer > remoteVer || (localVer === remoteVer && localTime > remoteTime)) {
              discrepancies.toUpload.push({ table: t.name, id: String(local.id), action: 'UPDATE', record: local });
            }
          }
        }

        for (const [rId, remote] of (t.remoteMap as Map<any, any>).entries()) {
          const local = localMap.get(rId);
          if (!local) {
            discrepancies.toDownload.push({ table: t.name, id: String(rId) });
          } else {
            const localVer = local.version || 0;
            const remoteVer = remote.version || 0;
            const localTime = new Date(local.updated_at || 0).getTime();
            const remoteTime = new Date(remote.updated_at || 0).getTime();

            if (remoteVer > localVer || (remoteVer === localVer && remoteTime > localTime)) {
              discrepancies.toDownload.push({ table: t.name, id: rId });
            }
          }
        }
      }

      const localBills = this.getList<any>('sr_bills');
      const localBillsMap = new Map<string, any>(localBills.map(b => [b.bill_id, b]));

      for (const local of localBills) {
        const remote = remoteBillsMap.get(local.bill_id);
        if (!remote) {
          discrepancies.toUpload.push({ table: 'bills', id: String(local.bill_id), action: 'INSERT', record: local });
        } else {
          const localVer = local.version || 0;
          const remoteVer = remote.version || 0;
          if (local.status !== remote.status || localVer > remoteVer) {
            discrepancies.toUpload.push({ table: 'bills', id: String(local.id), action: 'UPDATE', record: local });
          }
        }
      }

      for (const [remoteBillId, remote] of remoteBillsMap.entries()) {
        const local = localBillsMap.get(remoteBillId);
        if (!local) {
          discrepancies.toDownload.push({ table: 'bills', id: remote.id });
        } else {
          const localVer = local.version || 0;
          const remoteVer = remote.version || 0;
          if (local.status !== remote.status || remoteVer > localVer) {
            discrepancies.toDownload.push({ table: 'bills', id: remote.id });
          }
        }
      }

    } catch (err) {
      console.error('[DBService] checkDatabaseDiscrepancies error:', err);
    }

    return {
      toUploadCount: discrepancies.toUpload.length,
      toDownloadCount: discrepancies.toDownload.length,
      toUpload: discrepancies.toUpload,
      toDownload: discrepancies.toDownload
    };
  }

  async downloadMissingRecords(
    toDownload: { table: string; id: any }[],
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    if (!this.supabase || !toDownload.length) return;

    const tableGroups: Record<string, any[]> = {};
    toDownload.forEach(item => {
      if (!tableGroups[item.table]) tableGroups[item.table] = [];
      tableGroups[item.table].push(item.id);
    });

    const localKeys: Record<string, string> = {
      products: 'sr_products',
      barcodes: 'sr_barcodes',
      units: 'sr_units',
      categories: 'sr_categories',
      catalog_categories: 'sr_catalog_categories',
      product_categories: 'sr_product_categories',
      product_aliases: 'sr_product_aliases',
      customers: 'sr_customers',
      khata_transactions: 'sr_khata_txs',
      bills: 'sr_bills'
    };

    let processedCount = 0;
    const totalToDownload = toDownload.length;

    for (const [table, ids] of Object.entries(tableGroups)) {
      const localKey = localKeys[table];
      if (!localKey) continue;

      const batchSize = 50;
      for (let i = 0; i < ids.length; i += batchSize) {
        const batchIds = ids.slice(i, i + batchSize);
        try {
          if (table === 'bills') {
            const { data: billsData, error: billsErr } = await this.supabase
              .from('bills')
              .select('*')
              .in('id', batchIds);
            
            if (billsErr) throw billsErr;

            if (billsData && billsData.length) {
              const remoteBillIds = billsData.map(b => b.id);
              const { data: itemsData, error: itemsErr } = await this.supabase
                .from('bill_items')
                .select('*')
                .in('bill_id', remoteBillIds);

              if (itemsErr) throw itemsErr;

              this._mergeBillsFromRemote(billsData, itemsData || []);
            }
          } else {
            const { data, error } = await this.supabase
              .from(table)
              .select('*')
              .in('id', batchIds);

            if (error) throw error;

            if (data && data.length) {
              this._mergeRemoteIntoLocal(localKey, data);
            }
          }
        } catch (e) {
          console.error(`[DBService] Error downloading delta batch for ${table}:`, e);
        }

        processedCount += batchIds.length;
        if (onProgress) {
          onProgress(processedCount, totalToDownload);
        }
      }
    }

    if (tableGroups['products'] || tableGroups['barcodes'] || tableGroups['units'] || tableGroups['product_aliases']) {
      await this.rebuildProductsCache();
    }
  }

  updateLocalBillId(billId: string, newNumericId: number) {
    const bills = this.getList<Bill>('sr_bills');
    const idx = bills.findIndex(b => b.bill_id === billId);
    if (idx !== -1) {
      const oldId = bills[idx].id;
      if (oldId === newNumericId) return;

      bills[idx].id = newNumericId;
      if (bills[idx].items) {
        bills[idx].items.forEach(item => {
          item.bill_id = newNumericId;
        });
      }
      this.saveList('sr_bills', bills);

      // Also update any pending sync queue items matching this bill's local ID
      const queue = this.getSyncQueue();
      let queueChanged = false;
      queue.forEach(q => {
        if (q.table_name === 'bills' && q.record_id === String(oldId)) {
          q.record_id = String(newNumericId);
          try {
            const payload = JSON.parse(q.payload);
            payload.id = newNumericId;
            if (payload.items) {
              payload.items.forEach((item: any) => {
                item.bill_id = newNumericId;
              });
            }
            q.payload = JSON.stringify(payload);
          } catch (e) {
            console.error('[DBService] Failed to update payload ID in queue:', e);
          }
          queueChanged = true;
        }
      });
      if (queueChanged) {
        this.saveList('sr_sync_queue', queue);
      }

      console.log(`[DBService] Updated local bill ID from ${oldId} to ${newNumericId} for ${billId}`);
    }
  }

  /** Merge remote records into local list. Higher version wins. */
  private _mergeRemoteIntoLocal(
    localKey: string,
    remoteRecords: any[]
  ) {
    if (!remoteRecords.length) return;
    const local = this.getList<any>(localKey);
    const localMap = new Map<any, any>();
    const localById = new Map<any, any>();
    local.forEach(r => {
      localById.set(r.id, r);
      if (localKey === 'sr_khata_txs' && r.description && r.description.startsWith('Credit Purchase - Bill #')) {
        localMap.set(r.description, r);
      } else {
        localMap.set(r.id, r);
      }
    });

    // Build a set of record IDs that are queued to be pushed (local wins for these)
    const tableNameMap: Record<string, string> = {
      sr_products:       'products',
      sr_barcodes:       'barcodes',
      sr_customers:      'customers',
      sr_categories:     'categories',
      sr_catalog_categories: 'catalog_categories',
      sr_product_categories: 'product_categories',
      sr_product_aliases:'product_aliases',
      sr_units:          'units',
      sr_voice_cache:    'voice_phrase_cache',
      sr_voice_memory:   'voice_memory',
      sr_voice_corrections:'voice_corrections',
      sr_voice_logs:     'voice_logs',
      sr_barcode_master: 'barcode_master',
      sr_khata_txs:      'khata_transactions',
    };
    const tableName = tableNameMap[localKey];
    const pendingIds = new Set<string>();
    if (tableName) {
      const queue = this.getSyncQueue();
      queue.forEach(q => {
        if (
          q.table_name === tableName &&
          (q.status === 'pending' || q.status === 'failed')
        ) {
          pendingIds.add(String(q.record_id));
        }
      });
    }

    let changed = false;

    for (const remote of remoteRecords) {
      const lookupKey = (localKey === 'sr_khata_txs' && remote.description && remote.description.startsWith('Credit Purchase - Bill #'))
        ? remote.description
        : remote.id;

      const existing = localMap.get(lookupKey);
      if (!existing) {
        const existingById = localById.get(remote.id);
        if (existingById) {
          localMap.set(lookupKey, existingById);
        } else {
          localMap.set(lookupKey, remote);
          changed = true;
          this.addAuditLog(localKey, 'CLOUD_INSERT', null, remote, String(remote.id));
        }
      } else {
        // ── Local-wins guard: if this record has a pending push, don't overwrite ──
        // The user just changed it on this device — the push will win in Supabase.
        // Accepting the remote version here would wipe the local change.
        if (pendingIds.has(String(remote.id))) {
          console.log(`[DBService] Merge skip — pending push protects local: ${localKey}:${remote.id}`);
          // Still sync the remote id back to local if local had a temp id
          if (existing.id !== remote.id) {
            existing.id = remote.id;
            changed = true;
          }
          continue;
        }

        const localVer   = existing.version  || 0;
        const remoteVer  = remote.version    || 0;
        const localTime  = new Date(existing.updated_at  || 0).getTime();
        const remoteTime = new Date(remote.updated_at    || 0).getTime();

        // Last-write-wins: higher version wins; tie-break by updated_at timestamp
        if (remoteVer > localVer || (remoteVer === localVer && remoteTime > localTime)) {
          this.addAuditLog(localKey, 'CLOUD_OVERWRITE', existing, remote, String(remote.id));
          localMap.set(lookupKey, remote);
          changed = true;
        } else {
          if (existing.id !== remote.id) {
            existing.id = remote.id;
            changed = true;
          }
        }
      }
    }

    if (changed) {
      this.saveList(localKey, Array.from(localMap.values()));
    }
  }


  private _mergeBillsFromRemote(remoteBills: any[], remoteBillItems: any[]) {
    if (!remoteBills.length) return;
    const local = this.getList<Bill>('sr_bills');
    const localMap = new Map<string, Bill>();
    local.forEach(b => {
      if (b.bill_id) localMap.set(b.bill_id, b);
    });

    let changed = false;

    for (const remote of remoteBills) {
      const items = remoteBillItems.filter(i => i.bill_id === remote.id);
      const remoteBill: Bill = { ...remote, items };
      const existing = localMap.get(remote.bill_id);
      if (!existing) {
        localMap.set(remote.bill_id, remoteBill);
        changed = true;
      } else {
        const localVer  = existing.version || 0;
        const remoteVer = remote.version   || 0;
        if (remoteVer > localVer) {
          localMap.set(remote.bill_id, remoteBill);
          changed = true;
        } else {
          if (existing.id !== remote.id) {
            existing.id = remote.id;
            if (existing.items) {
              existing.items.forEach(item => {
                item.bill_id = remote.id;
              });
            }
            changed = true;
          }
        }
      }
    }

    if (changed) {
      this.saveList('sr_bills', Array.from(localMap.values()));
    }
  }

  // ─── PRODUCTS CACHE & OPTIMIZATION ───────────────────────

  async rebuildProductsCache(): Promise<void> {
    const products = this.getList<Product>('sr_products').filter(p => !p.is_deleted);
    const barcodes = this.getList<Barcode>('sr_barcodes').filter(b => !b.is_deleted);
    const bills    = this.getList<Bill>('sr_bills');
    const aliasesList = this.getList<any>('sr_product_aliases').filter(a => !a.is_deleted);
    const unitsList   = this.getList<any>('sr_units').filter(u => !u.is_deleted);

    // Pre-group barcodes by product_id: O(B)
    const barcodesByProduct = new Map<number, Barcode[]>();
    barcodes.forEach(b => {
      let list = barcodesByProduct.get(b.product_id);
      if (!list) {
        list = [];
        barcodesByProduct.set(b.product_id, list);
      }
      list.push(b);
    });

    // Pre-group aliases by product_id: O(A)
    const aliasesByProduct = new Map<number, string[]>();
    aliasesList.forEach(a => {
      let list = aliasesByProduct.get(a.product_id);
      if (!list) {
        list = [];
        aliasesByProduct.set(a.product_id, list);
      }
      list.push(a.alias);
    });

    // Pre-group units by product_id: O(U)
    const unitsByProduct = new Map<number, any[]>();
    unitsList.forEach(u => {
      let list = unitsByProduct.get(u.product_id);
      if (!list) {
        list = [];
        unitsByProduct.set(u.product_id, list);
      }
      list.push(u);
    });

    // Build bills frequency map: O(BI)
    this.productFreqMap.clear();
    bills.forEach(b => {
      if (b.status !== 'Cancelled') {
        b.items?.forEach(i => {
          this.productFreqMap.set(i.product_id, (this.productFreqMap.get(i.product_id) || 0) + i.quantity);
        });
      }
    });

    // Map products in linear time: O(N)
    const mapped = products.map(p => {
      const pBarcodes = barcodesByProduct.get(p.id) || [];
      const activeBList = pBarcodes.filter(b => b.is_active);
      const vendorBarcodes = activeBList.filter(b => !b.is_system).map(b => b.barcode);
      const allBarcodes = activeBList.map(b => b.barcode);
      
      const pAliases = aliasesByProduct.get(p.id) || [];
      const pUnits = unitsByProduct.get(p.id) || [];
      
      return { 
        ...p, 
        barcode: vendorBarcodes[0] || '', 
        barcodes: allBarcodes, 
        aliases: pAliases, 
        units: pUnits 
      };
    });

    this.productsCache = mapped.sort((a, b) => (this.productFreqMap.get(b.id) || 0) - (this.productFreqMap.get(a.id) || 0));
    this.isCacheLoaded = true;
    console.log('[DBService] Cache initialized. Total products loaded:', this.productsCache.length);
  }


  rehydrateSingleProduct(productId: number): void {
    if (!this.isCacheLoaded) return;

    const products = this.getList<Product>('sr_products');
    const prod = products.find(p => p.id === productId);

    if (!prod || prod.is_deleted) {
      this.productsCache = this.productsCache.filter(p => p.id !== productId);
      return;
    }

    const barcodes = this.getList<Barcode>('sr_barcodes').filter(b => !b.is_deleted && b.product_id === productId);
    const aliasesList = this.getList<any>('sr_product_aliases').filter((a: any) => !a.is_deleted && a.product_id === productId);
    const unitsList   = this.getList<any>('sr_units').filter((u: any) => !u.is_deleted && u.product_id === productId);

    const activeBList = barcodes.filter(b => b.is_active);
    const vendorBarcodes = activeBList.filter(b => !b.is_system).map(b => b.barcode);
    const allBarcodes = activeBList.map(b => b.barcode);
    const pAliases = aliasesList.map((a: any) => a.alias);

    const hydrated: Product = {
      ...prod,
      barcode: vendorBarcodes[0] || '',
      barcodes: allBarcodes,
      aliases: pAliases,
      units: unitsList
    };

    const idx = this.productsCache.findIndex(p => p.id === productId);
    if (idx !== -1) {
      this.productsCache[idx] = hydrated;
    } else {
      this.productsCache.push(hydrated);
    }

    // Re-sort cache using stored frequency map
    this.productsCache.sort((a, b) => (this.productFreqMap.get(b.id) || 0) - (this.productFreqMap.get(a.id) || 0));
  }

  handleRemoteRealtimeChange(table: string, eventType: string, record: any): void {
    const myDeviceId = this.getSetting('device_id');
    if (record && record.updated_by === myDeviceId) {
      console.log(`[DBService] Realtime ignore echo from table ${table}`);
      return;
    }

    const localKeyMap: Record<string, string> = {
      products: 'sr_products',
      barcodes: 'sr_barcodes',
      product_aliases: 'sr_product_aliases',
      units: 'sr_units',
      categories: 'sr_categories',
      catalog_categories: 'sr_catalog_categories',
      product_categories: 'sr_product_categories',
      voice_memory: 'sr_voice_memory',
      customers: 'sr_customers',
      khata_transactions: 'sr_khata_txs',
      voice_phrase_cache: 'sr_voice_cache',
      voice_corrections: 'sr_voice_corrections',
      barcode_master: 'sr_barcode_master'
    };

    const localKey = localKeyMap[table];
    if (!localKey) return;

    const localList = this.getList<any>(localKey);

    if (eventType === 'DELETE') {
      const targetId = record?.id;
      if (targetId === undefined) return;
      const updatedList = localList.filter(item => item.id !== targetId);
      this.saveList(localKey, updatedList);
      
      // Rehydrate product in cache if applicable
      if (table === 'products') {
        this.rehydrateSingleProduct(targetId);
      } else if (record.product_id) {
        this.rehydrateSingleProduct(record.product_id);
      }
      return;
    }

    // For INSERT or UPDATE
    const targetId = record?.id;
    if (targetId === undefined) return;
    const idx = localList.findIndex(item => item.id === targetId);
    let changed = false;

    if (idx === -1) {
      localList.push(record);
      changed = true;
      console.log(`[DBService] Realtime insert on ${table}:`, targetId);
    } else {
      const localVer = localList[idx].version || 0;
      const remoteVer = record.version || 0;
      const localTime = new Date(localList[idx].updated_at || 0).getTime();
      const remoteTime = new Date(record.updated_at || 0).getTime();

      if (remoteVer > localVer || (remoteVer === localVer && remoteTime > localTime)) {
        localList[idx] = record;
        changed = true;
        console.log(`[DBService] Realtime update (remote wins) on ${table}:`, targetId);
      } else {
        console.log(`[DBService] Realtime update (local is newer/same) on ${table}:`, targetId);
      }
    }

    if (changed) {
      this.saveList(localKey, localList);
      
      // Rehydrate products cache
      if (table === 'products') {
        this.rehydrateSingleProduct(targetId);
      } else if (record.product_id) {
        this.rehydrateSingleProduct(record.product_id);
      }
    }
  }

  // ─── CATEGORIES ──────────────────────────────────────────

  async getCategories(): Promise<Category[]> {
    return this.getList<Category>('sr_categories').filter(c => !c.is_deleted);
  }

  // ─── CATALOG CATEGORIES ───────────────────────────────────

  getCatalogCategories(): CatalogCategory[] {
    return this.getList<CatalogCategory>('sr_catalog_categories').filter(c => !c.is_deleted);
  }

  async saveCatalogCategory(category: Omit<CatalogCategory, 'id'> & { id?: string }): Promise<CatalogCategory> {
    const categories = this.getList<CatalogCategory>('sr_catalog_categories');
    const now = new Date().toISOString();
    const devId = this.getSetting('device_id') || 'unknown';
    let saved: CatalogCategory;

    if (category.id) {
      const idx = categories.findIndex(c => c.id === category.id);
      if (idx !== -1) {
        const prev = categories[idx];
        categories[idx] = {
          ...prev, ...category,
          updated_at: now, version: (prev.version || 1) + 1,
          updated_by: devId
        };
        saved = categories[idx];
        this.addAuditLog('catalog_categories', 'UPDATE', prev, saved, String(category.id));
      } else {
        saved = { ...category, id: category.id, updated_at: now, version: 1, updated_by: devId } as CatalogCategory;
        categories.push(saved);
      }
    } else {
      const newId = crypto.randomUUID ? crypto.randomUUID() : this._generateUUID();
      saved = { ...category, id: newId, created_at: now, updated_at: now, version: 1, updated_by: devId } as CatalogCategory;
      categories.push(saved);
      this.addAuditLog('catalog_categories', 'CREATE', null, saved, newId);
    }
    this.saveList('sr_catalog_categories', categories);
    this.addToSyncQueue('catalog_categories', saved.id, category.id ? 'UPDATE' : 'INSERT', saved);
    return saved;
  }

  async deleteCatalogCategory(categoryId: string): Promise<void> {
    const categories = this.getList<CatalogCategory>('sr_catalog_categories');
    const now = new Date().toISOString();
    const devId = this.getSetting('device_id') || 'unknown';
    const idx = categories.findIndex(c => c.id === categoryId);
    if (idx !== -1) {
      const prev = categories[idx];
      const deleted = {
        ...prev,
        is_deleted: true,
        deleted_at: now,
        updated_at: now,
        version: (prev.version || 1) + 1,
        updated_by: devId
      };
      categories[idx] = deleted;
      this.saveList('sr_catalog_categories', categories);
      this.addToSyncQueue('catalog_categories', categoryId, 'DELETE', deleted);
      this.addAuditLog('catalog_categories', 'DELETE', prev, deleted, categoryId);

      // Also clean up any product mappings to this category
      const productCats = this.getList<ProductCategory>('sr_product_categories');
      const updatedProductCats = productCats.map(pc => {
        if (pc.category_id === categoryId && !pc.is_deleted) {
          const deletePayload = { ...pc, is_deleted: true, deleted_at: now, updated_at: now, updated_by: devId };
          this.addToSyncQueue('product_categories', pc.id, 'DELETE', deletePayload);
          return deletePayload;
        }
        return pc;
      });
      this.saveList('sr_product_categories', updatedProductCats);
    }
  }

  // ─── PRODUCT CATEGORIES JUNCTION ─────────────────────────

  getProductCategories(): ProductCategory[] {
    return this.getList<ProductCategory>('sr_product_categories').filter(pc => !pc.is_deleted);
  }

  async assignProductToCategory(productId: number, categoryId: string): Promise<ProductCategory> {
    const mappings = this.getList<ProductCategory>('sr_product_categories');
    const now = new Date().toISOString();
    const devId = this.getSetting('device_id') || 'unknown';

    // Check if mapping already exists (including soft deleted ones we can revive)
    const idx = mappings.findIndex(m => m.product_id === productId && m.category_id === categoryId);
    let saved: ProductCategory;

    if (idx !== -1) {
      const prev = mappings[idx];
      if (prev.is_deleted) {
        mappings[idx] = {
          ...prev,
          is_deleted: false,
          deleted_at: undefined,
          updated_at: now,
          version: (prev.version || 1) + 1,
          updated_by: devId
        };
        saved = mappings[idx];
        this.addToSyncQueue('product_categories', saved.id, 'UPDATE', saved);
      } else {
        saved = prev;
      }
    } else {
      const newId = crypto.randomUUID ? crypto.randomUUID() : this._generateUUID();
      saved = {
        id: newId,
        product_id: productId,
        category_id: categoryId,
        created_at: now,
        updated_at: now,
        version: 1,
        updated_by: devId
      };
      mappings.push(saved);
      this.addToSyncQueue('product_categories', newId, 'INSERT', saved);
    }
    this.saveList('sr_product_categories', mappings);
    return saved;
  }

  async removeProductFromCategory(productId: number, categoryId: string): Promise<void> {
    const mappings = this.getList<ProductCategory>('sr_product_categories');
    const now = new Date().toISOString();
    const devId = this.getSetting('device_id') || 'unknown';

    const idx = mappings.findIndex(m => m.product_id === productId && m.category_id === categoryId && !m.is_deleted);
    if (idx !== -1) {
      const prev = mappings[idx];
      const deleted = {
        ...prev,
        is_deleted: true,
        deleted_at: now,
        updated_at: now,
        version: (prev.version || 1) + 1,
        updated_by: devId
      };
      mappings[idx] = deleted;
      this.saveList('sr_product_categories', mappings);
      this.addToSyncQueue('product_categories', prev.id, 'DELETE', deleted);
    }
  }

  // helper method to generate UUID fallback
  private _generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // ─── PRODUCTS ────────────────────────────────────────────

  async getProducts(): Promise<Product[]> {
    if (!this.isCacheLoaded) {
      await this.rebuildProductsCache();
    }
    return this.productsCache;
  }

  async getAllProductsRaw(): Promise<Product[]> {
    const products = this.getList<Product>('sr_products');
    const barcodes = this.getList<Barcode>('sr_barcodes');
    const aliasesList = this.getList<any>('sr_product_aliases');
    const unitsList   = this.getList<any>('sr_units');
    return products.map(p => {
      const activeBList = barcodes.filter(b => b.product_id === p.id && b.is_active && !b.is_deleted);
      const vendorBarcodes = activeBList.filter(b => !b.is_system).map(b => b.barcode);
      const allBarcodes = activeBList.map(b => b.barcode);
      const pAliases = aliasesList.filter((a: any) => a.product_id === p.id && !a.is_deleted).map((a: any) => a.alias);
      const pUnits = unitsList.filter((u: any) => u.product_id === p.id && !u.is_deleted);
      return { ...p, barcode: vendorBarcodes[0] || '', barcodes: allBarcodes, aliases: pAliases, units: pUnits };
    });
  }

  async saveProduct(product: Omit<Product, 'id'> & { id?: number }): Promise<Product> {
    // STEP 1: Write to LocalStorage immediately
    const products = this.getList<Product>('sr_products');
    const { barcode, barcodes, ...productToSave } = product as any;
    const now = new Date().toISOString();
    const devId = this.getSetting('device_id') || 'unknown';
    let saved: Product;

    if (product.id) {
      const idx = products.findIndex(p => p.id === product.id);
      if (idx !== -1) {
        const prev = products[idx];
        products[idx] = {
          ...prev, ...productToSave,
          updated_at: now, version: (prev.version || 1) + 1,
          updated_by: devId
        };
        saved = products[idx];
        this.addAuditLog('products', 'UPDATE', prev, saved, String(product.id));
      } else {
        saved = { ...productToSave, id: product.id, updated_at: now, version: 1, updated_by: devId } as Product;
        products.push(saved);
      }
    } else {
      const newId = this._nextId(products);
      saved = { ...productToSave, id: newId, created_at: now, updated_at: now, version: 1, updated_by: devId } as Product;
      products.push(saved);
      this.addAuditLog('products', 'CREATE', null, saved, String(newId));
    }
    this.saveList('sr_products', products);

    // STEP 2: Sync barcodes locally
    const barcodesToSync: string[] = [];
    if (barcode && barcode.trim()) {
      barcodesToSync.push(barcode.trim());
    }
    if (Array.isArray(barcodes)) {
      barcodes.forEach(b => {
        const clean = b.trim();
        if (clean && !barcodesToSync.includes(clean)) {
          barcodesToSync.push(clean);
        }
      });
    }
    this._syncBarcodesLocal(saved.id, barcodesToSync);
    this._syncUnitsLocal(saved.id, productToSave.units || []);
    this._syncAliasesLocal(saved.id, productToSave.aliases || []);

    // STEP 3: Enqueue for background cloud sync
    this.addToSyncQueue('products', String(saved.id), product.id ? 'UPDATE' : 'INSERT', saved);

    // STEP 4: Background push to Supabase (non-blocking) is now handled by the queue via SyncEngine

    // Rehydrate products cache
    this.rehydrateSingleProduct(saved.id);

    const activeBarcodes = this.getList<Barcode>('sr_barcodes')
      .filter(b => b.product_id === saved.id && b.is_active && !b.is_deleted).map(b => b.barcode);
    return { ...saved, barcode: activeBarcodes[0] || '', barcodes: activeBarcodes };
  }

  private _syncUnitsLocal(productId: number, units: any[]) {
    const dbUnits = this.getList<any>('sr_units');
    const devId = this.getSetting('device_id') || 'unknown';
    const now = new Date().toISOString();

    // 1. Remove/mark deleted any units for this product that are no longer present
    const updatedUnits = dbUnits.map((u: any) => {
      if (u.product_id === productId) {
        const matchingNewUnit = units.find(nu => nu.unit_name.toLowerCase() === u.unit_name.toLowerCase());
        if (!matchingNewUnit) {
          const deletePayload = { ...u, is_deleted: true, updated_at: now, updated_by: devId };
          this.addToSyncQueue('units', String(u.id), 'DELETE', deletePayload);
          return deletePayload;
        }
      }
      return u;
    });

    // 2. Add or update active units
    units.forEach((u: any) => {
      const idx = updatedUnits.findIndex(du => du.product_id === productId && du.unit_name.toLowerCase() === u.unit_name.toLowerCase());
      if (idx !== -1) {
        const prev = updatedUnits[idx];
        updatedUnits[idx] = {
          ...prev,
          quantity: u.quantity,
          price: u.price,
          wholesale_price: u.wholesale_price,
          is_deleted: false,
          updated_at: now,
          version: (prev.version || 1) + 1,
          updated_by: devId
        };
        this.addToSyncQueue('units', String(prev.id), 'UPDATE', updatedUnits[idx]);
      } else {
        const newId = this._nextId(updatedUnits);
        const newU = {
          id: newId,
          product_id: productId,
          unit_name: u.unit_name,
          quantity: u.quantity,
          price: u.price,
          wholesale_price: u.wholesale_price,
          is_deleted: false,
          created_at: now,
          updated_at: now,
          version: 1,
          updated_by: devId
        };
        updatedUnits.push(newU);
        this.addToSyncQueue('units', String(newId), 'INSERT', newU);
      }
    });

    this.saveList('sr_units', updatedUnits);
  }

  private _syncAliasesLocal(productId: number, aliases: string[]) {
    const dbAliases = this.getList<any>('sr_product_aliases');
    const devId = this.getSetting('device_id') || 'unknown';
    const now = new Date().toISOString();

    // 1. Remove/mark deleted any aliases for this product that are no longer present
    const updatedAliases = dbAliases.map((a: any) => {
      if (a.product_id === productId) {
        const matchingNewAlias = aliases.find(na => na.toLowerCase() === a.alias.toLowerCase());
        if (!matchingNewAlias) {
          const deletePayload = { ...a, is_deleted: true, updated_at: now, updated_by: devId };
          this.addToSyncQueue('product_aliases', String(a.id), 'DELETE', deletePayload);
          return deletePayload;
        }
      }
      return a;
    });

    // 2. Add or update active aliases
    aliases.forEach((a: string) => {
      const idx = updatedAliases.findIndex(da => da.product_id === productId && da.alias.toLowerCase() === a.toLowerCase());
      if (idx !== -1) {
        const prev = updatedAliases[idx];
        updatedAliases[idx] = {
          ...prev,
          is_deleted: false,
          updated_at: now,
          version: (prev.version || 1) + 1,
          updated_by: devId
        };
        this.addToSyncQueue('product_aliases', String(prev.id), 'UPDATE', updatedAliases[idx]);
      } else {
        const newId = this._nextId(updatedAliases);
        const newA = {
          id: newId,
          product_id: productId,
          alias: a,
          is_deleted: false,
          created_at: now,
          updated_at: now,
          version: 1,
          updated_by: devId
        };
        updatedAliases.push(newA);
        this.addToSyncQueue('product_aliases', String(newId), 'INSERT', newA);
      }
    });

    this.saveList('sr_product_aliases', updatedAliases);
  }

  private _syncBarcodesLocal(productId: number, activeBarcodes: string[]) {
    const dbBarcodes = this.getList<Barcode>('sr_barcodes');
    const devId = this.getSetting('device_id') || 'unknown';
    const now = new Date().toISOString();
    
    // 1. Remove/mark deleted any barcodes for this product that are no longer in activeBarcodes
    const filtered = dbBarcodes.filter(b => {
      if (b.product_id === productId && !activeBarcodes.includes(b.barcode)) {
        const deletePayload = { ...b, is_deleted: true, updated_at: now, updated_by: devId };
        this.addToSyncQueue('barcodes', String(b.id), 'DELETE', deletePayload);
        return false;
      }
      return true;
    });

    // 2. Add any barcodes from activeBarcodes that do not exist yet for this product
    for (const barcodeCode of activeBarcodes) {
      const exists = filtered.some(b => b.barcode === barcodeCode && b.product_id === productId);
      if (!exists) {
        const newId = this._nextId(filtered);
        const newB = {
          id: newId,
          product_id: productId,
          barcode: barcodeCode,
          barcode_type: 'EAN-13',
          is_system: barcodeCode.toLowerCase().startsWith('sys-'),
          is_active: true,
          created_at: now,
          updated_at: now,
          version: 1,
          updated_by: devId
        };
        filtered.push(newB);
        this.addToSyncQueue('barcodes', String(newId), 'INSERT', newB);
        this.saveBarcodeMasterEntry({ barcode: barcodeCode, product_name: '', brand: '', source: 'local' }).catch(() => {});
      }
    }
    this.saveList('sr_barcodes', filtered);
  }

  async updateProductStock(_productId: number, _qtyToReduce: number): Promise<boolean> {
    return true;
  }

  async deleteProduct(productId: number): Promise<void> {
    const products = this.getList<Product>('sr_products');
    const idx = products.findIndex(p => p.id === productId);
    if (idx !== -1) {
      const prev = products[idx];
      products.splice(idx, 1);
      this.saveList('sr_products', products);

      // Hard delete associated barcodes
      let barcodes = this.getList<any>('sr_barcodes');
      const associatedBarcodes = barcodes.filter(b => b.product_id === productId);
      if (associatedBarcodes.length > 0) {
        barcodes = barcodes.filter(b => b.product_id !== productId);
        this.saveList('sr_barcodes', barcodes);
        for (const b of associatedBarcodes) {
          this.addToSyncQueue('barcodes', String(b.id), 'DELETE', b);
        }
      }

      this.addAuditLog('products', 'DELETE', prev, null, String(productId));
      this.addToSyncQueue('products', String(productId), 'DELETE', prev);

      // Rehydrate products cache
      this.rehydrateSingleProduct(productId);

      if (this.supabase) {
        this.supabase.from('products').delete().eq('id', productId);
        this.supabase.from('barcodes').delete().eq('product_id', productId);
      }
    }
  }

  async restoreProduct(productId: number): Promise<void> {
    const products = this.getList<Product>('sr_products');
    const idx = products.findIndex(p => p.id === productId);
    if (idx !== -1) {
      const devId = this.getSetting('device_id') || 'unknown';
      products[idx].is_deleted = false;
      products[idx].deleted_at = undefined;
      products[idx].updated_at = new Date().toISOString();
      products[idx].version = (products[idx].version || 1) + 1;
      products[idx].updated_by = devId;
      this.saveList('sr_products', products);
      this.addAuditLog('products', 'RESTORE', null, products[idx], String(productId));
      this.addToSyncQueue('products', String(productId), 'UPDATE', products[idx]);

      // Rehydrate products cache
      this.rehydrateSingleProduct(productId);

      if (this.supabase) {
        this.supabase.from('products').update({ is_deleted: false, updated_by: devId }).eq('id', productId);
      }
    }
  }

  async findProductByBarcode(barcode: string): Promise<Product | null> {
    const lookupStartedAt = Date.now();
    const clean = barcode.trim();
    const dbBarcodes = this.getList<Barcode>('sr_barcodes');
    const variants = [clean];
    if (clean.length === 13 && clean.startsWith('0')) variants.push(clean.substring(1));
    else if (clean.length === 12) variants.push('0' + clean);

    // Search Order:
    // 1. manufacturer_barcode (non-system barcodes)
    let match = dbBarcodes.find(b => variants.includes(b.barcode.trim()) && b.is_active && !b.is_deleted && !b.is_system);

    // 2. internal_barcode (system barcodes)
    if (!match) {
      match = dbBarcodes.find(b => variants.includes(b.barcode.trim()) && b.is_active && !b.is_deleted && b.is_system);
    }

    // 3. barcode_aliases (fallback to any matching barcode)
    if (!match) {
      match = dbBarcodes.find(b => variants.includes(b.barcode.trim()) && b.is_active && !b.is_deleted);
    }

    if (!match) {
      console.log('[BarcodeLookup]', {
        barcode_value: clean,
        barcode_length: clean.length,
        lookup_result: 'Not Found',
        lookup_time: `${Date.now() - lookupStartedAt}ms`,
      });
      return null;
    }

    const products = this.getList<Product>('sr_products');
    const prod = products.find(p => p.id === match.product_id && !p.is_deleted);
    if (!prod) {
      console.log('[BarcodeLookup]', {
        barcode_value: clean,
        barcode_length: clean.length,
        lookup_result: 'Barcode Found, Product Missing',
        lookup_time: `${Date.now() - lookupStartedAt}ms`,
      });
      return null;
    }

    const activeBList = dbBarcodes.filter(b => b.product_id === prod.id && b.is_active && !b.is_deleted);
    const vendorBarcodes = activeBList.filter(b => !b.is_system).map(b => b.barcode);
    const allBarcodes = activeBList.map(b => b.barcode);
    const aliasesList = this.getList<any>('sr_product_aliases');
    const unitsList = this.getList<any>('sr_units');
    const hydrated = {
      ...prod,
      barcode: vendorBarcodes[0] || '',
      barcodes: allBarcodes,
      aliases: aliasesList.filter((a: any) => a.product_id === prod.id && !a.is_deleted).map((a: any) => a.alias),
      units: unitsList.filter((u: any) => u.product_id === prod.id && !u.is_deleted),
    };
    (hydrated as any).scanned_unit = match.unit;
    console.log('[BarcodeLookup]', {
      barcode_value: clean,
      barcode_format: match.barcode_type,
      barcode_length: clean.length,
      lookup_result: 'Success',
      product_id: prod.id,
      lookup_time: `${Date.now() - lookupStartedAt}ms`,
    });
    return hydrated;
  }

  async findProductsByBarcode(barcode: string): Promise<Product[]> {
    const lookupStartedAt = Date.now();
    const clean = barcode.trim();
    const dbBarcodes = this.getList<Barcode>('sr_barcodes');
    const variants = [clean];
    if (clean.length === 13 && clean.startsWith('0')) variants.push(clean.substring(1));
    else if (clean.length === 12) variants.push('0' + clean);

    const matches = dbBarcodes.filter(b => variants.includes(b.barcode.trim()) && b.is_active && !b.is_deleted);
    if (matches.length === 0) {
      console.log('[BarcodeLookupAll]', {
        barcode_value: clean,
        barcode_length: clean.length,
        lookup_result: 'Not Found',
        lookup_time: `${Date.now() - lookupStartedAt}ms`,
      });
      return [];
    }

    const products = this.getList<Product>('sr_products');
    const results: Product[] = [];
    
    for (const match of matches) {
      const prod = products.find(p => p.id === match.product_id && !p.is_deleted);
      if (prod) {
        const activeBList = dbBarcodes.filter(b => b.product_id === prod.id && b.is_active && !b.is_deleted);
        const vendorBarcodes = activeBList.filter(b => !b.is_system).map(b => b.barcode);
        const allBarcodes = activeBList.map(b => b.barcode);
        const aliasesList = this.getList<any>('sr_product_aliases');
        const unitsList = this.getList<any>('sr_units');
        
        const hydrated = {
          ...prod,
          barcode: vendorBarcodes[0] || '',
          barcodes: allBarcodes,
          aliases: aliasesList.filter((a: any) => a.product_id === prod.id && !a.is_deleted).map((a: any) => a.alias),
          units: unitsList.filter((u: any) => u.product_id === prod.id && !u.is_deleted),
        };
        (hydrated as any).scanned_unit = match.unit;
        results.push(hydrated);
      }
    }

    console.log('[BarcodeLookupAll]', {
      barcode_value: clean,
      barcode_length: clean.length,
      lookup_result: `Found ${results.length} product(s)`,
      lookup_time: `${Date.now() - lookupStartedAt}ms`,
    });
    return results;
  }

  async searchProducts(query: string): Promise<Product[]> {
    const cleanQuery = query.toLowerCase().trim();
    if (!cleanQuery) return [];
    if (!this.isCacheLoaded) {
      await this.rebuildProductsCache();
    }
    const products = this.productsCache;
    const barcodeMatch = products.filter(p => p.barcodes?.includes(cleanQuery) || p.barcode === cleanQuery);
    if (barcodeMatch.length) return barcodeMatch;
    const exactMatch = products.filter(p => p.display_name.toLowerCase() === cleanQuery);
    if (exactMatch.length) return exactMatch;
    return products.filter(p =>
      p.display_name.toLowerCase().includes(cleanQuery) ||
      p.aliases?.some(a => a.toLowerCase().includes(cleanQuery))
    );
  }

  // ─── BARCODES ────────────────────────────────────────────

  async getBarcodes(): Promise<Barcode[]> {
    return this.getList<Barcode>('sr_barcodes').filter(b => !b.is_deleted);
  }

  async addBarcode(productId: number, barcode: string, type = 'EAN-13', unit?: string, is_system?: boolean): Promise<Barcode> {
    const dbBarcodes = this.getList<Barcode>('sr_barcodes');
    const devId = this.getSetting('device_id') || 'unknown';
    const existing = dbBarcodes.find(b => b.barcode === barcode && b.product_id === productId);
    if (existing) {
      existing.is_active = true;
      existing.is_deleted = false;
      existing.updated_at = new Date().toISOString();
      existing.version = (existing.version || 1) + 1;
      existing.updated_by = devId;
      if (unit !== undefined) existing.unit = unit;
      if (is_system !== undefined) existing.is_system = is_system;
      this.saveList('sr_barcodes', dbBarcodes);
      this.addToSyncQueue('barcodes', String(existing.id), 'UPDATE', existing);
      if (this.supabase) this.supabase.from('barcodes').upsert({ ...existing });
      return existing;
    }
    const newId = this._nextId(dbBarcodes);
    const newB: Barcode = { 
      id: newId, 
      product_id: productId, 
      barcode, 
      barcode_type: type, 
      is_active: true,
      unit,
      is_system: !!is_system,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
      updated_by: devId
    };
    dbBarcodes.push(newB);
    this.saveList('sr_barcodes', dbBarcodes);
    this.addToSyncQueue('barcodes', String(newId), 'INSERT', newB);
    if (this.supabase) this.supabase.from('barcodes').insert(newB);
    return newB;
  }

  async deleteBarcode(barcode: string, productId?: number): Promise<void> {
    const dbBarcodes = this.getList<Barcode>('sr_barcodes');
    const idx = dbBarcodes.findIndex(b => b.barcode === barcode && (productId === undefined || b.product_id === productId));
    if (idx !== -1) {
      const devId = this.getSetting('device_id') || 'unknown';
      dbBarcodes[idx].is_deleted = true;
      dbBarcodes[idx].is_active  = false;
      dbBarcodes[idx].updated_at = new Date().toISOString();
      dbBarcodes[idx].version    = (dbBarcodes[idx].version || 1) + 1;
      dbBarcodes[idx].updated_by = devId;
      this.saveList('sr_barcodes', dbBarcodes);
      this.addToSyncQueue('barcodes', String(dbBarcodes[idx].id), 'UPDATE', dbBarcodes[idx]);
      if (this.supabase) {
        const query = this.supabase.from('barcodes').update({ is_deleted: true, is_active: false, updated_by: devId }).eq('barcode', barcode);
        if (productId !== undefined) {
          query.eq('product_id', productId);
        }
      }
    }
  }

  async reassignBarcode(barcode: string, targetProductId: number): Promise<void> {
    const dbBarcodes = this.getList<Barcode>('sr_barcodes');
    const idx = dbBarcodes.findIndex(b => b.barcode === barcode);
    if (idx !== -1) {
      const devId = this.getSetting('device_id') || 'unknown';
      dbBarcodes[idx].product_id = targetProductId;
      dbBarcodes[idx].is_active  = true;
      dbBarcodes[idx].is_deleted = false;
      dbBarcodes[idx].updated_at = new Date().toISOString();
      dbBarcodes[idx].version    = (dbBarcodes[idx].version || 1) + 1;
      dbBarcodes[idx].updated_by = devId;
      this.saveList('sr_barcodes', dbBarcodes);
      this.addToSyncQueue('barcodes', String(dbBarcodes[idx].id), 'UPDATE', dbBarcodes[idx]);
      if (this.supabase) this.supabase.from('barcodes').update({ product_id: targetProductId, is_active: true, updated_by: devId }).eq('barcode', barcode);
    } else {
      await this.addBarcode(targetProductId, barcode);
    }
  }

  // ─── BARCODE API LOOKUP ──────────────────────────────────

  async apiBarcodeLookup(barcode: string): Promise<{ barcode: string; product_name: string; brand: string; quantity: string } | null> {
    const cleanBarcode = barcode.trim();
    if (!cleanBarcode) return null;

    const localProduct = await this.findProductByBarcode(cleanBarcode);
    if (localProduct) return { barcode: cleanBarcode, product_name: localProduct.display_name, brand: '', quantity: '' };

    const cached = await this.findBarcodeMasterEntry(cleanBarcode);
    if (cached) return { barcode: cleanBarcode, product_name: cached.product_name, brand: cached.brand, quantity: '' };

    const fetchWithTimeout = async (url: string) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      try { const r = await fetch(url, { signal: ctrl.signal }); clearTimeout(t); return r; }
      catch (e) { clearTimeout(t); throw e; }
    };

    const providers = [
      { url: `https://world.openfoodfacts.org/api/v0/product/${cleanBarcode}.json`, parse: (d: any) => d?.status === 1 && d.product ? { name: d.product.product_name||'', brand: d.product.brands||'', qty: d.product.quantity||'', src: 'Open Food Facts' } : null },
      { url: `https://world.openbeautyfacts.org/api/v0/product/${cleanBarcode}.json`, parse: (d: any) => d?.status === 1 && d.product ? { name: d.product.product_name||'', brand: d.product.brands||'', qty: d.product.quantity||'', src: 'Open Beauty Facts' } : null },
      { url: `https://api.upcitemdb.com/prod/trial/lookup?upc=${cleanBarcode}`, parse: (d: any) => d?.code==='OK' && d.items?.[0] ? { name: d.items[0].title||'', brand: d.items[0].brand||'', qty: d.items[0].size||'', src: 'UPC Item DB' } : null },
    ];

    for (const p of providers) {
      try {
        const res = await fetchWithTimeout(p.url);
        if (res.ok) {
          const parsed = p.parse(await res.json());
          if (parsed && parsed.name) {
            await this.saveBarcodeMasterEntry({ barcode: cleanBarcode, product_name: parsed.name, brand: parsed.brand, source: parsed.src });
            return { barcode: cleanBarcode, product_name: parsed.name, brand: parsed.brand, quantity: parsed.qty };
          }
        }
      } catch { /* try next */ }
    }

    const barcodelookupKey = (import.meta as any).env?.VITE_BARCODELOOKUP_API_KEY || '';
    if (barcodelookupKey) {
      try {
        const res = await fetchWithTimeout(`https://api.barcodelookup.com/v3/products?barcode=${cleanBarcode}&key=${barcodelookupKey}`);
        if (res.ok) {
          const d = await res.json();
          if (d?.products?.[0]) {
            const name = d.products[0].title||''; const brand = d.products[0].brand||'';
            await this.saveBarcodeMasterEntry({ barcode: cleanBarcode, product_name: name, brand, source: 'Barcode Lookup' });
            return { barcode: cleanBarcode, product_name: name, brand, quantity: '' };
          }
        }
      } catch { /* ignore */ }
    }

    return null;
  }

  // ─── CUSTOMERS ───────────────────────────────────────────

  async getCustomers(): Promise<Customer[]> {
    return this.getList<Customer>('sr_customers').filter(c => !c.is_deleted);
  }

  async saveCustomer(customer: Omit<Customer, 'id'> & { id?: number }): Promise<Customer> {
    const customers = this.getList<Customer>('sr_customers');
    const now = new Date().toISOString();
    const devId = this.getSetting('device_id') || 'unknown';
    let saved: Customer | undefined;

    // Duplicate phone check
    const cleanPhone = customer.phone?.trim();
    if (cleanPhone && cleanPhone !== 'NA' && cleanPhone !== '') {
      const existing = customers.find(c => c.phone === cleanPhone && c.id !== customer.id && !c.is_deleted);
      if (existing) {
        existing.name = customer.name.trim();
        if (customer.total_bills)     existing.total_bills     = Math.max(existing.total_bills, customer.total_bills);
        if (customer.total_purchases) existing.total_purchases = Math.max(existing.total_purchases, customer.total_purchases);
        if (customer.last_visit)      existing.last_visit      = customer.last_visit;
        existing.updated_at = now; existing.version = (existing.version || 1) + 1;
        existing.updated_by = devId;
        this.saveList('sr_customers', customers);
        this.addToSyncQueue('customers', String(existing.id), 'UPDATE', existing);
        return existing;
      }
    }

    if (customer.id) {
      const idx = customers.findIndex(c => c.id === customer.id);
      if (idx !== -1) {
        const prev = customers[idx];
        customers[idx] = { ...prev, ...customer, updated_at: now, version: (prev.version || 1) + 1, updated_by: devId };
        saved = customers[idx];
      } else {
        saved = { ...customer, id: customer.id, updated_at: now, version: 1, updated_by: devId } as Customer;
        customers.push(saved);
      }
    } else {
      const newId = this._nextId(customers);
      saved = { ...customer, id: newId, created_at: now, updated_at: now, version: 1, updated_by: devId } as Customer;
      customers.push(saved);
      const khata = this.getKhataMap();
      if (khata[newId] === undefined) { khata[newId] = 0; this.setRawItem('sr_khata', JSON.stringify(khata)); }
    }

    this.saveList('sr_customers', customers);
    this.addToSyncQueue('customers', String(saved.id), customer.id ? 'UPDATE' : 'INSERT', saved);
    return saved;
  }

  async findCustomerByPhone(phone: string): Promise<Customer | null> {
    const customers = await this.getCustomers();
    return customers.find(c => c.phone === phone) || null;
  }

  // ─── BILLING ─────────────────────────────────────────────

  async getBills(): Promise<Bill[]> {
    return this.getList<Bill>('sr_bills').filter(b => !b.is_deleted);
  }

  async saveBill(billData: Omit<Bill, 'id' | 'bill_number' | 'created_at'>): Promise<Bill> {
    // ALWAYS WRITE LOCAL FIRST — this is the print-success hook
    const bills = this.getList<Bill>('sr_bills');
    const now   = new Date().toISOString();
    const todayStr = now.slice(0, 10).replace(/-/g, '');

    let finalBillId = (billData as any).bill_id || '';
    if (!finalBillId) {
      const todayBills = bills.filter(b => b.created_at?.slice(0, 10) === now.slice(0, 10));
      let seq = todayBills.length + 1;
      finalBillId = `BILL_${todayStr}_${String(seq).padStart(4, '0')}`;
      while (bills.some(b => b.bill_id === finalBillId)) {
        seq++;
        finalBillId = `BILL_${todayStr}_${String(seq).padStart(4, '0')}`;
      }
    } else if (bills.some(b => b.bill_id === finalBillId && !b.is_deleted)) {
      throw new Error(`Duplicate bill_id: '${finalBillId}' already exists.`);
    }

    const nextBillNum = bills.reduce((max, b) => b.bill_number > max ? b.bill_number : max, 1000) + 1;
    const newId = this._nextId(bills);

    const newBill: Bill = {
      ...billData, id: newId, bill_id: finalBillId,
      bill_number: nextBillNum, created_at: now, updated_at: now, version: 1
    };
    bills.push(newBill);
    this.saveList('sr_bills', bills);
    this.addAuditLog('bills', 'CREATE', null, { bill_id: finalBillId, grand_total: billData.grand_total }, String(newId));

    // Update customer stats + khata locally
    if (billData.customer_id) {
      const customers = this.getList<Customer>('sr_customers');
      const cIdx = customers.findIndex(c => c.id === billData.customer_id);
      if (cIdx !== -1) {
        customers[cIdx].total_bills     += 1;
        customers[cIdx].total_purchases += billData.grand_total;
        customers[cIdx].last_visit       = now;
        this.saveList('sr_customers', customers);
        this.addToSyncQueue('customers', String(customers[cIdx].id), 'UPDATE', customers[cIdx]);
      }
      if (billData.payment_mode === 'Credit') {
        await this.addKhataTransaction(billData.customer_id, billData.grand_total, 'Credit', `Credit Purchase - Bill #${nextBillNum}`, undefined, now, true);
      }
    }

    // Reduce stock locally
    for (const item of billData.items || []) {
      await this.updateProductStock(item.product_id, item.quantity);
    }

    // Clear draft
    this.clearDraft();

    // Enqueue for sync
    this.addToSyncQueue('bills', String(newId), 'INSERT', newBill);

    // Update frequency map in-memory and re-sort cache
    for (const item of billData.items || []) {
      this.productFreqMap.set(item.product_id, (this.productFreqMap.get(item.product_id) || 0) + item.quantity);
    }
    this.productsCache.sort((a, b) => (this.productFreqMap.get(b.id) || 0) - (this.productFreqMap.get(a.id) || 0));

    return newBill;
  }

  async cancelBill(billId: number): Promise<boolean> {
    const bills = this.getList<Bill>('sr_bills');
    const bill  = bills.find(b => b.id === billId);
    if (!bill || bill.status === 'Cancelled') return false;

    const prev = { ...bill };
    bill.status     = 'Cancelled';
    bill.updated_at = new Date().toISOString();
    bill.version    = (bill.version || 1) + 1;
    this.saveList('sr_bills', bills);
    this.addAuditLog('bills', 'CANCEL', prev, bill, String(billId));

    for (const item of bill.items || []) await this.updateProductStock(item.product_id, -item.quantity);
    if (bill.payment_mode === 'Credit' && bill.customer_id) {
      await this.addKhataTransaction(bill.customer_id, -bill.grand_total, 'Payment', `Reversal - Cancelled Bill #${bill.bill_number}`, undefined, undefined, true);
    }

    this.addToSyncQueue('bills', String(bill.id), 'UPDATE', bill);

    // Re-adjust frequency map in-memory and re-sort cache
    for (const item of bill.items || []) {
      const currentFreq = this.productFreqMap.get(item.product_id) || 0;
      this.productFreqMap.set(item.product_id, Math.max(0, currentFreq - item.quantity));
    }
    this.productsCache.sort((a, b) => (this.productFreqMap.get(b.id) || 0) - (this.productFreqMap.get(a.id) || 0));

    return true;
  }

  async undoBill(billId: number): Promise<boolean> {
    const bills = this.getList<Bill>('sr_bills');
    const bill  = bills.find(b => b.id === billId);
    if (!bill || bill.status !== 'Cancelled') return false;

    bill.status     = 'Completed';
    bill.updated_at = new Date().toISOString();
    bill.version    = (bill.version || 1) + 1;
    this.saveList('sr_bills', bills);

    for (const item of bill.items || []) await this.updateProductStock(item.product_id, item.quantity);
    if (bill.payment_mode === 'Credit' && bill.customer_id) {
      await this.addKhataTransaction(bill.customer_id, bill.grand_total, 'Credit', `Restored - Undo Cancel Bill #${bill.bill_number}`, undefined, undefined, true);
    }

    this.addToSyncQueue('bills', String(bill.id), 'UPDATE', bill);

    // Restore frequency map in-memory and re-sort cache
    for (const item of bill.items || []) {
      this.productFreqMap.set(item.product_id, (this.productFreqMap.get(item.product_id) || 0) + item.quantity);
    }
    this.productsCache.sort((a, b) => (this.productFreqMap.get(b.id) || 0) - (this.productFreqMap.get(a.id) || 0));

    return true;
  }

  async deleteBillPermanently(billId: number): Promise<boolean> {
    const bills = this.getList<Bill>('sr_bills');
    const idx   = bills.findIndex(b => b.id === billId);
    if (idx === -1) return false;
    const bill = bills[idx];
    bill.is_deleted = true; bill.deleted_at = new Date().toISOString();
    bill.updated_at = new Date().toISOString(); bill.version = (bill.version || 1) + 1;
    this.saveList('sr_bills', bills);
    this.addAuditLog('bills', 'SOFT_DELETE', { id: billId }, null, String(billId));
    this.addToSyncQueue('bills', String(billId), 'UPDATE', bill);

    return true;
  }

  async updateBill(updatedBill: Bill): Promise<boolean> {
    const bills = this.getList<Bill>('sr_bills');
    const idx = bills.findIndex(b => b.id === updatedBill.id);
    if (idx === -1) return false;

    const oldBill = bills[idx];
    let finalCustId = updatedBill.customer_id;

    if (updatedBill.customer_name && updatedBill.customer_name !== 'Customer') {
      const phoneVal = updatedBill.customer_phone || 'NA';
      if (phoneVal !== 'NA') {
        const match = await this.findCustomerByPhone(phoneVal);
        if (!match) {
          const newCust = await this.saveCustomer({ name: updatedBill.customer_name, phone: phoneVal, total_bills: 0, total_purchases: 0 });
          finalCustId = newCust.id;
        } else { finalCustId = match.id; }
      }
    }
    updatedBill.customer_id = finalCustId;
    updatedBill.updated_at  = new Date().toISOString();
    updatedBill.version     = (oldBill.version || 1) + 1;

    if (oldBill.status !== 'Cancelled') {
      if (oldBill.payment_mode === 'Credit' && oldBill.customer_id)
        await this.addKhataTransaction(oldBill.customer_id, -oldBill.grand_total, 'Payment', `Reversal - Updated Bill #${oldBill.bill_number}`, undefined, undefined, true);
      if (updatedBill.payment_mode === 'Credit' && updatedBill.customer_id && updatedBill.status !== 'Cancelled')
        await this.addKhataTransaction(updatedBill.customer_id, updatedBill.grand_total, 'Credit', `Updated Bill #${updatedBill.bill_number}`, undefined, undefined, true);
    }

    bills[idx] = updatedBill;
    this.saveList('sr_bills', bills);
    this.addToSyncQueue('bills', String(updatedBill.id), 'UPDATE', updatedBill);
    return true;
  }

  // ─── KHATA ───────────────────────────────────────────────

  private getKhataMap(): Record<number, number> {
    try { return JSON.parse(this.getRawItem('sr_khata') || '{}'); } catch { return {}; }
  }

  async getKhataBalances(): Promise<KhataRecord[]> {
    const khataMap = this.getKhataMap();
    const customers = await this.getCustomers();
    return customers.map(c => ({
      customer_id: c.id, customer_name: c.name, customer_phone: c.phone,
      balance: khataMap[c.id] || 0, last_updated: new Date().toISOString()
    }));
  }

  getCustomerKhataSnapshot(customerId?: number, billCreatedAt?: string, billGrandTotal?: number): { prevDue: number; newDue: number } {
    if (!customerId) return { prevDue: 0, newDue: 0 };
    const khataMap = this.getKhataMap();
    const currentBalance = khataMap[customerId] || 0;
    if (!billCreatedAt) return { prevDue: currentBalance, newDue: currentBalance + (billGrandTotal || 0) };
    const txs = this.getList<KhataTransaction>('sr_khata_txs');
    const billTime = new Date(billCreatedAt).getTime();
    const prevDue = txs
      .filter(t => t.customer_id === customerId && new Date(t.created_at).getTime() < billTime && !t.is_deleted)
      .reduce((sum, t) => sum + t.amount, 0);
    return { prevDue, newDue: prevDue + (billGrandTotal || 0) };
  }

  async getKhataTransactions(customerId: number): Promise<KhataTransaction[]> {
    const txs = this.getList<KhataTransaction>('sr_khata_txs');
    return txs
      .filter(t => t.customer_id === customerId && !t.is_deleted)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  async addKhataTransaction(
    customerId: number, amount: number, type: 'Credit' | 'Payment',
    description: string, imageUrl?: string, createdAt?: string,
    skipQueue = false
  ): Promise<void> {
    const nowStr = createdAt || new Date().toISOString();
    const devId = this.getSetting('device_id') || 'unknown';

    // Update local khata map
    const khataMap = this.getKhataMap();
    khataMap[customerId] = (khataMap[customerId] || 0) + amount;
    this.setRawItem('sr_khata', JSON.stringify(khataMap));

    // Append transaction
    const txs = this.getList<KhataTransaction>('sr_khata_txs');
    const newId = this._nextId(txs);
    const newTx: KhataTransaction = {
      id: newId, customer_id: customerId, amount, transaction_type: type,
      description, image_url: imageUrl, created_at: nowStr,
      updated_at: nowStr, version: 1, updated_by: devId
    };
    txs.push(newTx);
    this.saveList('sr_khata_txs', txs);

    if (!skipQueue) {
      this.addToSyncQueue('khata_transactions', String(newId), 'INSERT', newTx);

      // Background push

    }
  }

  // ─── SETTINGS ────────────────────────────────────────────

  getSetting(key: string, defaultValue = ''): string {
    try {
      const settings = JSON.parse(this.getRawItem('sr_settings') || '{}');
      return settings[key] !== undefined ? settings[key] : defaultValue;
    } catch { return defaultValue; }
  }

  setSetting(key: string, value: string): void {
    const settings = JSON.parse(this.getRawItem('sr_settings') || '{}');
    settings[key] = value;
    this.setRawItem('sr_settings', JSON.stringify(settings));
    // Sync non-credential settings to cloud
    

  }

  // ─── DRAFT ───────────────────────────────────────────────

  getDraft(): any | null {
    try { const d = this.getRawItem('sr_draft_bill'); return d ? JSON.parse(d) : null; } catch { return null; }
  }
  saveDraft(draftData: any): void {
    const json = JSON.stringify(draftData);
    this.setRawItem('sr_draft_bill', json);
    this.setRawItem('draft_bill.json', json);
  }
  clearDraft(): void {
    this.removeRawItem('sr_draft_bill');
    this.removeRawItem('draft_bill.json');
  }

  // ─── VOICE PHRASE CACHE ──────────────────────────────────

  async getVoiceCache(): Promise<VoiceCacheEntry[]> {
    return this.getList<VoiceCacheEntry>('sr_voice_cache').filter(v => !v.is_deleted);
  }

  async saveVoiceCacheEntry(entry: Omit<VoiceCacheEntry, 'id'>): Promise<void> {
    const cleanPhrase = entry.phrase.toLowerCase().trim();
    const now = new Date().toISOString();
    const devId = this.getSetting('device_id') || 'unknown';
    const cache = this.getList<VoiceCacheEntry>('sr_voice_cache');
    const existingIdx = cache.findIndex(c => c.phrase.toLowerCase().trim() === cleanPhrase);

    if (existingIdx !== -1) {
      const e = cache[existingIdx];
      cache[existingIdx] = { ...e, ...entry, usage_count: (e.usage_count || 1) + 1, last_used: now, updated_at: now, version: (e.version || 1) + 1, updated_by: devId };
      this.saveList('sr_voice_cache', cache);
      this.addToSyncQueue('voice_phrase_cache', String(e.id), 'UPDATE', cache[existingIdx]);
    } else {
      const newId = this._nextId(cache as { id: number }[]);
      const newEntry = { ...entry, id: newId, phrase: cleanPhrase, usage_count: 1, last_used: now, updated_at: now, version: 1, updated_by: devId };
      cache.push(newEntry);
      this.saveList('sr_voice_cache', cache);
      this.addToSyncQueue('voice_phrase_cache', String(newId), 'INSERT', newEntry);
    }


  }

  async findVoiceCacheEntry(phrase: string): Promise<VoiceCacheEntry | null> {
    const clean = phrase.toLowerCase().trim();
    const cache = await this.getVoiceCache();
    return cache.find(c => c.phrase.toLowerCase().trim() === clean) || null;
  }

  // ─── VOICE MEMORY ────────────────────────────────────────

  async getVoiceMemory(): Promise<VoiceMemoryEntry[]> {
    return this.getList<VoiceMemoryEntry>('sr_voice_memory').filter(v => !v.is_deleted);
  }

  async saveVoiceMemory(entry: Omit<VoiceMemoryEntry, 'id'>): Promise<void> {
    const cleanKey = entry.key.toLowerCase().trim();
    const now = new Date().toISOString();
    const devId = this.getSetting('device_id') || 'unknown';
    const memory = this.getList<VoiceMemoryEntry>('sr_voice_memory');
    const existingIdx = memory.findIndex(v => v.key.toLowerCase().trim() === cleanKey);

    if (existingIdx !== -1) {
      const e = memory[existingIdx];
      memory[existingIdx] = { ...e, ...entry, key: cleanKey, updated_at: now, version: (e.version || 1) + 1, updated_by: devId };
      this.saveList('sr_voice_memory', memory);
      this.addToSyncQueue('voice_memory', String(e.id), 'UPDATE', memory[existingIdx]);
    } else {
      const newId = this._nextId(memory as { id: number }[]);
      const newEntry = { ...entry, id: newId, key: cleanKey, updated_at: now, version: 1, updated_by: devId };
      memory.push(newEntry);
      this.saveList('sr_voice_memory', memory);
      this.addToSyncQueue('voice_memory', String(newId), 'INSERT', newEntry);
    }


  }

  // ─── VOICE LOGS ───────────────────────────────────────────

  async saveVoiceLog(log: Omit<VoiceLog, 'id'>): Promise<void> {
    const now = new Date().toISOString();
    const logs = this.getList<VoiceLog>('sr_voice_logs');
    const newId = this._nextId(logs as { id: number }[]);
    const fullLog = { ...log, id: newId, created_at: now };
    logs.push(fullLog);
    // Keep only the last 500 logs to prevent unbounded growth
    if (logs.length > 500) logs.splice(0, logs.length - 500);
    this.saveList('sr_voice_logs', logs);

    // Sync to cloud
    const devId = this.getSetting('device_id') || 'unknown';
    const queuePayload = { raw_input: log.transcript, resolved_to: log.final_product_id, confidence: log.confidence / 100, device_id: devId, created_at: now };
    this.addToSyncQueue('voice_logs', String(newId), 'INSERT', queuePayload);
  }

  async getVoiceLogs(): Promise<VoiceLog[]> {
    return this.getList<VoiceLog>('sr_voice_logs').slice(-200);
  }

  // ─── VOICE CORRECTIONS ────────────────────────────────────

  async getVoiceCorrections(): Promise<VoiceCorrection[]> {
    return this.getList<VoiceCorrection>('sr_voice_corrections');
  }

  async saveVoiceCorrection(phrase: string, wrongProductId: number, correctProductId: number): Promise<void> {
    const cleanPhrase = phrase.toLowerCase().trim();
    const now = new Date().toISOString();
    const devId = this.getSetting('device_id') || 'unknown';
    const corrections = this.getList<VoiceCorrection>('sr_voice_corrections');
    const idx = corrections.findIndex(
      c => c.phrase === cleanPhrase &&
           c.wrong_product_id === wrongProductId &&
           c.correct_product_id === correctProductId
    );
    let entry: VoiceCorrection;
    if (idx !== -1) {
      corrections[idx].count = (corrections[idx].count || 1) + 1;
      corrections[idx].last_used = now;
      corrections[idx].updated_by = devId;
      entry = corrections[idx];
    } else {
      const newId = this._nextId(corrections as { id: number }[]);
      entry = { id: newId, phrase: cleanPhrase, wrong_product_id: wrongProductId, correct_product_id: correctProductId, count: 1, last_used: now, updated_by: devId };
      corrections.push(entry);
    }
    this.saveList('sr_voice_corrections', corrections);
    this.addToSyncQueue('voice_corrections', String(entry.id), idx !== -1 ? 'UPDATE' : 'INSERT', entry);
    if (this.supabase) {
      this.supabase.from('voice_corrections').upsert({
        phrase: cleanPhrase,
        wrong_product_id: wrongProductId,
        correct_product_id: correctProductId,
        count: entry.count,
        last_used: now,
        updated_by: devId
      });
    }
  }

  // ─── BARCODE MASTER CACHE ────────────────────────────────


  async getBarcodeMaster(): Promise<BarcodeMasterEntry[]> {
    return this.getList<BarcodeMasterEntry>('sr_barcode_master');
  }

  async saveBarcodeMasterEntry(entry: BarcodeMasterEntry): Promise<void> {
    const cleanB = entry.barcode.trim();
    const now = entry.created_at || new Date().toISOString();
    const cache = this.getList<BarcodeMasterEntry>('sr_barcode_master');
    const idx = cache.findIndex(c => c.barcode.trim() === cleanB);
    if (idx !== -1) { cache[idx] = { ...entry, created_at: now }; }
    else             { cache.push({ ...entry, created_at: now }); }
    this.saveList('sr_barcode_master', cache);
    if (this.supabase) {
      this.supabase.from('barcode_master').upsert({ barcode: cleanB, product_name: entry.product_name, brand: entry.brand, source: entry.source });
    }
  }

  async findBarcodeMasterEntry(barcode: string): Promise<BarcodeMasterEntry | null> {
    const clean = barcode.trim();
    const cache = this.getList<BarcodeMasterEntry>('sr_barcode_master');
    return cache.find(c => c.barcode.trim() === clean) || null;
  }

  // ─── PRINT JOBS ──────────────────────────────────────────

  getPrintJobs(): PrintJob[] {
    return this.getList<PrintJob>('sr_print_jobs');
  }

  async createPrintJob(job: Omit<PrintJob, 'id' | 'created_at' | 'updated_at'>): Promise<PrintJob> {
    const jobs = this.getPrintJobs();
    const newId = this._nextId(jobs as { id: number }[]);
    const now = new Date().toISOString();
    const newJob: PrintJob = { ...job, id: newId, created_at: now, updated_at: now };
    jobs.push(newJob);
    this.saveList('sr_print_jobs', jobs);
    // Immediately push to Supabase (print jobs need low latency)
    if (this.supabase) {
      this.supabase.from('print_jobs').insert({
        id: newId,
        bill_id: newJob.bill_id,
        device_id: newJob.device_id,
        host_device_id: newJob.host_device_id || null,
        status: newJob.status,
        reason: newJob.reason || null,
        created_at: now,
        updated_at: now
      }).then(({ error }) => {
        if (error) console.error('[DBService] Failed to push print job immediately:', error);
      });
    }
    return newJob;
  }

  async updatePrintJobStatus(jobId: number, status: PrintJobStatus, reason?: string): Promise<void> {
    const jobs = this.getPrintJobs();
    const idx = jobs.findIndex(j => j.id === jobId);
    const now = new Date().toISOString();
    if (idx !== -1) {
      jobs[idx].status = status;
      jobs[idx].updated_at = now;
      if (reason !== undefined) jobs[idx].reason = reason;
      this.saveList('sr_print_jobs', jobs);
    }
    // Fire-and-forget cloud update
    if (this.supabase) {
      // Try to find the Supabase numeric id from a remote lookup if local id is synthetic
      this.supabase.from('print_jobs')
        .update({ status, reason: reason || null, updated_at: now })
        .eq('id', jobId);
    }
  }

  getMyPrintJob(billId: string): PrintJob | null {
    const jobs = this.getPrintJobs();
    // Return latest job for this bill_id
    const matching = jobs.filter(j => j.bill_id === billId);
    if (!matching.length) return null;
    return matching.sort((a, b) =>
      new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    )[0];
  }

  getPendingJobsForHost(hostDeviceId: string): PrintJob[] {
    return this.getPrintJobs().filter(
      j => j.host_device_id === hostDeviceId && j.status === 'PENDING'
    );
  }

  private _mergePrintJobsFromRemote(remoteJobs: any[]): void {
    const local = this.getPrintJobs();
    const localMap = new Map(local.map(j => [j.id!, j]));
    for (const remote of remoteJobs) {
      const localJob = localMap.get(remote.id);
      if (!localJob) {
        localMap.set(remote.id, remote as PrintJob);
      } else {
        // Remote always wins for status updates (host is authoritative)
        const remoteTime = new Date(remote.updated_at || 0).getTime();
        const localTime  = new Date(localJob.updated_at || 0).getTime();
        if (remoteTime >= localTime) {
          localMap.set(remote.id, { ...remote } as PrintJob);
        }
      }
    }
    this.saveList('sr_print_jobs', Array.from(localMap.values()));
  }

  // ─── DAILY BACKUP ────────────────────────────────────────

  async runDailyBackup(): Promise<void> {
    if (!this.supabase) return;
    const lastBackup = this.getSetting('last_backup_date', '');
    const today = new Date().toISOString().slice(0, 10);
    if (lastBackup === today) return;

    try {
      // Try server-side RPC first
      const { error } = await this.supabase.rpc('backup_database_to_storage');
      if (!error) {
        this.setSetting('last_backup_date', today);
        console.log('[Backup] Server-side daily backup triggered for', today);
        return;
      }
    } catch { /* fall through to client backup */ }

    // Client-side fallback
    try {
      const tables = ['categories','products','barcodes','product_aliases','units','unit_conversions',
        'customers','bills','bill_items','khata','khata_transactions','voice_phrase_cache',
        'voice_memory','barcode_master','settings','audit_logs'];
      const backup: Record<string, any> = { backup_date: today };
      for (const t of tables) {
        const { data } = await this.supabase.from(t).select('*');
        backup[t] = data || [];
      }
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const { error: uploadErr } = await this.supabase.storage
        .from('backups')
        .upload(`backup_${today.replace(/-/g,'_')}.json`, blob, { upsert: true });
      if (!uploadErr) {
        this.setSetting('last_backup_date', today);
        console.log('[Backup] Client-side daily backup completed for', today);
      }
    } catch (err) {
      console.error('[Backup] Client-side backup failed:', err);
    }
  }
}

export const db = new DBService();
db.init();

