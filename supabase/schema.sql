-- ============================================================
-- Sai Ram Kirana POS — Complete PostgreSQL Schema
-- Offline-First + Cloud Sync Architecture
-- Version: 2.0
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- CLEANUP: Drop existing tables to avoid conflicts
-- ============================================================
DROP TABLE IF EXISTS cloud_sync_queue CASCADE;
DROP TABLE IF EXISTS print_jobs CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS barcode_master CASCADE;
DROP TABLE IF EXISTS voice_logs CASCADE;
DROP TABLE IF EXISTS voice_corrections CASCADE;
DROP TABLE IF EXISTS voice_memory CASCADE;
DROP TABLE IF EXISTS voice_phrase_cache CASCADE;
DROP TABLE IF EXISTS settings CASCADE;
DROP TABLE IF EXISTS devices CASCADE;
DROP TABLE IF EXISTS khata_transactions CASCADE;
DROP TABLE IF EXISTS khata CASCADE;
DROP TABLE IF EXISTS bill_items CASCADE;
DROP TABLE IF EXISTS bills CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS unit_conversions CASCADE;
DROP TABLE IF EXISTS units CASCADE;
DROP TABLE IF EXISTS product_aliases CASCADE;
DROP TABLE IF EXISTS barcodes CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS categories CASCADE;

-- ============================================================
-- HELPER: auto-update updated_at column
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  is_deleted  BOOLEAN DEFAULT FALSE NOT NULL,
  deleted_at  TIMESTAMP WITH TIME ZONE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version     INTEGER DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_unique_idx
  ON categories (name) WHERE (is_deleted = FALSE);
CREATE OR REPLACE TRIGGER categories_updated_at
  BEFORE UPDATE ON categories FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- PRODUCTS
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id              SERIAL PRIMARY KEY,
  display_name    VARCHAR(255) NOT NULL,
  category_id     INT REFERENCES categories(id) ON DELETE SET NULL,
  retail_price    DECIMAL(10,2) NOT NULL DEFAULT 0,
  wholesale_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  stock           DECIMAL(12,4) DEFAULT 100.0 NOT NULL,
  is_deleted      BOOLEAN DEFAULT FALSE NOT NULL,
  deleted_at      TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version         INTEGER DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS products_name_unique_idx
  ON products (display_name) WHERE (is_deleted = FALSE);
CREATE OR REPLACE TRIGGER products_updated_at
  BEFORE UPDATE ON products FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- BARCODES
