import assert from 'node:assert/strict';
import fs from 'node:fs';

const defaultPayload = 'upi://pay?pa=gpay-11232240371@okbizaxis&pn=Sai%20Ram%20Kirana&tn=undefined&am=undefined';

const printerService = fs.readFileSync('src/utils/printerService.ts', 'utf8');
const store = fs.readFileSync('src/store.ts', 'utf8');
const db = fs.readFileSync('src/db.ts', 'utf8');
const schema = fs.readFileSync('../supabase/schema.sql', 'utf8');

assert.match(printerService, new RegExp(defaultPayload.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
const amVal = new URL(defaultPayload).searchParams.get('am');
assert.ok(!amVal || amVal === 'undefined', 'Default UPI QR must not include a valid amount');
assert.match(printerService, /const isUPIPayment = bill\.payment_mode === 'UPI'/);
assert.match(printerService, /\.qrCode\(upiPayload/);
assert.match(printerService, /if \(!isUPIPayment \|\| !upiPayload\) return '';/);
assert.match(printerService, /if \(!cleanInput\) return DEFAULT_UPI_QR_PAYLOAD;/);
assert.match(printerService, /if \(\/\^upi:\\\/\\\/pay\\\?\/i\.test\(cleanInput\)\)/);

assert.match(store, /DEFAULT_UPI_QR_PAYLOAD/);
assert.match(store, /LEGACY_DEFAULT_UPI_ID/);
assert.match(db, /normalizeUPISetting/);
assert.match(schema, new RegExp(defaultPayload.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

console.log('UPI QR checks passed.');
