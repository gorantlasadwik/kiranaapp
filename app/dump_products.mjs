import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  const content = fs.readFileSync(path.resolve('.env'), 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w\-]+)\s*=\s*(.*)\s*$/);
    if (match) {
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      env[match[1]] = val;
    }
  });
  return env;
}

const env = loadEnv();
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const { data: products } = await supabase
  .from('products')
  .select('id, display_name, category_id')
  .eq('is_deleted', false)
  .order('display_name');

const { data: barcodes } = await supabase
  .from('barcodes')
  .select('product_id, barcode')
  .eq('is_deleted', false);

const barcodeMap = {};
if (barcodes) barcodes.forEach(b => { if (!barcodeMap[b.product_id]) barcodeMap[b.product_id] = b.barcode; });

const rows = products.map(p => {
  const bc = barcodeMap[p.id] || '';
  const hasSys = bc.toLowerCase().startsWith('sys') || !bc;
  return `${hasSys ? 'COMMODITY' : 'BARCODE  '} | ${(bc || '').padEnd(16)} | ${p.display_name}`;
});

fs.writeFileSync('product_list.txt', rows.join('\n'), 'utf8');
console.log('Saved ' + rows.length + ' products to product_list.txt');
console.log('\nSample (first 30):');
rows.slice(0, 30).forEach(r => console.log(r));
