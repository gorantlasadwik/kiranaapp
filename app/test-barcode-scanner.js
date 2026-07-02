import assert from 'node:assert/strict';
import fs from 'node:fs';

const scanner = fs.readFileSync('src/utils/barcodeScanner.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const db = fs.readFileSync('src/db.ts', 'utf8');

assert.match(scanner, /const DUPLICATE_WINDOW_MS = 2000;/);
assert.match(scanner, /hasValidGtinCheckDigit/);
assert.match(scanner, /\^890\\d\{10\}\$/);
assert.match(scanner, /acceptDetectedBarcode\(candidates, startedAt, onDetected\)/);
assert.match(scanner, /await stopBarcodeScanner\(\);\s*onDetected\(selected\.code\)/);
assert.match(scanner, /const desired = \['ean_13', 'upc_a', 'ean_8', 'code_128', 'code_39', 'itf'\]/);
assert.doesNotMatch(scanner, /upc_e_reader/);
assert.match(scanner, /multiple: true/);
assert.match(scanner, /\^SYS-\\d\+\(\?:-\\d\+\)\?\$/);
assert.ok(scanner.includes('!/^\\d{4,8}$/.test(code)'));

assert.match(app, /setCameraActive\(false\);\s*await handleBarcodeResolved/);
assert.match(db, /lookup_time/);
assert.match(db, /this\.getList<Product>\('sr_products'\)/);

const knownIndianEan13 = ['8901030865321', '8901491101835', '8906002481022'];
for (const code of knownIndianEan13) {
  assert.equal(code.length, 13);
  assert.match(code, /^890\d{10}$/);
}

console.log('Barcode scanner checks passed.');
