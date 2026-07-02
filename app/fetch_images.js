import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import google from 'googlethis';
import Tesseract from 'tesseract.js';

// Prevent tesseract.js background worker thread crashes from stopping the scraper
process.on('uncaughtException', (err) => {
  console.warn('⚠️ Global Uncaught Exception (Captured to prevent crash):', err.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.warn('⚠️ Global Unhandled Rejection (Captured to prevent crash):', reason);
});

// ─── LOAD ENVIRONMENT VARIABLES ───
function loadEnv() {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) {
    console.error('Error: .env file not found in current folder!');
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w\-]+)\s*=\s*(.*)\s*$/);
    if (match) {
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
      }
      env[match[1]] = val;
    }
  });
  return env;
}

const env = loadEnv();
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Error: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing in .env!');
  process.exit(1);
}

console.log('Initializing Supabase client...');
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─── HELPERS ───
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─── INDIAN SHOPPING DOMAINS (bonus signal) ───
// CDNs that actually allow direct image download (no hotlink blocking)
const PREFERRED_DOMAINS = [
  'cdn.grofers.com',                      // Blinkit CDN ✔️
  'instamart-media-assets.swiggy.com',    // Swiggy Instamart CDN ✔️
  'm.media-amazon.com',                   // Amazon CDN ✔️
  'images-eu.ssl-images-amazon.com',      // Amazon EU CDN ✔️
  'images-na.ssl-images-amazon.com',      // Amazon NA CDN ✔️
  'zepto.com',                            // Zepto ✔️
  'zeptonow.com',                         // Zepto CDN ✔️
  'media.zeptonow.com',                   // Zepto CDN ✔️
];

const INDIAN_DOMAINS = [
  ...PREFERRED_DOMAINS,
  'bigbasket.com', 'jiomart.com', 'blinkit.com', 'flipkart.com',
  'relianceretail.com', 'meesho.com', 'dmart.in', 'snapdeal.com',
  '1mg.com', 'netmeds.com', 'pharmeasy.in', 'truemeds.in', 'apollo247.in'
];

// ─── HARD REJECTION KEYWORDS ───
const REJECT_KEYWORDS = [
  'back view', 'rear view', 'nutrition facts', 'nutrition label', 'ingredients list',
  'barcode only', 'label only', 'side view', 'vector art', 'illustration', 'clipart',
  'pack of 6', 'pack of 12', 'pack of 24', 'combo pack', 'bundle deal',
  'family pack', 'set of', 'multipack', 'value pack', 'twin pack', 'triple pack',
  'pack of 4', 'pack of 3', 'pack of 2', 'pack of 8', 'combo', 'bundle',
  'logo', 'brand logo', 'icon', 'svg', 'vector',
  'us packaging', 'uk packaging', 'arabic', 'export pack', 'malaysia', 'indonesia'
];

const BLACKLISTED_KEYWORDS = [
  'cosmetics', 'makeup', 'lipstick', 'eyeliner', 'mascara', 'salon',
  'automobile', 'car', 'bike', 'honda', 'toyota', 'maruti', 'ford',
  'invoice', 'template', 'receipt',
  'openfoodfacts.org'
];

const GENERIC_WORDS = new Set([
  'soap', 'oil', 'paste', 'gel', 'powder', 'tea', 'coffee', 'shampoo', 'rice',
  'salt', 'sugar', 'milk', 'water', 'drink', 'juice', 'cream', 'face', 'wash',
  'hand', 'liquid', 'bar', 'detergent', 'bottle', 'pack', 'product', 'price',
  'online', 'india', 'buy', 'shop', 'new', 'best', 'get'
]);