-- ============================================================
CREATE TABLE IF NOT EXISTS barcodes (
  id           SERIAL PRIMARY KEY,
  product_id   INT REFERENCES products(id) ON DELETE CASCADE,
  barcode      VARCHAR(100) NOT NULL,
  barcode_type VARCHAR(50) DEFAULT 'EAN-13',
  unit         VARCHAR(100),
  is_system    BOOLEAN DEFAULT FALSE NOT NULL,
  is_active    BOOLEAN DEFAULT TRUE NOT NULL,
  is_deleted   BOOLEAN DEFAULT FALSE NOT NULL,
  deleted_at   TIMESTAMP WITH TIME ZONE,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version      INTEGER DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS barcodes_barcode_unique_idx
  ON barcodes (barcode) WHERE (is_deleted = FALSE);
CREATE OR REPLACE TRIGGER barcodes_updated_at
  BEFORE UPDATE ON barcodes FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- PRODUCT ALIASES
-- ============================================================
CREATE TABLE IF NOT EXISTS product_aliases (
  id         SERIAL PRIMARY KEY,
  product_id INT REFERENCES products(id) ON DELETE CASCADE,
  alias      VARCHAR(255) NOT NULL,
  is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version    INTEGER DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS product_aliases_alias_unique_idx
  ON product_aliases (alias) WHERE (is_deleted = FALSE);

-- ============================================================
-- UNITS
-- ============================================================
CREATE TABLE IF NOT EXISTS units (
  id         SERIAL PRIMARY KEY,
  product_id INT REFERENCES products(id) ON DELETE CASCADE,
  unit_name  VARCHAR(100) NOT NULL,
  quantity   DECIMAL(10,2) NOT NULL,
  price      DECIMAL(10,2) NOT NULL,
  is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version    INTEGER DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS units_product_unit_unique_idx
  ON units (product_id, unit_name) WHERE (is_deleted = FALSE);

-- ============================================================
-- UNIT CONVERSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS unit_conversions (
  id                SERIAL PRIMARY KEY,
  product_id        INT REFERENCES products(id) ON DELETE CASCADE,
  parent_unit       VARCHAR(100) NOT NULL,
  child_unit        VARCHAR(100) NOT NULL,
  conversion_factor DECIMAL(10,4) NOT NULL,
  is_deleted        BOOLEAN DEFAULT FALSE NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version           INTEGER DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS unit_conversions_unique_idx
  ON unit_conversions (product_id, parent_unit, child_unit) WHERE (is_deleted = FALSE);

-- ============================================================
-- INVENTORY (base-unit storage: grams for weight, ml for volume)
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory (
  id              SERIAL PRIMARY KEY,
  product_id      INT UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  quantity_base   DECIMAL(16,4) DEFAULT 0 NOT NULL, -- grams OR ml OR pieces
  unit_type       VARCHAR(20) DEFAULT 'piece' NOT NULL, -- 'weight'|'volume'|'piece'
  is_deleted      BOOLEAN DEFAULT FALSE NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version         INTEGER DEFAULT 1 NOT NULL
);
CREATE OR REPLACE TRIGGER inventory_updated_at
  BEFORE UPDATE ON inventory FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  phone           VARCHAR(20),
  last_visit      TIMESTAMP WITH TIME ZONE,
  total_bills     INT DEFAULT 0 NOT NULL,
  total_purchases DECIMAL(12,2) DEFAULT 0.00 NOT NULL,
  is_deleted      BOOLEAN DEFAULT FALSE NOT NULL,
  deleted_at      TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version         INTEGER DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique_idx
  ON customers (phone)
  WHERE (is_deleted = FALSE AND phone IS NOT NULL AND phone <> '' AND phone <> 'NA');
CREATE OR REPLACE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- BILLS
-- ============================================================
CREATE TABLE IF NOT EXISTS bills (
  id           SERIAL PRIMARY KEY,
  bill_number  INT NOT NULL,
  bill_id      VARCHAR(100) NOT NULL,
  customer_id  INT REFERENCES customers(id) ON DELETE SET NULL,
  subtotal     DECIMAL(10,2) NOT NULL,
  discount     DECIMAL(10,2) DEFAULT 0.00 NOT NULL,
  grand_total  DECIMAL(10,2) NOT NULL,
  payment_mode VARCHAR(50) NOT NULL CHECK (payment_mode IN ('Cash','UPI','Credit')),
  status       VARCHAR(50) DEFAULT 'Completed' NOT NULL CHECK (status IN ('Completed','Cancelled')),
  print_status VARCHAR(50) DEFAULT 'PRINTED' NOT NULL CHECK (print_status IN ('PRINTED','PRINT_PENDING','PRINT_SKIPPED')),
  is_deleted   BOOLEAN DEFAULT FALSE NOT NULL,
  deleted_at   TIMESTAMP WITH TIME ZONE,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version      INTEGER DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS bills_bill_number_unique_idx
  ON bills (bill_number) WHERE (is_deleted = FALSE);
CREATE UNIQUE INDEX IF NOT EXISTS bills_bill_id_unique_idx
  ON bills (bill_id) WHERE (is_deleted = FALSE);
CREATE OR REPLACE TRIGGER bills_updated_at
  BEFORE UPDATE ON bills FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- BILL ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS bill_items (
  id           SERIAL PRIMARY KEY,
  bill_id      INT REFERENCES bills(id) ON DELETE CASCADE,
  product_id   INT REFERENCES products(id) ON DELETE SET NULL,
  product_name VARCHAR(255),
  quantity     DECIMAL(10,2) NOT NULL,
  unit         VARCHAR(100) NOT NULL,
  price        DECIMAL(10,2) NOT NULL,
  total        DECIMAL(10,2) NOT NULL,
  is_deleted   BOOLEAN DEFAULT FALSE NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- PRINT JOBS (multi-device host printing queue)
-- ============================================================
CREATE TABLE IF NOT EXISTS print_jobs (
  id              BIGSERIAL PRIMARY KEY,
  bill_id         VARCHAR(100) NOT NULL,
  device_id       VARCHAR(255) NOT NULL,
  host_device_id  VARCHAR(255),
  status          VARCHAR(50) NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','PRINTING','PRINT_SUCCESS','PRINT_FAILED','NO_PRINTER_CONNECTED')),
  reason          TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS print_jobs_status_idx ON print_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS print_jobs_host_idx   ON print_jobs (host_device_id, status);
CREATE OR REPLACE TRIGGER print_jobs_updated_at
  BEFORE UPDATE ON print_jobs FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- KHATA BALANCES
-- ============================================================
CREATE TABLE IF NOT EXISTS khata (
  id           SERIAL PRIMARY KEY,
  customer_id  INT UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  balance      DECIMAL(12,2) DEFAULT 0.00 NOT NULL,
  is_deleted   BOOLEAN DEFAULT FALSE NOT NULL,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version      INTEGER DEFAULT 1 NOT NULL
);
CREATE OR REPLACE TRIGGER khata_updated_at
  BEFORE UPDATE ON khata FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- KHATA TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS khata_transactions (
  id               SERIAL PRIMARY KEY,
  customer_id      INT REFERENCES customers(id) ON DELETE CASCADE,
  amount           DECIMAL(12,2) NOT NULL,
  transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('Credit','Payment')),
  description      TEXT,
  image_url        TEXT,
  is_deleted       BOOLEAN DEFAULT FALSE NOT NULL,
  deleted_at       TIMESTAMP WITH TIME ZONE,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version          INTEGER DEFAULT 1 NOT NULL
);

-- ============================================================
-- DEVICES
-- ============================================================
CREATE TABLE IF NOT EXISTS devices (
  id              VARCHAR(100) PRIMARY KEY,
  device_id       VARCHAR(255) UNIQUE NOT NULL,
  device_name     VARCHAR(255) NOT NULL,
  android_version VARCHAR(50),
  app_version     VARCHAR(50),
  manufacturer    VARCHAR(100),
  status          VARCHAR(50) DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','revoked')),
  trusted_token   VARCHAR(255),
  requested_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  approved_at     TIMESTAMP WITH TIME ZONE,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version         INTEGER DEFAULT 1 NOT NULL
);

-- ============================================================
-- SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  key        VARCHAR(255) PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version    INTEGER DEFAULT 1 NOT NULL
);

-- ============================================================
-- VOICE PHRASE CACHE (confirmed mappings after bill print)
-- ============================================================
CREATE TABLE IF NOT EXISTS voice_phrase_cache (
  id          SERIAL PRIMARY KEY,
  phrase      VARCHAR(500) NOT NULL,
  product_id  INT REFERENCES products(id) ON DELETE CASCADE,
  quantity    DECIMAL(10,2) NOT NULL,
  unit        VARCHAR(100) NOT NULL,
  action      VARCHAR(50) DEFAULT 'ADD_ITEM',
  usage_count INT DEFAULT 1,
  last_used   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  is_deleted  BOOLEAN DEFAULT FALSE NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version     INTEGER DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS voice_phrase_unique_idx
  ON voice_phrase_cache (phrase) WHERE (is_deleted = FALSE);

-- ============================================================
-- VOICE MEMORY (persistent owner-defined mappings, multi-device)
-- ============================================================
CREATE TABLE IF NOT EXISTS voice_memory (
  id         SERIAL PRIMARY KEY,
  key        VARCHAR(500) NOT NULL,   -- normalized phrase key
  product_id INT REFERENCES products(id) ON DELETE CASCADE,
  quantity   DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit       VARCHAR(100) NOT NULL DEFAULT 'Piece',
  is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version    INTEGER DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS voice_memory_key_unique_idx
  ON voice_memory (key) WHERE (is_deleted = FALSE);

-- ============================================================
-- VOICE LOGS (raw input audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS voice_logs (
  id          SERIAL PRIMARY KEY,
  raw_input   TEXT NOT NULL,
  resolved_to INT REFERENCES products(id) ON DELETE SET NULL,
  confidence  DECIMAL(5,4),
  device_id   VARCHAR(255),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- VOICE CORRECTIONS (user-trained corrections)
-- ============================================================
CREATE TABLE IF NOT EXISTS voice_corrections (
  id                   SERIAL PRIMARY KEY,
  phrase               VARCHAR(500) NOT NULL,
  wrong_product_id     INT REFERENCES products(id) ON DELETE CASCADE,
  correct_product_id   INT REFERENCES products(id) ON DELETE CASCADE,
  count                INT DEFAULT 1,
  last_used            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  is_deleted           BOOLEAN DEFAULT FALSE NOT NULL,
  created_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version              INTEGER DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS voice_corrections_phrase_unique_idx
  ON voice_corrections (phrase, wrong_product_id, correct_product_id) WHERE (is_deleted = FALSE);


-- ============================================================
-- BARCODE MASTER (cached API lookups)
-- ============================================================
CREATE TABLE IF NOT EXISTS barcode_master (
  barcode      VARCHAR(100) PRIMARY KEY,
  product_name VARCHAR(255),
  brand        VARCHAR(255),
  source       VARCHAR(100),
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version      INTEGER DEFAULT 1 NOT NULL
);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  entity     VARCHAR(100) NOT NULL,   -- table name
  entity_id  VARCHAR(100),            -- record id
  action     VARCHAR(50) NOT NULL,    -- CREATE|UPDATE|DELETE|RESTORE|CONFLICT
  old_value  JSONB,
  new_value  JSONB,
  user_info  VARCHAR(255),
  device_id  VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- SYNC QUEUE (cloud mirror of local queue)
-- ============================================================
CREATE TABLE IF NOT EXISTS cloud_sync_queue (
  id          BIGSERIAL PRIMARY KEY,
  entity_type VARCHAR(100) NOT NULL,
  entity_id   VARCHAR(100) NOT NULL,
  operation   VARCHAR(50) NOT NULL CHECK (operation IN ('create','update','delete','restore')),
  payload     JSONB,
  status      VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','synced','failed')),
  retry_count INT DEFAULT 0,
  device_id   VARCHAR(255),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  synced_at   TIMESTAMP WITH TIME ZONE
);

-- ============================================================
-- TRIGGER: auto-create khata for new customer
-- ============================================================
CREATE OR REPLACE FUNCTION create_customer_khata()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO khata (customer_id, balance, is_deleted)
  VALUES (NEW.id, 0.00, FALSE)
  ON CONFLICT (customer_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_create_customer_khata ON customers;
CREATE TRIGGER trigger_create_customer_khata
  AFTER INSERT ON customers
  FOR EACH ROW EXECUTE FUNCTION create_customer_khata();

-- ============================================================
-- RPC: checkout_bill_v1 — Atomic checkout transaction
-- ============================================================
CREATE OR REPLACE FUNCTION checkout_bill_v1(
  p_bill_id      VARCHAR(100),
  p_customer_id  INT,
  p_customer_name VARCHAR(255),
  p_customer_phone VARCHAR(50),
  p_subtotal     DECIMAL(10,2),
  p_discount     DECIMAL(10,2),
  p_grand_total  DECIMAL(10,2),
  p_payment_mode VARCHAR(50),
  p_status       VARCHAR(50),
  p_items        JSONB,
  p_created_at   TIMESTAMP WITH TIME ZONE
) RETURNS JSONB AS $$
DECLARE
  v_bill_number INT;
  v_new_bill_id INT;
  v_item        RECORD;
  v_cust_id     INT := p_customer_id;
BEGIN
  -- Resolve or create customer
  IF v_cust_id IS NULL AND p_customer_name IS NOT NULL AND p_customer_name <> 'Customer'
     AND p_customer_phone IS NOT NULL AND p_customer_phone NOT IN ('', 'NA') THEN
    SELECT id INTO v_cust_id FROM customers
    WHERE phone = p_customer_phone AND is_deleted = FALSE LIMIT 1;
    IF v_cust_id IS NULL THEN
      INSERT INTO customers (name, phone, last_visit, total_bills, total_purchases)
      VALUES (p_customer_name, p_customer_phone, p_created_at, 0, 0.00)
      RETURNING id INTO v_cust_id;
    END IF;
  END IF;

  -- Next bill number
  SELECT COALESCE(MAX(bill_number), 1000) + 1 INTO v_bill_number FROM bills;

  -- Insert bill
  INSERT INTO bills (bill_number, bill_id, customer_id, subtotal, discount, grand_total,
                     payment_mode, status, created_at)
  VALUES (v_bill_number, p_bill_id, v_cust_id, p_subtotal, p_discount, p_grand_total,
          p_payment_mode, p_status, p_created_at)
  RETURNING id INTO v_new_bill_id;

  -- Insert items & reduce stock
  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items) AS x(
      product_id INT, product_name TEXT, quantity DECIMAL(10,2),
      unit VARCHAR(100), price DECIMAL(10,2), total DECIMAL(10,2)
    )
  LOOP
    INSERT INTO bill_items (bill_id, product_id, product_name, quantity, unit, price, total)
    VALUES (v_new_bill_id, v_item.product_id, v_item.product_name, v_item.quantity,
            v_item.unit, v_item.price, v_item.total);

    UPDATE products SET stock = stock - v_item.quantity WHERE id = v_item.product_id;
  END LOOP;

  -- Update customer stats
  IF v_cust_id IS NOT NULL THEN
    UPDATE customers
    SET total_bills = total_bills + 1,
        total_purchases = total_purchases + p_grand_total,
        last_visit = p_created_at
    WHERE id = v_cust_id;

    -- Credit khata
    IF p_payment_mode = 'Credit' THEN
      INSERT INTO khata (customer_id, balance, last_updated)
      VALUES (v_cust_id, p_grand_total, p_created_at)
      ON CONFLICT (customer_id) DO UPDATE
        SET balance = khata.balance + EXCLUDED.balance,
            last_updated = EXCLUDED.last_updated;

      INSERT INTO khata_transactions (customer_id, amount, transaction_type, description, created_at)
      VALUES (v_cust_id, p_grand_total, 'Credit',
              'Credit Purchase - Bill #' || v_bill_number, p_created_at);
    END IF;
  END IF;

  -- Audit
  INSERT INTO audit_logs (entity, entity_id, action, new_value)
  VALUES ('bills', v_new_bill_id::TEXT, 'CREATE',
          jsonb_build_object('bill_number', v_bill_number, 'grand_total', p_grand_total));

  RETURN jsonb_build_object(
    'id', v_new_bill_id,
    'bill_number', v_bill_number,
    'bill_id', p_bill_id,
    'customer_id', v_cust_id,
    'created_at', p_created_at
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RPC: cancel_bill_v1 — Atomic cancellation
-- ============================================================
CREATE OR REPLACE FUNCTION cancel_bill_v1(p_bill_id INT) RETURNS BOOLEAN AS $$
DECLARE
  v_bill RECORD;
  v_item RECORD;
BEGIN
  SELECT * INTO v_bill FROM bills
  WHERE id = p_bill_id AND status = 'Completed' AND is_deleted = FALSE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  UPDATE bills SET status = 'Cancelled' WHERE id = p_bill_id;

  FOR v_item IN SELECT product_id, quantity FROM bill_items WHERE bill_id = p_bill_id
  LOOP
    UPDATE products SET stock = stock + v_item.quantity WHERE id = v_item.product_id;
  END LOOP;

  IF v_bill.payment_mode = 'Credit' AND v_bill.customer_id IS NOT NULL THEN
    UPDATE khata SET balance = balance - v_bill.grand_total, last_updated = CURRENT_TIMESTAMP
    WHERE customer_id = v_bill.customer_id;

    INSERT INTO khata_transactions (customer_id, amount, transaction_type, description)
    VALUES (v_bill.customer_id, -v_bill.grand_total, 'Payment',
            'Reversal - Cancelled Bill #' || v_bill.bill_number);
  END IF;

  INSERT INTO audit_logs (entity, entity_id, action, old_value, new_value)
  VALUES ('bills', p_bill_id::TEXT, 'UPDATE',
          jsonb_build_object('status', 'Completed'),
          jsonb_build_object('status', 'Cancelled'));

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RPC: undo_cancel_bill_v1
-- ============================================================
CREATE OR REPLACE FUNCTION undo_cancel_bill_v1(p_bill_id INT) RETURNS BOOLEAN AS $$
DECLARE
  v_bill RECORD;
  v_item RECORD;
BEGIN
  SELECT * INTO v_bill FROM bills
  WHERE id = p_bill_id AND status = 'Cancelled' AND is_deleted = FALSE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  UPDATE bills SET status = 'Completed' WHERE id = p_bill_id;

  FOR v_item IN SELECT product_id, quantity FROM bill_items WHERE bill_id = p_bill_id
  LOOP
    UPDATE products SET stock = stock - v_item.quantity WHERE id = v_item.product_id;
  END LOOP;

  IF v_bill.payment_mode = 'Credit' AND v_bill.customer_id IS NOT NULL THEN
    UPDATE khata SET balance = balance + v_bill.grand_total, last_updated = CURRENT_TIMESTAMP
    WHERE customer_id = v_bill.customer_id;

    INSERT INTO khata_transactions (customer_id, amount, transaction_type, description)
    VALUES (v_bill.customer_id, v_bill.grand_total, 'Credit',
            'Restored - Undo Cancel Bill #' || v_bill.bill_number);
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RPC: pull_changes_since — Bidirectional sync pull
-- Returns all records modified after p_since timestamp
-- ============================================================
CREATE OR REPLACE FUNCTION pull_changes_since(p_since TIMESTAMP WITH TIME ZONE)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  result := jsonb_build_object(
    'products',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM products t WHERE t.updated_at > p_since),
    'barcodes',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM barcodes t WHERE t.updated_at > p_since),
    'product_aliases',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM product_aliases t WHERE t.updated_at > p_since),
    'units',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM units t WHERE t.updated_at > p_since),
    'unit_conversions',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM unit_conversions t WHERE t.updated_at > p_since),
    'customers',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM customers t WHERE t.updated_at > p_since),
    'bills',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM bills t WHERE t.updated_at > p_since),
    'bill_items',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM bill_items t WHERE t.created_at > p_since),
    'khata',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM khata t WHERE t.updated_at > p_since),
    'khata_transactions',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM khata_transactions t WHERE t.updated_at > p_since),
    'voice_phrase_cache',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM voice_phrase_cache t WHERE t.updated_at > p_since),
    'voice_memory',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM voice_memory t WHERE t.updated_at > p_since),
    'voice_corrections',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM voice_corrections t WHERE t.updated_at > p_since),
    'voice_logs',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM voice_logs t WHERE t.created_at > p_since),
    'barcode_master',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM barcode_master t WHERE t.updated_at > p_since),
    'categories',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM categories t WHERE t.updated_at > p_since),
    'settings',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM settings t WHERE t.updated_at > p_since),
    'print_jobs',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM print_jobs t WHERE t.updated_at > p_since),
    'pulled_at', CURRENT_TIMESTAMP
  );
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RPC: backup_database_to_storage — Daily backup trigger
-- ============================================================
CREATE OR REPLACE FUNCTION backup_database_to_storage()
RETURNS void AS $$
DECLARE
  backup_data JSONB;
  storage_url TEXT;
  anon_key    TEXT;
  file_name   TEXT;
  request_id  BIGINT;
