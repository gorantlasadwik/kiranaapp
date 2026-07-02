// test_pipeline.js — tests the full pipeline on 4 challenging products
import Groq from 'groq-sdk';
import google from 'googlethis';
import fs from 'fs';
import path from 'path';

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
const groq = new Groq({ apiKey: env.VITE_GROQ_API_KEY });

const MAGIC = [
  { bytes: [0xFF, 0xD8, 0xFF],        ext: 'jpg' },
  { bytes: [0x89, 0x50, 0x4E, 0x47], ext: 'png' },
  { bytes: [0x47, 0x49, 0x46],        ext: 'gif' },
  { bytes: [0x52, 0x49, 0x46, 0x46], ext: 'webp' },
];

function isRealImage(buf) {
  if (buf.byteLength < 2048) return false;
  const view = new Uint8Array(buf.slice(0, 12));
  return MAGIC.some(({ bytes }) => bytes.every((b, i) => view[i] === b));
}

async function aiQuery(name, barcode) {
  const cleanName = name.replace(/₹\s*\d+(?:\/-)?/g, '').trim();
  const prompt = `You are an Indian grocery product expert.
Product name: "${cleanName}"
${barcode ? `Barcode: ${barcode}` : 'No barcode (loose item)'}

Tasks:
1. Identify the product category (cigarette, tobacco, oil, biscuit, soap, spice, sweet, etc.)
2. Generate the best Google Images search query to find the FRONT PACKAGE photo of this product in India.

Rules: include brand name + product type + "India front package". For loose items: name + "bowl white background India". 5-9 words max.

Respond ONLY with valid JSON: {"category":"...","query":"..."}`;

  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 80,
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });
  return JSON.parse(res.choices[0]?.message?.content || '{}');
}

const tests = [
  { name: 'American Club', barcode: '890295334615' },
  { name: 'Amber', barcode: 'SYS-22699093-1' },
  { name: 'Sugar', barcode: '' },
  { name: 'Freedom Sunflower Oil 1L', barcode: '8906007286978' },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

for (const p of tests) {
  const realBarcode = p.barcode && !p.barcode.startsWith('SYS-') ? p.barcode : '';
  console.log(`\n=== "${p.name}" ${realBarcode ? `[${realBarcode}]` : '[no real barcode]'} ===`);

  const ai = await aiQuery(p.name, realBarcode);
  console.log(`AI → category: "${ai.category}", query: "${ai.query}"`);

  // Try Google with AI query
  try {
    const imgs = await google.image(ai.query, {
      safe: false,
      additional_params: { gl: 'IN', hl: 'en-IN', cr: 'countryIN' }
    });
    console.log(`Google results: ${imgs?.length || 0}`);
    
    let found = false;
    for (const img of (imgs || []).slice(0, 5)) {
      const r = await fetch(img.url, {
        headers: { 'User-Agent': UA, Referer: 'https://www.google.com/', Accept: 'image/*' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      }).catch(() => null);
      if (!r?.ok) { process.stdout.write('✗'); continue; }
      const buf = await r.arrayBuffer();
      if (!isRealImage(buf)) { process.stdout.write('✗'); continue; }
      console.log(`\n  ✅ Valid image: ${img.url.slice(0, 80)}`);
      found = true; break;
    }
    if (!found) console.log(`\n  ❌ No valid image in top 5`);
  } catch (err) {
    console.log(`Google error: ${err.message}`);
  }

  await new Promise(r => setTimeout(r, 1500));
}
console.log('\n✅ Done');