// ─── PRODUCT TYPE HINTS ───
function getProductTypeHint(name) {
  const typeHints = [
    { words: ['dove', 'cinthol', 'margo', 'medimix', 'santoor', 'pears', 'lifebuoy', 'godrej no 1'], hint: 'soap' },
    { words: ['freedom', 'gold drop', 'aadhar', 'alpha palm', 'sunpure', 'til sona'], hint: 'oil' },
    { words: ['maggi', 'yippee'], hint: 'noodles' },
    { words: ['parle', 'britannia', 'sunfeast'], hint: 'biscuit' },
    { words: ['aashirvaad', 'ashirwad'], hint: 'atta' },
    { words: ['colgate', 'closeup', 'dabur red', 'babool', 'sensodyne', 'dant kanti', 'meswak'], hint: 'toothpaste' },
    { words: ['ariel', 'surf excel', 'tide', 'rin', 'ghadhi', 'ghadi', 'wheel'], hint: 'detergent' },
    { words: ['dettol', 'yuthika lemon'], hint: 'handwash' },
    { words: ['harpic', 'lazol', 'lizol', 'colin'], hint: 'cleaner' },
    { words: ['boost', 'horlicks'], hint: 'health drink' },
    { words: ['amulya', 'amul', 'milkmaid'], hint: 'milk powder' },
    { words: ['cycle', 'agarbatti', 'sleepwell', 'zed black'], hint: 'agarbatti' },
    { words: ['apis'], hint: 'honey' },
    { words: ['bambino'], hint: 'samiyaa' },
    { words: ['haldiram'], hint: 'namkeen snack' }
  ];
  const lower = name.toLowerCase();
  for (const group of typeHints) {
    if (group.words.some(w => lower.includes(w))) {
      return group.hint;
    }
  }
  return null;
}

// ─── QUANTITY EXTRACTION ───
function extractQuantities(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const results = [];
  const patterns = [
    { re: /(\d+(?:\.\d+)?)\s*(litre|liter|liters|litres|ltr|ltrs|l)\b/gi, unit: 'l' },
    { re: /(\d+(?:\.\d+)?)\s*(millilitre|milliliter|ml)\b/gi, unit: 'ml' },
    { re: /(\d+(?:\.\d+)?)\s*(kilogram|kilogramme|kg|kgs)\b/gi, unit: 'kg' },
    { re: /(\d+(?:\.\d+)?)\s*(gram|gramme|gm|gms|gr)\b(?!s)/gi, unit: 'g' },
  ];
  for (const { re, unit } of patterns) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(lower)) !== null) {
      results.push({ num: parseFloat(m[1]), unit });
    }
  }
  return results;
}

function normalizeToBase(qty) {
  if (qty.unit === 'l')  return { value: qty.num * 1000, unit: 'ml' };
  if (qty.unit === 'ml') return { value: qty.num, unit: 'ml' };
  if (qty.unit === 'kg') return { value: qty.num * 1000, unit: 'g' };
  return { value: qty.num, unit: qty.unit };
}

function quantitiesMatch(q1, q2) {
  const b1 = normalizeToBase(q1);
  const b2 = normalizeToBase(q2);
  if (b1.unit !== b2.unit) return false;
  return Math.abs(b1.value - b2.value) / Math.max(b1.value, b2.value) <= 0.05;
}

// ─── CLEAN PRODUCT NAME (remove price noise) ───
function cleanProductName(name) {
  if (!name) return '';
  let c = name.replace(/₹\s*\d+(?:\/-)?/g, '');
  c = c.replace(/\brs\.?\s*\d+(?:\/-)?/gi, '');
  c = c.replace(/\b\d+\s*\/\s*-?\b/g, '');
  c = c.replace(/[-\/\\^$*+?.()|[\]{}]/g, ' ');
  c = c.replace(/\s+/g, ' ').trim();
  return c;
}