BEGIN
  SELECT value INTO storage_url FROM settings WHERE key = 'supabase_url';
  SELECT value INTO anon_key FROM settings WHERE key = 'supabase_service_role_key';
  IF anon_key IS NULL THEN
    SELECT value INTO anon_key FROM settings WHERE key = 'supabase_anon_key';
  END IF;

  IF storage_url IS NULL OR anon_key IS NULL THEN
    RAISE WARNING '[Backup] Credentials not set. Skipping.';
    RETURN;
  END IF;

  file_name   := 'backup_' || to_char(CURRENT_DATE, 'YYYY_MM_DD') || '.json';
  storage_url := rtrim(storage_url, '/') || '/storage/v1/object/backups/' || file_name;

  backup_data := jsonb_build_object(
    'backup_date', CURRENT_DATE,
    'categories',          (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM categories t),
    'products',            (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM products t),
    'barcodes',            (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM barcodes t),
    'product_aliases',     (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM product_aliases t),
    'units',               (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM units t),
    'unit_conversions',    (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM unit_conversions t),
    'inventory',           (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM inventory t),
    'customers',           (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM customers t),
    'bills',               (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM bills t),
    'bill_items',          (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM bill_items t),
    'khata',               (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM khata t),
    'khata_transactions',  (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM khata_transactions t),
    'voice_phrase_cache',  (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM voice_phrase_cache t),
    'voice_memory',        (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM voice_memory t),
    'voice_corrections',   (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM voice_corrections t),
    'voice_logs',          (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM voice_logs t),
    'barcode_master',      (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM barcode_master t),
    'settings',            (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM settings t),
    'audit_logs',          (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM audit_logs t ORDER BY created_at DESC LIMIT 10000)
  );

  SELECT net.http_post(
    url     := storage_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || anon_key,
      'Content-Type',  'application/json',
      'x-upsert',      'true'
    ),
    body    := backup_data::text::bytea
  ) INTO request_id;

  RAISE NOTICE '[Backup] Triggered storage upload for %', file_name;
