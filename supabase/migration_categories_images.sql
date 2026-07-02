-- ============================================================
-- Sai Ram Kirana POS — Migration Script: Categories & Images
-- ============================================================

-- 1. Create the NEW UUID-based product categories table: catalog_categories
CREATE TABLE IF NOT EXISTS catalog_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  image_url     TEXT NULL,
  display_order INTEGER DEFAULT 0 NOT NULL,
  is_system     BOOLEAN DEFAULT FALSE NOT NULL,
  is_deleted    BOOLEAN DEFAULT FALSE NOT NULL,
  deleted_at    TIMESTAMP WITH TIME ZONE,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version       INTEGER DEFAULT 1 NOT NULL
);

-- Index for unique category names
CREATE UNIQUE INDEX IF NOT EXISTS catalog_categories_name_unique_idx
  ON catalog_categories (name) WHERE (is_deleted = FALSE);

-- Trigger to auto-update updated_at and version on catalog_categories
CREATE OR REPLACE TRIGGER catalog_categories_updated_at
  BEFORE UPDATE ON catalog_categories FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 2. Create the product_categories junction table
CREATE TABLE IF NOT EXISTS product_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    INT REFERENCES products(id) ON DELETE CASCADE,
  category_id   UUID REFERENCES catalog_categories(id) ON DELETE CASCADE,
  is_deleted    BOOLEAN DEFAULT FALSE NOT NULL,
  deleted_at    TIMESTAMP WITH TIME ZONE,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version       INTEGER DEFAULT 1 NOT NULL
);

-- Index for product categories lookups
CREATE INDEX IF NOT EXISTS product_categories_product_idx ON product_categories(product_id);
CREATE INDEX IF NOT EXISTS product_categories_category_idx ON product_categories(category_id);

-- Trigger to auto-update updated_at and version on product_categories
CREATE OR REPLACE TRIGGER product_categories_updated_at
  BEFORE UPDATE ON product_categories FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 3. Add image columns to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_source TEXT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_last_updated TIMESTAMP WITH TIME ZONE NULL;

-- 4. Update RPC: pull_changes_since to include new catalog_categories and product_categories
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
    'catalog_categories',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM catalog_categories t WHERE t.updated_at > p_since),
    'product_categories',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM product_categories t WHERE t.updated_at > p_since),
    'settings',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM settings t WHERE t.updated_at > p_since),
    'print_jobs',
      (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM print_jobs t WHERE t.updated_at > p_since),
    'pulled_at', CURRENT_TIMESTAMP
  );
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 5. Update RPC: backup_database_to_storage to back up catalog_categories and assignments
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
    'categories',             (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM categories t),
    'catalog_categories',     (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM catalog_categories t),
    'product_categories',      (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM product_categories t),
    'products',               (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM products t),
    'barcodes',               (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM barcodes t),
    'product_aliases',        (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM product_aliases t),
    'units',                  (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM units t),
    'unit_conversions',       (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM unit_conversions t),
    'inventory',              (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM inventory t),
    'customers',              (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM customers t),
    'bills',                  (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM bills t),
    'bill_items',             (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM bill_items t),
    'khata',                  (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM khata t),
    'khata_transactions',     (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM khata_transactions t),
    'voice_phrase_cache',     (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM voice_phrase_cache t),
    'voice_memory',           (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM voice_memory t),
    'voice_corrections',      (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM voice_corrections t),
    'voice_logs',             (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM voice_logs t),
    'barcode_master',         (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM barcode_master t),
    'settings',               (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM settings t),
    'audit_logs',             (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM audit_logs t ORDER BY created_at DESC LIMIT 10000)
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

-- Grant permissions on new tables to POS app roles
GRANT ALL ON TABLE catalog_categories TO anon, authenticated;
GRANT ALL ON TABLE product_categories TO anon, authenticated;