// ─── SCORE AN IMAGE (Max 90 points, remaining 10 points are OCR) ───
function scoreImage(img, productName) {
  const title = (img.title || '').toLowerCase();
  const url   = (img.url   || '').toLowerCase();
  const combined = title + ' ' + url;
  const cleanedName = cleanProductName(productName).toLowerCase();

  // 1. Name Similarity (40 Points Max)
  const words = cleanedName.split(/\s+/).filter(w => w.length > 2);
  const specific = words.filter(w => !GENERIC_WORDS.has(w));
  const pool = specific.length > 0 ? specific : words;
  let nameScore = 0;
  if (pool.length > 0) {
    const matched = pool.filter(w => title.includes(w) || url.includes(w)).length;
    nameScore = Math.round((matched / pool.length) * 40);
  } else {
    nameScore = 20;
  }

  // 2. Quantity Match (25 Points Max)
  let qtyScore = 0;
  const productQtys = extractQuantities(productName);
  if (productQtys.length > 0) {
    const imageQtys = extractQuantities(combined);
    if (imageQtys.length > 0) {
      const hasMatch = productQtys.some(pq => imageQtys.some(iq => quantitiesMatch(pq, iq)));
      qtyScore = hasMatch ? 25 : 0;
    } else {
      qtyScore = 15; // neutral
    }
  } else {
    qtyScore = 25; // product has no quantity - neutral
  }

  // 3. Indian Domain Bonus (15 Points Max)
  let domainScore = 0;
  if (INDIAN_DOMAINS.some(d => url.includes(d))) {
    domainScore = 15;
  }

  // 4. Front Package / View Bonus & Penalties (5 Points Max)
  let frontScore = 3;
  const frontBonusWords = ['front', 'package', 'pack', 'bottle', 'product'];
  const backPenaltyWords = ['back', 'rear', 'side', 'ingredients', 'nutrition', 'label', 'barcode'];
  if (frontBonusWords.some(w => combined.includes(w))) frontScore += 2;
  if (backPenaltyWords.some(w => combined.includes(w))) frontScore -= 3;
  frontScore = Math.max(0, Math.min(5, frontScore));

  // 5. Resolution & Aspect Ratio Bonus (5 Points Max)
  let dimScore = 2;
  const w = img.width || 0;
  const h = img.height || 0;
  if (w > 0 && h > 0) {
    const ratio = w / h;
    const isSquareIsh = ratio >= 0.75 && ratio <= 1.35;
    const isExtreme = ratio > 2.0 || ratio < 0.5;
    const pixels = w * h;

    if (pixels >= 640000) dimScore += 3; // 800x800+
    else if (pixels >= 250000) dimScore += 2; // 500x500+
    else if (pixels < 40000) dimScore -= 2; // under 200x200

    if (isSquareIsh) dimScore += 1;
    if (isExtreme) dimScore -= 2;
  }
  dimScore = Math.max(0, Math.min(5, dimScore));

  return nameScore + qtyScore + domainScore + frontScore + dimScore;
}

// ─── HARD REJECTION CHECK ───
function isImageRejected(img, productName) {
  const title = (img.title || '').toLowerCase();
  const url = (img.url || '').toLowerCase();
  const combined = title + ' ' + url;

  if (REJECT_KEYWORDS.some(k => combined.includes(k))) return { rejected: true, reason: 'contains reject/logo/multipack/foreign keyword' };
  if (BLACKLISTED_KEYWORDS.some(k => combined.includes(k))) return { rejected: true, reason: 'blacklisted topic' };

  // 1. Strict quantity match/mismatch rejection
  const productQtys = extractQuantities(productName);
  if (productQtys.length > 0) {
    const imageQtys = extractQuantities(combined);
    if (imageQtys.length > 0) {
      const hasMatch = productQtys.some(pq => imageQtys.some(iq => quantitiesMatch(pq, iq)));
      if (!hasMatch) return { rejected: true, reason: `qty mismatch (need ${JSON.stringify(productQtys)}, got ${JSON.stringify(imageQtys)})` };
    }
  }

  // 2. Strict variant matching
  const COLOR_VARIANTS = ['pink', 'blue', 'green', 'red', 'yellow', 'white', 'lemon', 'orange', 'charcoal', 'neem', 'aloe', 'sandal'];
  const lowerProduct = productName.toLowerCase();
  const activeProductVariants = COLOR_VARIANTS.filter(v => lowerProduct.includes(v));
  if (activeProductVariants.length > 0) {
    const otherVariants = COLOR_VARIANTS.filter(v => !activeProductVariants.includes(v));
    const hasOtherVariant = otherVariants.some(v => {
      const re = new RegExp('\\b' + v + '\\b', 'i');
      return re.test(combined);
    });
    if (hasOtherVariant) {
      return { rejected: true, reason: `variant mismatch (product variant is ${activeProductVariants.join('/')})` };
    }
  }

  return { rejected: false };
}