END;
$$ LANGUAGE plpgsql;

-- Schedule daily at 2:00 AM (wrapped in a safe block in case pg_cron extension is disabled/not preloaded)
DO $$
BEGIN
  -- Attempt to enable pg_cron if possible
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  
  -- Schedule the job
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-db-backup') THEN
    PERFORM cron.schedule(
      'daily-db-backup',
      '0 2 * * *',
      'SELECT backup_database_to_storage();'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron extension is not active or could not be loaded. Skipping daily backup cron schedule.';
END;
$$;


-- ============================================================
-- SEED DATA
-- ============================================================
INSERT INTO categories (id, name) VALUES
  (1,'weight'),(2,'volume'),(3,'cartoon'),(4,'bag'),(5,'tray'),(6,'box or pack'),(7,'sheet')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;



INSERT INTO settings (key, value) VALUES
  ('admin_password',        'Sairam@123'),
  ('store_name',            'Sai Ram Kirana'),
  ('upi_id',                'upi://pay?pa=gpay-11232240371@okbizaxis&pn=Sai%20Ram%20Kirana&tn=undefined&am=undefined'),
  ('qr_merchant_name',      'Sai Ram Kirana'),
  ('current_printer_host',  ''),
  ('printer_host_connected','false'),
  ('printer_host_last_seen','')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ============================================================
-- PRIVILEGES: Enable access for frontend client keys (anon & authenticated roles)
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
