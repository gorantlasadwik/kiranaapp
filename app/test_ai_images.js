// test_ai_images.js — tests the AI+Groq approach on 3 sample products
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

const IMAGE_SIGNATURES = [
  { sig: [0xFF, 0xD8, 0xFF], ext: 'jpg' },
  { sig: [0x89, 0x50, 0x4E, 0x47], ext: 'png' },
  { sig: [0x47, 0x49, 0x46], ext: 'gif' },
  { sig: [0x52, 0x49, 0x46, 0x46], ext: 'webp' },
];

function detectImageType(buffer) {
  const bytes = new Uint8Array(buffer.slice(0, 12));
  for (const { sig, ext } of IMAGE_SIGNATURES) {
    if (sig.every((b, i) => bytes[i] === b)) return ext;
  }
  return null;
}

const testProducts = [
  { name: 'Parle G Biscuit', barcode: '8901019100183' },
  { name: '10/- Samosa', barcode: '' },
  { name: 'Dove Pink Soap', barcode: '8901023028670' },
];

for (const p of testProducts) {
  const cleanName = p.name.replace(/₹\s*\d+(?:\/-)?/g, '').trim();
  const barcodeInfo = p.barcode ? `Barcode: ${p.barcode}` : 'No barcode';
  
  const prompt = `You are helping find product images for an Indian grocery store.
Product name: "${cleanName}"
${barcodeInfo}
Generate a short, precise Google Images search query to find the FRONT PACKAGE image of this exact product sold in India.
Return ONLY the search query string — no quotes, no explanation, 3-7 words max.`;

  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 30,
    temperature: 0.1,
  });
  const query = res.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '') || cleanName;
  
  console.log(`\nProduct: "${p.name}" [${p.barcode || 'no barcode'}]`);
  console.log(`AI Query: "${query}"`);

  try {
    const imgs = await google.image(query, {
      safe: false,
      additional_params: { gl: 'IN', hl: 'en-IN', cr: 'countryIN' }
    });
    console.log(`Google results: ${imgs?.length || 0}`);
    
    // Try first 3 URLs until we get a valid image
    let found = false;
    for (const img of (imgs || []).slice(0, 3)) {
      const r = await fetch(img.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 Chrome/124.0.0.0', Referer: 'https://www.google.com/' },
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);
      if (!r || !r.ok) { console.log(`  ✗ ${img.url.slice(0,60)} → HTTP ${r?.status || 'failed'}`); continue; }
      const buf = await r.arrayBuffer();
      const ext = detectImageType(buf);
      if (!ext) { console.log(`  ✗ ${img.url.slice(0,60)} → not an image (${buf.byteLength}b)`); continue; }
      console.log(`  ✅ ${img.url.slice(0,70)} → ${ext}, ${buf.byteLength}b`);
      found = true;
      break;
    }
    if (!found) console.log(`  ❌ No valid image found in top 3`);
  } catch (err) {
    console.log(`Google error: ${err.message}`);
  }

  await new Promise(r => setTimeout(r, 1200));
}

console.log('\n✅ Test complete');