// ─── DUCKDUCKGO IMAGE SEARCH (India locale) ───
async function searchDdgImages(query) {
  try {
    const mainRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    });
    if (!mainRes.ok) return [];
    const mainHtml = await mainRes.text();

    let vqd = '';
    const m1 = mainHtml.match(/vqd\s*=\s*['"]([^'"]+)['"]/i);
    if (m1) vqd = m1[1];
    else {
      const m2 = mainHtml.match(/vqd=([\w.-]+)/);
      if (m2) vqd = m2[1];
    }
    if (!vqd) { console.warn(`    DDG: could not extract vqd for "${query}"`); return []; }

    const imgRes = await fetch(
      `https://duckduckgo.com/i.js?l=in-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://duckduckgo.com/' } }
    );
    if (!imgRes.ok) return [];
    const data = await imgRes.json();
    return (data.results || []).map(r => ({ url: r.image, title: r.title, width: r.width, height: r.height }));
  } catch (e) {
    console.warn(`    DDG search failed for "${query}":`, e.message);
    return [];
  }
}

// ─── GOOGLE IMAGE SEARCH (India geo-targeted) ───
async function searchGoogleImages(query) {
  try {
    const images = await google.image(query, {
      safe: false,
      additional_params: { gl: 'IN', hl: 'en-IN', cr: 'countryIN' }
    });
    return (images || []).map(img => ({
      url:    img.url,
      title:  img.origin ? img.origin.title : '',
      width:  img.width  || 0,
      height: img.height || 0
    }));
  } catch (e) {
    console.warn(`    Google search failed for "${query}":`, e.message);
    return [];
  }
}

// ─── SAVE IMAGE TO SUPABASE ───
async function saveImageToSupabase(buffer, ct, prod, sourceLabel) {
  let ext = 'jpg';
  if (ct.includes('png')) ext = 'png';
  else if (ct.includes('webp')) ext = 'webp';

  const filename = `prod_${prod.id}_${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('product-images')
    .upload(filename, buffer, { contentType: ct, upsert: true });

  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

  const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(filename);
  const publicUrl = urlData.publicUrl;

  // Delete old image from storage
  if (prod.image_url) {
    try {
      const parts = prod.image_url.split('/product-images/');
      if (parts.length > 1) await supabase.storage.from('product-images').remove([decodeURIComponent(parts[1])]);
    } catch (_) {}
  }

  // Save to DB with bumped version (forces client sync)
  const nowString = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('products')
    .update({
      image_url: publicUrl,
      image_source: sourceLabel,
      image_last_updated: nowString,
      updated_at: nowString,
      version: (prod.version || 0) + 1
    })
    .eq('id', prod.id);

  if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);

  console.log(`      ✅ SUCCESS! Saved: ${filename}`);
  return true;
}

// ─── DOWNLOAD ONE IMAGE URL ───
// Returns { buffer, ct } on success, null on failure
async function tryDownloadUrl(url) {
  try {
    const imgRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': 'https://www.google.com/'
      },
      signal: AbortSignal.timeout(6000)
    });
    if (!imgRes.ok) { console.warn(`        ↳ HTTP ${imgRes.status}`); return null; }
    const ct = imgRes.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) { console.warn(`        ↳ Not image (${ct.slice(0,30)})`); return null; }
    const buffer = await imgRes.arrayBuffer();
    if (buffer.byteLength < 2000) { console.warn(`        ↳ Too small (${buffer.byteLength} bytes)`); return null; }
    return { buffer, ct };
  } catch (e) {
    console.warn(`        ↳ ${e.message.slice(0, 50)}`);
    return null;
  }
}

