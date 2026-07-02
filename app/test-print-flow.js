import assert from 'assert';
import fs from 'fs';

const hostManager = fs.readFileSync('src/utils/printerHostManager.ts', 'utf8');
const store = fs.readFileSync('src/store.ts', 'utf8');
const db = fs.readFileSync('src/db.ts', 'utf8');

assert.match(hostManager, /PRINTER_HOST_STALE_AFTER_MS\s*=\s*15_000/);
assert.match(hostManager, /PRINT_JOB_ACK_TIMEOUT_MS\s*=\s*2_000/);
assert.match(hostManager, /getPrinterHostAvailability/);
assert.match(hostManager, /throw new Error\('NO_PRINTER_CONNECTED'\)/);

assert.match(store, /getPrinterHostAvailability\(350\)/);
assert.match(store, /Date\.now\(\) - start < PRINT_JOB_TOTAL_TIMEOUT_MS/);
assert.match(store, /Host unavailable: no ACK within 2 seconds/);
assert.doesNotMatch(store, /isThisDeviceHost\(\)\s*\|\|\s*!getCurrentHost\(\)/);

assert.match(db, /id:\s*newId/);
assert.match(db, /Failed to push print job immediately/);

console.log('Printer flow checks passed.');
