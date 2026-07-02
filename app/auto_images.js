/**
 * auto_images.js — Smart AI Image Fetcher
 *
 * Pipeline per product:
 *
 * PHASE 1 — Barcode searches (only for real barcodes, not SYS-)
 *   Step 1: DDG  barcode
 *   Step 2: Google barcode
 *   → If both fail, go to Phase 2
 *
 * PHASE 2 — AI fallback
 *   Step 3: Ask Groq AI to identify product type → generate precise query
 *   Step 4: Google with AI query
 *   Step 5: DDG   with AI query
 *
 * All downloads validated with magic byte signatures (rejects HTML/XML/JSON errors).
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import Groq from 'groq-sdk';
import google from 'googlethis';

// ─── ENV ───
function loadEnv() {
  const content = fs.readFileSync(path.resolve('.env'), 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const m = line.match(/^\s*([\w\-]+)\s*=\s*(.*)\s*$/);
    if (m) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[m[1]] = v;
    }
  });
  return env;
}

const env = loadEnv();
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const groq = new Groq({ apiKey: env.VITE_GROQ_API_KEY });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ─── IMAGE MAGIC BYTE VALIDATION ───
const MAGIC = [
  { bytes: [0xFF, 0xD8, 0xFF],        ext: 'jpg',  mime: 'image/jpeg' },
  { bytes: [0x89, 0x50, 0x4E, 0x47], ext: 'png',  mime: 'image/png'  },
  { bytes: [0x47, 0x49, 0x46],        ext: 'gif',  mime: 'image/gif'  },
  { bytes: [0x52, 0x49, 0x46, 0x46], ext: 'webp', mime: 'image/webp' },
  { bytes: [0x42, 0x4D],              ext: 'bmp',  mime: 'image/bmp'  },
];

function validateImageBuffer(buffer) {
  if (buffer.byteLength < 2048) return null; // too small → error or placeholder
  const view = new Uint8Array(buffer.slice(0, 12));
  for (const { bytes, ext, mime } of MAGIC) {
    if (bytes.every((b, i) => view[i] === b)) return { ext, mime };
  }
  return null;
}

// ─── DOWNLOAD + VALIDATE ───
async function downloadImage(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9',
        'Referer': 'https://www.google.com/',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const info = validateImageBuffer(buffer);
    if (!info) return null;
    return { buffer, ...info };
  } catch {
    return null;
  }
}

// ─── TRY A LIST OF SEARCH RESULTS WITH CONDITION VERIFICATION ───
async function tryUrlsWithVision(items, productName, searchQuery, needsVisionCheck = false, maxTry = 3) {
  for (const item of items.slice(0, maxTry)) {
    const previewUrl = item.thumbnail || item.url;
    const dlPreview = await downloadImage(previewUrl);
    if (dlPreview) {
      if (needsVisionCheck) {
        process.stdout.write(`checking URL... `);
        const isOk = await verifyImageWithAI(dlPreview.buffer, dlPreview.mime, productName, searchQuery);
        if (isOk) {
          const dlOriginal = await downloadImage(item.url);
          if (dlOriginal) {
            return { ...dlOriginal, url: item.url };
          }
          return { ...dlPreview, url: previewUrl }; // fallback
        } else {
          process.stdout.write(`rejected ❌ | `);
        }
      } else {
        // Fast processing: skip vision checks, directly download and return the original image
        const dlOriginal = await downloadImage(item.url);
        if (dlOriginal) {
          return { ...dlOriginal, url: item.url };
        }
        return { ...dlPreview, url: previewUrl }; // fallback
      }
    }
  }
  return null;
}

// ─── GOOGLE IMAGE SEARCH ───
async function googleUrls(query) {
  try {
    const imgs = await google.image(query, {
      safe: false,
      additional_params: { gl: 'IN', hl: 'en-IN', cr: 'countryIN' }
    });
    return (imgs || []).map(i => ({ url: i.url, thumbnail: i.thumbnail })).filter(x => x.url);
  } catch {
    return [];
  }
}

// ─── DDG IMAGE SEARCH ───
async function ddgUrls(query) {
  try {
    const searchRes = await fetch(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=images`,
      { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(10000) }
    );
    const html = await searchRes.text();
    const vqd = html.match(/vqd=([\d-]+)/)?.[1];
    if (!vqd) return [];

    const params = new URLSearchParams({ q: query, o: 'json', p: '1', s: '0', u: 'bing', f: ',,,', l: 'in-en', vqd });
    const imgRes = await fetch(`https://duckduckgo.com/i.js?${params}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://duckduckgo.com/' },
      signal: AbortSignal.timeout(10000),
    });
    const data = await imgRes.json();
    return (data.results || []).map(r => ({ url: r.image, thumbnail: r.thumbnail || r.image })).filter(x => x.url);
  } catch {
    return [];
  }
}

// Helper to check if a product name is ambiguous/loose/local
function isProductAmbiguous(name) {
  const cleanLower = name.replace(/₹\s*\d+(?:\/-)?/g, '').trim().toLowerCase();
  const ambiguousKeywords = [
    'american club', 'amber', 'classic', 'gold flake', 'freedom',
    'maggi', 'parle g', 'parle-g', 'dove', 'passing show', 'm score', 'bingo',
    'samosa', 'chakodhi', 'local', 'loose', 'laddu', 'jamun', 'sweet', 'khara', 'pak'
  ];
  return ambiguousKeywords.some(keyword => cleanLower.includes(keyword));
}

// ─── AI QUERY GENERATOR (Groq — fallback) ───
async function aiGenerateQuery(name, barcode) {
  const cleanName = name.replace(/₹\s*\d+(?:\/-)?/g, '').trim();
  const barcodeInfo = barcode ? `Barcode: ${barcode}` : 'No barcode (loose/commodity item)';
  const cleanLower = cleanName.toLowerCase();

  // Deterministic ambiguity solver (Product Type Dictionary)
  let preMapped = null;
  if (cleanLower.includes('american club')) preMapped = { category: 'cigarette', query: `${cleanName} cigarette ${barcode} India front package`, needsVisionCheck: true };
  else if (cleanLower.includes('amber')) preMapped = { category: 'chewing tobacco', query: `${cleanName} chewing tobacco ${barcode} India packet front package`, needsVisionCheck: true };
  else if (cleanLower.includes('classic')) preMapped = { category: 'cigarette', query: `${cleanName} cigarette ${barcode} India front package`, needsVisionCheck: true };
  else if (cleanLower.includes('gold flake')) preMapped = { category: 'cigarette', query: `${cleanName} cigarette ${barcode} India front package`, needsVisionCheck: true };
  else if (cleanLower.includes('freedom')) preMapped = { category: 'oil', query: `${cleanName} Sunflower Oil ${barcode} India bottle front package`, needsVisionCheck: true };
  else if (cleanLower.includes('maggi')) preMapped = { category: 'noodles', query: `${cleanName} noodles ${barcode} India front package`, needsVisionCheck: true };
  else if (cleanLower.includes('parle g') || cleanLower.includes('parle-g')) preMapped = { category: 'biscuit', query: `${cleanName} biscuit ${barcode} India front package`, needsVisionCheck: true };
  else if (cleanLower.includes('dove')) preMapped = { category: 'soap', query: `${cleanName} soap ${barcode} India front package`, needsVisionCheck: true };
  else if (cleanLower.includes('passing show')) preMapped = { category: 'cigarette', query: `${cleanName} cigarette ${barcode} India front package`, needsVisionCheck: true };
  else if (cleanLower.includes('m score') || cleanLower.includes('m-score')) preMapped = { category: 'cigarette', query: `${cleanName} cigarette ${barcode} India front package`, needsVisionCheck: true };
  else if (cleanLower.includes('bingo')) preMapped = { category: 'snack', query: `${cleanName} potato chips ${barcode} India front package`, needsVisionCheck: true };

  if (preMapped) return preMapped;

  let categoryHint = '';
  if (cleanLower.includes('oil')) categoryHint = 'oil';
  else if (cleanLower.includes('soap')) categoryHint = 'soap';
  else if (cleanLower.includes('biscuit')) categoryHint = 'biscuit';
  else if (cleanLower.includes('powder')) categoryHint = 'powder';
  else if (cleanLower.includes('paste')) categoryHint = 'toothpaste';

  const prompt = `You are an Indian grocery product expert.

Product name: "${cleanName}"
${barcodeInfo}
${categoryHint ? `Product Type Hint: This is a ${categoryHint} product.` : ''}

Tasks:
1. Identify the product category (e.g., cigarette, tobacco, oil, biscuit, soap, spice, sweet, tea, snack, etc.)
2. Generate the best search query to find the FRONT PACKAGE photo of this product in India.
3. Determine if this product needs a visual verification check.

Rules for needsVisionCheck (true/false):
- Set to true if the product is generic, loose, commodity, local sweets/snacks, or has an ambiguous name (e.g. Samosa, Chakodhi, Local sweets, loose item names, or generic brands).
- Set to false if it's a specific, highly searchable brand and packaging (e.g. Aashirvaad Atta, Ariel Surf, Bajaj Almond Drops, Colgate) which does not require vision checks.

Rules for the query:
- If a barcode is available, you MUST include the barcode number in the query.
- For branded products: include brand name + product category + barcode number (if available) + "India front package" (e.g. "American Club cigarette 890295334615 India front package")
- For loose/commodity items (sugar, chana, etc.): use item name + "bowl white background India"
- Include quantity if mentioned in the name
- Do NOT include price (₹ or /-)
- 5-10 words max

Respond ONLY with valid JSON, no other text:
{"category":"<category>","query":"<google search query>","needsVisionCheck":true/false}`;

  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 85,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }, {
      signal: AbortSignal.timeout(15000)
    });
    const text = res.choices[0]?.message?.content?.trim();
    const parsed = JSON.parse(text);
    if (parsed.query) return parsed;
    return null;
  } catch {
    let cat = categoryHint || 'unknown';
    const isAmb = isProductAmbiguous(cleanName);
    return { category: cat, query: `${cleanName} India front package`, needsVisionCheck: isAmb };
  }
}

// ─── SAVE TO SUPABASE ───
async function saveImage(productId, buffer, mime, ext, currentVersion, oldImageUrl) {
  const filename = `prod_${productId}_${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('product-images')
    .upload(filename, buffer, { contentType: mime, upsert: true });
  if (upErr) throw upErr;

  const { data } = supabase.storage.from('product-images').getPublicUrl(filename);

  // Delete old image
  if (oldImageUrl) {
    try {
      const parts = oldImageUrl.split('/product-images/');
      if (parts[1]) await supabase.storage.from('product-images').remove([decodeURIComponent(parts[1])]);
    } catch (_) {}
  }

  const now = new Date().toISOString();
  const { error: uErr } = await supabase.from('products').update({
    image_url: data.publicUrl,
    image_source: 'AUTO_AI',
    image_last_updated: now,
    updated_at: now,
    version: (currentVersion || 0) + 1,
  }).eq('id', productId);

  if (uErr) throw uErr;
}

// ─── VISION AI VERIFICATION POOL ───
const VISION_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite'
];
let currentModelIndex = 0;
let lastGeminiCallTime = 0;

async function verifyImageWithAI(buffer, mime, productName, searchQuery) {
  const base64Data = Buffer.from(buffer).toString('base64');
  const prompt = `This is a product image downloaded from a web search for an Indian grocery store.
Product Name: "${productName}"
Search Query Used: "${searchQuery}"

Task:
Determine if this image shows the correct product packaging or item matching the name and context.
Be strict:
- If it is the correct product (matching name, brand, type, and weight/quantity if specified), output: {"match":true,"reason":"<brief explanation>"}
- If it is a different product (different brand, different item), an error page (e.g. 404, Access Denied), a stock-market chart/diagram, or completely unrelated, output: {"match":false,"reason":"<brief explanation>"}

Respond ONLY with valid JSON (no markdown block formatting).`;

  const maxRetries = 4; // allows rotating through models
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Spacing between calls
    const now = Date.now();
    const elapsed = now - lastGeminiCallTime;
    if (elapsed < 4500) {
      await sleep(4500 - elapsed);
    }
    lastGeminiCallTime = Date.now();

    const activeModel = VISION_MODELS[currentModelIndex];
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${env.VITE_GEMINI_API_KEY}`;
      const res = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: mime, data: base64Data } }
            ]
          }],
          generationConfig: { responseMimeType: 'application/json' }
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (res.status === 429 || res.status === 503) {
        currentModelIndex = (currentModelIndex + 1) % VISION_MODELS.length;
        const nextModel = VISION_MODELS[currentModelIndex];
        console.log(`[AI Vision ${res.status} on ${activeModel}: Rotating to ${nextModel}. Attempt ${attempt}/${maxRetries}...]`);
        await sleep(2000);
        continue;
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.log(`[AI Vision HTTP ${res.status} on ${activeModel}: ${errBody.slice(0, 100)}]`);
        return false;
      }

      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      let text = rawText;
      
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        text = text.substring(firstBrace, lastBrace + 1);
      }
      try {
        const parsed = JSON.parse(text.trim());
        return parsed.match === true;
      } catch (parseErr) {
        console.log(`[AI Vision Parse Error: ${parseErr.message}. Raw: "${rawText}"]`);
        return false;
      }

    } catch (err) {
      currentModelIndex = (currentModelIndex + 1) % VISION_MODELS.length;
      const nextModel = VISION_MODELS[currentModelIndex];
      console.log(`[AI Vision Error on ${activeModel}: ${err.message}. Rotating to ${nextModel}. Attempt ${attempt}/${maxRetries}]`);
      if (attempt < maxRetries) {
        await sleep(2000);
        continue;
      }
      return false;
    }
  }

  return false;
}

// ─── PROCESS ONE PRODUCT ───
async function processProduct(product, index, total) {
  const { id, name, barcode, image_url, version } = product;
  const cleanName = name.replace(/₹\s*\d+(?:\/-)?/g, '').trim();
  const realBarcode = barcode && !barcode.startsWith('SYS-') ? barcode : '';
  const isAmb = isProductAmbiguous(cleanName);

  console.log(`\n[${index + 1}/${total}] ${name}${realBarcode ? ` [${realBarcode}]` : ' [no barcode]'}`);

  // ── STEP 1 & 2: DIRECT BARCODE + NAME SEARCH WITH VISION VERIFY ──
  if (realBarcode) {
    const directQuery = `${cleanName} ${realBarcode}`;

    // 1. DDG barcode + product name
    process.stdout.write(`  1. DDG direct (name+barcode) → `);
    const ddgList = await ddgUrls(directQuery);
    const d1 = await tryUrlsWithVision(ddgList, cleanName, directQuery, isAmb, 1);
    if (d1) return await save(d1, id, version, image_url, `DDG direct`);
    console.log(`failed`);

    // 2. Google barcode + product name
    process.stdout.write(`  2. Google direct (name+barcode) → `);
    const googleList = await googleUrls(directQuery);
    const d2 = await tryUrlsWithVision(googleList, cleanName, directQuery, isAmb, 1);
    if (d2) return await save(d2, id, version, image_url, `Google direct`);
    console.log(`failed`);
  }

  // ── STEP 3: AI QUERY IN GOOGLE/DDG ──
  process.stdout.write(`  3. AI query → `);
  const ai = await aiGenerateQuery(name, realBarcode);
  if (!ai) {
    console.log(`AI query generation failed`);
    console.log(`  ❌ Skipping`);
    return false;
  }
  const visionNeeded = ai.needsVisionCheck === true || isAmb;
  console.log(`"${ai.query}" [${ai.category}] ${visionNeeded ? '👁️  (Needs Vision Check)' : '⚡ (Fast Mode)'}`);

  // Search Google with AI query and check candidates sequentially
  process.stdout.write(`  4. Google AI query (checking candidates) → `);
  const googleAiUrls = await googleUrls(ai.query);
  const googleAiResult = await tryUrlsWithVision(googleAiUrls, cleanName, ai.query, visionNeeded, 3);
  if (googleAiResult) return await save(googleAiResult, id, version, image_url, `Google AI`);
  console.log(`failed`);

  // Fallback: DDG AI query
  process.stdout.write(`  5. DDG AI query (checking candidates) → `);
  const ddgAiUrls = await ddgUrls(ai.query);
  const ddgAiResult = await tryUrlsWithVision(ddgAiUrls, cleanName, ai.query, visionNeeded, 3);
  if (ddgAiResult) return await save(ddgAiResult, id, version, image_url, `DDG AI`);
  console.log(`failed`);

  console.log(`  ❌ All steps failed — skipping`);
  return false;
}

async function save(dl, productId, version, oldUrl, label) {
  try {
    await saveImage(productId, dl.buffer, dl.mime, dl.ext, version, oldUrl);
    console.log(`✅ SAVED (${label})`);
    console.log(`   ↳ ${dl.url.slice(0, 100)}`);
    return true;
  } catch (err) {
    console.log(`upload error: ${err.message}`);
    return false;
  }
}

// ─── MAIN ───
async function main() {
  console.log('\n======================================================');
  console.log('  Sai Ram Kirana — Smart AI Image Fetcher');
  console.log('  Barcode → AI fallback → Google → DDG');
  console.log('======================================================\n');

  // Command-line arguments check (for single product trigger)
  const args = process.argv.slice(2);
  const idArg = args.find(a => a.startsWith('--id='));
  const singleId = idArg ? parseInt(idArg.split('=')[1], 10) : null;

  if (singleId) {
    console.log(`⏳ Loading single product (ID: ${singleId}) from Supabase...`);
    const [prodRes, bcRes] = await Promise.all([
      supabase.from('products').select('id, display_name, image_url, version').eq('id', singleId).eq('is_deleted', false).single(),
      supabase.from('barcodes').select('product_id, barcode').eq('product_id', singleId).eq('is_deleted', false)
    ]);

    if (prodRes.error) {
      console.error('Product fetch error:', prodRes.error.message);
      process.exit(1);
    }

    const p = prodRes.data;
    const barcodeVal = (bcRes.data || []).find(b => b.product_id === singleId)?.barcode || '';
    const product = {
      id: p.id,
      name: p.display_name,
      barcode: barcodeVal,
      image_url: p.image_url || null,
      version: p.version || 0
    };

    console.log(`✅ Loaded product: "${product.name}"`);
    const ok = await processProduct(product, 0, 1);
    process.exit(ok ? 0 : 1);
  }

  console.log('⏳ Loading products from Supabase...');
  const [prodRes, bcRes] = await Promise.all([
    supabase.from('products').select('id, display_name, image_url, version').eq('is_deleted', false).order('display_name'),
    supabase.from('barcodes').select('product_id, barcode').eq('is_deleted', false)
  ]);

  if (prodRes.error) { console.error('Products error:', prodRes.error.message); process.exit(1); }
  if (bcRes.error)   { console.error('Barcodes error:', bcRes.error.message); process.exit(1); }

  const bcMap = {};
  (bcRes.data || []).forEach(b => { if (!bcMap[b.product_id]) bcMap[b.product_id] = b.barcode; });

  const products = (prodRes.data || []).map(p => ({
    id: p.id,
    name: p.display_name,
    barcode: bcMap[p.id] || '',
    image_url: p.image_url || null,
    version: p.version || 0,
  }));

  console.log(`✅ Loaded ${products.length} products\n`);

  let saved = 0, failed = 0;

  for (let i = 0; i < products.length; i++) {
    const ok = await processProduct(products[i], i, products.length);
    if (ok) saved++; else failed++;
    await sleep(1000); // avoid rate limits
  }

  console.log('\n======================================================');
  console.log(`  DONE — ✅ ${saved} saved  ❌ ${failed} failed`);
  console.log('======================================================\n');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