// ─── TRY SOURCE: PREFERRED CDN SITES FIRST, THEN BEST SCORED, DOWNLOAD TOP 3, RUN OCR, PICK BEST ───
async function trySourceWithScoring(results, prod, sourceLabel) {
  if (!results || results.length === 0) return false;

  // Rejection-filter & score all candidates (non-OCR base scores)
  const scored = [];
  for (const img of (results || [])) {
    const rejection = isImageRejected(img, prod.display_name);
    if (rejection.rejected) continue;
    const score = scoreImage(img, prod.display_name);
    scored.push({ img, score });
  }

  if (scored.length === 0) {
    console.log(`      ↳ No relevant candidates — escalating to next source.`);
    return false;
  }

  scored.sort((a, b) => b.score - a.score);

  // Take up to 3 candidates, prioritizing preferred domains first
  let targets = scored.filter(({ img }) =>
    PREFERRED_DOMAINS.some(d => (img.url || '').toLowerCase().includes(d))
  ).slice(0, 3);

  // Fill up to 3 from non-preferred candidates if needed
  if (targets.length < 3) {
    const nonPreferred = scored.filter(({ img }) =>
      !PREFERRED_DOMAINS.some(d => (img.url || '').toLowerCase().includes(d))
    );
    const needed = 3 - targets.length;
    targets = [...targets, ...nonPreferred.slice(0, needed)];
  }

  // Download all target candidates
  const downloadedTargets = [];
  for (const item of targets) {
    console.log(`      ↳ Downloading candidate for OCR: ${(item.img.url || '').slice(0, 80)}`);
    const downloaded = await tryDownloadUrl(item.img.url);
    if (downloaded) {
      downloadedTargets.push({
        img: item.img,
        baseScore: item.score,
        buffer: downloaded.buffer,
        ct: downloaded.ct
      });
    }
  }

  if (downloadedTargets.length === 0) {
    console.log(`      ↳ Failed to download any of the top candidates.`);
    return false;
  }

  // Run OCR on downloaded candidates to calculate final score
  const finalCandidates = [];
  for (const item of downloadedTargets) {
    let ocrScore = 0; // Max 10 points
    const isWebpOrGif = item.ct.includes('webp') || item.ct.includes('gif');

    if (isWebpOrGif) {
      console.log(`        ↳ Skipping OCR on webp/gif to prevent decoder crashes. Giving neutral OCR score.`);
      ocrScore = 5;
    } else {
      try {
        const { data: { text } } = await Tesseract.recognize(
          Buffer.from(item.buffer),
          'eng'
        );
        const cleanedOcr = (text || '').toLowerCase();

        // OCR Name Match (6 points max)
        const cleanedName = cleanProductName(prod.display_name).toLowerCase();
        const nameWords = cleanedName.split(/\s+/).filter(w => w.length > 2 && !GENERIC_WORDS.has(w));
        if (nameWords.length > 0) {
          const matchedWords = nameWords.filter(w => cleanedOcr.includes(w)).length;
          ocrScore += Math.round((matchedWords / nameWords.length) * 6);
        } else {
          ocrScore += 3;
        }

        // OCR Quantity Match (4 points max)
        const productQtys = extractQuantities(prod.display_name);
        if (productQtys.length > 0) {
          const ocrQtys = extractQuantities(cleanedOcr);
          if (ocrQtys.length > 0) {
            const ocrQtyMatch = productQtys.some(pq => ocrQtys.some(oq => quantitiesMatch(pq, oq)));
            if (ocrQtyMatch) {
              ocrScore += 4;
            } else {
              // Strict Mismatch penalty if other quantities detected
              ocrScore -= 15;
            }
          } else {
            ocrScore += 2; // neutral if no quantity read on package text
          }
        } else {
          ocrScore += 4; // neutral
        }

        console.log(`        [OCR Read]: "${cleanedOcr.replace(/\s+/g, ' ').slice(0, 100)}" | OCR Score Bonus: ${ocrScore}`);
      } catch (e) {
        console.warn(`        [OCR Failed]: ${e.message}`);
        ocrScore = 3;
      }
    }

    const finalScore = item.baseScore + ocrScore;
    finalCandidates.push({
      img: item.img,
      buffer: item.buffer,
      ct: item.ct,
      score: finalScore
    });
  }

  // Sort by final score
  finalCandidates.sort((a, b) => b.score - a.score);
  const best = finalCandidates[0];
  console.log(`      🥇 Best candidate (final score=${best.score}): ${(best.img.url || '').slice(0, 80)}`);

  try {
    return await saveImageToSupabase(best.buffer, best.ct, prod, sourceLabel);
  } catch (e) {
    console.warn(`      ↳ Save error: ${e.message} — escalating to next source.`);
    return false;
  }
}



// ─── MAIN ───
async function run() {
  console.log('Fetching products and barcodes from Supabase...\n');

  const { data: products, error } = await supabase
    .from('products')
    .select('id, display_name, image_source, image_url, version, updated_at')
    .eq('is_deleted', false);
  if (error) { console.error('Failed to fetch products:', error.message); process.exit(1); }

  const { data: barcodes, error: barcodeErr } = await supabase
    .from('barcodes')
    .select('product_id, barcode')
    .eq('is_deleted', false);
  if (barcodeErr) { console.error('Failed to fetch barcodes:', barcodeErr.message); process.exit(1); }

  const barcodeMap = {};
  if (barcodes) barcodes.forEach(b => { if (!barcodeMap[b.product_id]) barcodeMap[b.product_id] = b.barcode; });

  let filteredProducts = products;
  if (process.env.TEST_LIMIT) {
    filteredProducts = products.filter(p => p.display_name.toLowerCase().includes(process.env.TEST_LIMIT.toLowerCase()));
    console.log(`TEST MODE: Limited to ${filteredProducts.length} matching products.`);
  }

  const total = filteredProducts.length;
  console.log(`Starting smart image fetch for ${total} products...\n`);

  let successCount = 0;

  for (let idx = 0; idx < filteredProducts.length; idx++) {
    const prod = filteredProducts[idx];
    const barcode = barcodeMap[prod.id];
    const cleanedName = cleanProductName(prod.display_name);
    const hint = getProductTypeHint(cleanedName);
    const searchName = hint && !cleanedName.toLowerCase().includes(hint) ? `${cleanedName} ${hint}` : cleanedName;
    const hasValidBarcode = barcode && !barcode.toLowerCase().startsWith('sys');
    const isCommodity = !hasValidBarcode;

    console.log(`\n[${idx + 1}/${total}] ${prod.display_name}${hasValidBarcode ? ` [${barcode}]` : ' [commodity]'}`);

    let ok = false;

    // ─ Step 1: DDG barcode search ─
    if (hasValidBarcode && !ok) {
      console.log(`  Step 1: DDG barcode: ${barcode}`);
      ok = await trySourceWithScoring(await searchDdgImages(barcode), prod, 'DDG_BARCODE');
    }

    // ─ Step 2: Google barcode search ─
    if (hasValidBarcode && !ok) {
      console.log(`  Step 2: Google barcode: ${barcode}`);
      ok = await trySourceWithScoring(await searchGoogleImages(barcode), prod, 'GOOGLE_BARCODE');
    }

    // ─ Step 3: Google name + barcode ─
    if (hasValidBarcode && !ok) {
      const q = `${searchName} ${barcode}`;
      console.log(`  Step 3: Google name+barcode: "${q}"`);
      ok = await trySourceWithScoring(await searchGoogleImages(q), prod, 'GOOGLE_NAME_BARCODE');
    }

    // ─ Step 4: DDG name + barcode ─
    if (hasValidBarcode && !ok) {
      const q = `${searchName} ${barcode}`;
      console.log(`  Step 4: DDG name+barcode: "${q}"`);
      ok = await trySourceWithScoring(await searchDdgImages(q), prod, 'DDG_NAME_BARCODE');
    }

    // ─ Step 5: Google product name ─
    if (!ok) {
      const nameQ = isCommodity
        ? `${cleanedName} bowl white background India`
        : `${searchName} front package India`;
      console.log(`  Step 5: Google name: "${nameQ}"`);
      ok = await trySourceWithScoring(await searchGoogleImages(nameQ), prod, 'GOOGLE_NAME');
    }

    // ─ Step 6: DDG product name ─
    if (!ok) {
      const nameQ = isCommodity
        ? `${cleanedName} bowl white background India`
        : `${searchName} front package India`;
      console.log(`  Step 6: DDG name: "${nameQ}"`);
      ok = await trySourceWithScoring(await searchDdgImages(nameQ), prod, 'DDG_NAME');
    }

    if (ok) {
      successCount++;
    } else {
      console.warn(`  ⚠️  No valid image found for: ${prod.display_name}`);
    }

    // Polite delay to avoid search engine blocking
    await sleep(1500);
  }

  console.log(`\n=================================================`);
  console.log(`Smart fetch complete! ${successCount}/${total} products updated.`);
  console.log(`All updated images will auto-sync to POS devices.`);
  console.log(`=================================================`);
}

run();
