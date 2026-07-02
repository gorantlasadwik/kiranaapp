import express from 'express';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import google from 'googlethis';
import { exec } from 'child_process';

// ─── LOAD .env ───
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
const app = express();
app.use(express.json());

// ─── PRODUCT CACHE (loaded once at startup) ───
let productCache = null;

async function loadProductCache() {
  console.log('⏳ Fetching products from Supabase (parallel)...');
  const [prodRes, bcRes] = await Promise.all([
    supabase.from('products').select('id, display_name, image_url, version').eq('is_deleted', false).order('display_name'),
    supabase.from('barcodes').select('product_id, barcode').eq('is_deleted', false)
  ]);

  if (prodRes.error) throw prodRes.error;
  if (bcRes.error) throw bcRes.error;

  const bcMap = {};
  (bcRes.data || []).forEach(b => { if (!bcMap[b.product_id]) bcMap[b.product_id] = b.barcode; });

  productCache = (prodRes.data || []).map(p => ({
    id: p.id,
    name: p.display_name,
    barcode: bcMap[p.id] || '',
    has_image: !!p.image_url,
    image_url: p.image_url || null,
    version: p.version || 0
  }));

  console.log(`✅ Cached ${productCache.length} products`);
}

// ─── API: GET ALL PRODUCTS (returns from cache instantly) ───
app.get('/api/products', (req, res) => {
  if (!productCache) return res.status(503).json({ error: 'Cache not ready yet, please retry in a moment.' });
  res.json(productCache);
});

// ─── API: GOOGLE IMAGE SEARCH ───
app.get('/api/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    console.log(`Google Image search: "${q}"`);
    const imgs = await google.image(q, {
      safe: false,
      additional_params: { gl: 'IN', hl: 'en-IN', cr: 'countryIN' }
    });
    const results = (imgs || []).slice(0, 20).map(i => ({
      url: i.url,
      title: i.origin ? i.origin.title : '',
      width: i.width || 0,
      height: i.height || 0
    }));
    res.json(results);
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: SAVE SELECTED IMAGE ───
app.post('/api/select', async (req, res) => {
  const { productId, imageUrl } = req.body;
  if (!productId || !imageUrl) return res.status(400).json({ error: 'productId and imageUrl required' });

  try {
    const imgRes = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*,*/*;q=0.8',
        'Referer': 'https://www.google.com/'
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!imgRes.ok) throw new Error(`Download failed: HTTP ${imgRes.status}`);

    const ct = imgRes.headers.get('content-type') || 'image/jpeg';
    const buffer = await imgRes.arrayBuffer();
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
    const filename = `prod_${productId}_${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from('product-images')
      .upload(filename, buffer, { contentType: ct, upsert: true });
    if (upErr) throw upErr;

    const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(filename);
    const publicUrl = urlData.publicUrl;

    const { data: cur } = await supabase.from('products').select('image_url, version').eq('id', productId).single();
    if (cur?.image_url) {
      try {
        const parts = cur.image_url.split('/product-images/');
        if (parts[1]) await supabase.storage.from('product-images').remove([decodeURIComponent(parts[1])]);
      } catch (_) {}
    }

    const now = new Date().toISOString();
    const { error: uErr } = await supabase.from('products').update({
      image_url: publicUrl,
      image_source: 'MANUAL_SELECT',
      image_last_updated: now,
      updated_at: now,
      version: (cur?.version || 0) + 1
    }).eq('id', productId);
    if (uErr) throw uErr;

    console.log(`Saved image for product ${productId}`);
    res.json({ success: true, publicUrl });
  } catch (err) {
    console.error('Save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: AUTO FETCH PRODUCT IMAGE FOR NEW PRODUCTS ───
app.post('/api/fetch-product-image', (req, res) => {
  const { productId } = req.body;
  if (!productId) return res.status(400).json({ error: 'productId required' });

  console.log(`[Server] Triggering auto_images.js for product ID: ${productId}`);
  exec(`node auto_images.js --id=${productId}`, (err, stdout, stderr) => {
    if (err) {
      console.error(`[Server] auto_images.js failed for product ${productId}:`, err.message);
    } else {
      console.log(`[Server] auto_images.js completed for product ${productId}:\n`, stdout);
    }
  });

  res.json({ success: true, message: 'Image fetch triggered' });
});

// ─── SERVE HTML INTERFACE ───
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sai Ram Kirana - Image Picker</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', sans-serif;
      background: #0d1117;
      color: #e6edf3;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── TOP BAR ── */
    #topbar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      background: #161b22;
      border-bottom: 1px solid #30363d;
      flex-shrink: 0;
    }
    #topbar h1 { font-size: 16px; font-weight: 700; color: #58a6ff; white-space: nowrap; }
    #progress-text { font-size: 13px; color: #8b949e; white-space: nowrap; }
    #progress-bar-wrap {
      flex: 1;
      height: 6px;
      background: #21262d;
      border-radius: 3px;
      overflow: hidden;
    }
    #progress-bar { height: 100%; background: linear-gradient(90deg, #58a6ff, #7c3aed); border-radius: 3px; transition: width 0.3s; }
    #btn-skip {
      padding: 7px 16px;
      background: #21262d;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #e6edf3;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
    }
    #btn-skip:hover { background: #30363d; }

    /* ── MAIN LAYOUT ── */
    #layout {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    /* ── LEFT PANEL ── */
    #left-panel {
      width: 320px;
      flex-shrink: 0;
      background: #161b22;
      border-right: 1px solid #30363d;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #product-card {
      padding: 20px;
      border-bottom: 1px solid #30363d;
    }
    #product-index { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
    #product-name { font-size: 18px; font-weight: 700; color: #e6edf3; line-height: 1.3; margin-bottom: 6px; }
    #product-barcode {
      display: inline-block;
      font-size: 12px;
      font-family: monospace;
      background: #21262d;
      border: 1px solid #30363d;
      padding: 3px 8px;
      border-radius: 4px;
      color: #79c0ff;
      margin-bottom: 12px;
    }
    #current-image-wrap { margin-bottom: 0; }
    #current-image-label { font-size: 11px; color: #8b949e; margin-bottom: 6px; }
    #current-image {
      width: 100%;
      height: 140px;
      object-fit: contain;
      background: #21262d;
      border-radius: 6px;
      border: 1px solid #30363d;
    }
    #no-image-placeholder {
      width: 100%;
      height: 140px;
      background: #21262d;
      border: 1px dashed #30363d;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #8b949e;
      font-size: 13px;
    }

    /* ── SEARCH SECTION ── */
    #search-section {
      padding: 16px 20px;
      border-bottom: 1px solid #30363d;
      flex-shrink: 0;
    }
    #search-mode-label { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .mode-btn {
      display: block;
      width: 100%;
      padding: 8px 12px;
      margin-bottom: 6px;
      background: #21262d;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #8b949e;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      text-align: left;
      transition: all 0.15s;
    }
    .mode-btn:hover { background: #30363d; color: #e6edf3; }
    .mode-btn.active { background: #1f4a8a; border-color: #58a6ff; color: #58a6ff; }
    #search-input-wrap { display: flex; gap: 8px; margin-top: 10px; }
    #search-input {
      flex: 1;
      padding: 8px 12px;
      background: #21262d;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #e6edf3;
      font-size: 13px;
      outline: none;
    }
    #search-input:focus { border-color: #58a6ff; }
    #btn-search {
      padding: 8px 14px;
      background: #1f6feb;
      border: none;
      border-radius: 6px;
      color: #fff;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
    }
    #btn-search:hover { background: #388bfd; }
    #btn-search:disabled { background: #21262d; color: #8b949e; cursor: default; }

    /* ── SELECTED PREVIEW & SUBMIT ── */
    #action-section {
      padding: 16px 20px;
      margin-top: auto;
      border-top: 1px solid #30363d;
    }
    #selected-preview-wrap { margin-bottom: 12px; display: none; }
    #selected-label { font-size: 11px; color: #8b949e; margin-bottom: 6px; }
    #selected-preview {
      width: 100%;
      height: 100px;
      object-fit: contain;
      background: #21262d;
      border-radius: 6px;
      border: 2px solid #238636;
    }
    #btn-submit {
      width: 100%;
      padding: 12px;
      background: #238636;
      border: none;
      border-radius: 8px;
      color: #fff;
      cursor: pointer;
      font-size: 15px;
      font-weight: 700;
      transition: background 0.15s;
    }
    #btn-submit:hover { background: #2ea043; }
    #btn-submit:disabled { background: #21262d; color: #8b949e; cursor: default; }

    /* ── RIGHT PANEL: IMAGE GRID ── */
    #right-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #right-header {
      padding: 12px 20px;
      background: #161b22;
      border-bottom: 1px solid #30363d;
      font-size: 13px;
      color: #8b949e;
      flex-shrink: 0;
    }
    #right-header span { color: #e6edf3; font-weight: 600; }
    #image-grid {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 12px;
      align-content: start;
    }
    #image-grid::-webkit-scrollbar { width: 6px; }
    #image-grid::-webkit-scrollbar-track { background: #0d1117; }
    #image-grid::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }

    .img-card {
      background: #161b22;
      border: 2px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      transition: all 0.15s;
    }
    .img-card:hover { border-color: #58a6ff; transform: translateY(-2px); }
    .img-card.selected { border-color: #238636; box-shadow: 0 0 0 3px rgba(35,134,54,0.3); }
    .img-card img {
      width: 100%;
      height: 140px;
      object-fit: contain;
      background: #21262d;
      display: block;
    }
    .img-card .img-title {
      padding: 6px 8px;
      font-size: 10px;
      color: #8b949e;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #state-msg {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 16px;
      color: #8b949e;
    }
    #state-msg .icon { font-size: 48px; }
    #state-msg p { font-size: 15px; }

    /* ── TOAST ── */
    #toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 14px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      display: none;
      z-index: 9999;
      animation: slideIn 0.3s ease;
    }
    @keyframes slideIn {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    /* ── LOADING SPINNER ── */
    .spinner {
      width: 32px; height: 32px;
      border: 3px solid #30363d;
      border-top-color: #58a6ff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>

  <!-- TOP BAR -->
  <div id="topbar">
    <h1>📦 Sai Ram Kirana — Image Picker</h1>
    <span id="progress-text">Loading...</span>
    <div id="progress-bar-wrap">
      <div id="progress-bar" style="width:0%"></div>
    </div>
    <button id="btn-skip" onclick="skipProduct()">Skip →</button>
  </div>

  <!-- MAIN LAYOUT -->
  <div id="layout">

    <!-- LEFT PANEL -->
    <div id="left-panel">
      <!-- Product Info Card -->
      <div id="product-card">
        <div id="product-index">Loading products...</div>
        <div id="product-name">—</div>
        <div id="product-barcode" style="display:none"></div>
        <div id="current-image-wrap">
          <div id="current-image-label">Current Image</div>
          <div id="no-image-placeholder">No image yet</div>
          <img id="current-image" style="display:none" alt="current">
        </div>
      </div>

      <!-- Search Mode Buttons -->
      <div id="search-section">
        <div id="search-mode-label">Search Mode</div>
        <button class="mode-btn active" id="mode-barcode" onclick="setMode('barcode')">🔍 Barcode only</button>
        <button class="mode-btn" id="mode-namebar" onclick="setMode('namebar')">🔍 Name + Barcode</button>
        <button class="mode-btn" id="mode-name" onclick="setMode('name')">🔍 Name only</button>
        <div id="search-input-wrap">
          <input type="text" id="search-input" placeholder="Edit search query..." onkeydown="if(event.key==='Enter') doSearch()">
          <button id="btn-search" onclick="doSearch()">Search</button>
        </div>
      </div>

      <!-- Submit Action -->
      <div id="action-section">
        <div id="selected-preview-wrap">
          <div id="selected-label">✅ Selected Image</div>
          <img id="selected-preview" alt="selected">
        </div>
        <button id="btn-submit" onclick="submitImage()" disabled>Select an image first</button>
      </div>
    </div>

    <!-- RIGHT PANEL: Image Grid -->
    <div id="right-panel">
      <div id="right-header">Google Image Results — <span id="result-count">0 results</span></div>
      <div id="image-grid">
        <div id="state-msg">
          <div class="icon">🖼️</div>
          <p>Loading products...</p>
        </div>
      </div>
    </div>
  </div>

  <!-- TOAST -->
  <div id="toast"></div>

  <script>
    // ── STATE ──
    let products = [];
    let currentIndex = 0;
    let selectedImageUrl = null;
    let currentMode = 'barcode';

    // ── LOAD PRODUCTS ON START ──
    async function init() {
      showMsg('⏳', 'Connecting to database...');
      
      // Retry loop — server pre-loads Supabase cache at startup, might take a few seconds
      for (let attempt = 1; attempt <= 15; attempt++) {
        try {
          showMsg('⏳', 'Loading products... (attempt ' + attempt + ')');
          const res = await fetch('/api/products');
          
          if (res.status === 503) {
            // Cache not ready, wait and retry
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          
          if (!res.ok) throw new Error('Server error: ' + res.status);
          
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          if (!data.length) throw new Error('No products returned');
          
          products = data;
          showToast('✅ Loaded ' + products.length + ' products!', 'green');
          loadProduct(0);
          return; // success
        } catch (err) {
          if (attempt >= 15) {
            showMsg('❌', 'Failed to load: ' + err.message);
            document.getElementById('product-index').textContent = 'Error — refresh to retry';
          }
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }

    // ── LOAD PRODUCT AT INDEX ──
    function loadProduct(index) {
      if (index >= products.length) {
        showMsg('🎉', 'All ' + products.length + ' products done!');
        document.getElementById('product-index').textContent = 'All done!';
        document.getElementById('product-name').textContent = '✅ Finished';
        return;
      }

      currentIndex = index;
      selectedImageUrl = null;

      const p = products[index];
      const total = products.length;

      // Update progress
      document.getElementById('progress-text').textContent = (index + 1) + ' / ' + total;
      document.getElementById('progress-bar').style.width = ((index + 1) / total * 100) + '%';

      // Product card
      document.getElementById('product-index').textContent = 'Product #' + (index + 1) + ' of ' + total;
      document.getElementById('product-name').textContent = p.name;

      const bcEl = document.getElementById('product-barcode');
      if (p.barcode) {
        bcEl.textContent = p.barcode;
        bcEl.style.display = 'inline-block';
      } else {
        bcEl.style.display = 'none';
      }

      // Current image
      const curImg = document.getElementById('current-image');
      const noPh = document.getElementById('no-image-placeholder');
      if (p.image_url) {
        curImg.src = p.image_url;
        curImg.style.display = 'block';
        noPh.style.display = 'none';
      } else {
        curImg.style.display = 'none';
        noPh.style.display = 'flex';
      }

      // Reset selected preview
      document.getElementById('selected-preview-wrap').style.display = 'none';
      document.getElementById('btn-submit').disabled = true;
      document.getElementById('btn-submit').textContent = 'Select an image first';

      // Auto-search
      autoSearch(p);
    }

    // ── AUTO SEARCH ──
    function autoSearch(p) {
      // Set default mode based on whether product has barcode
      if (p.barcode) {
        setMode('barcode', false);
      } else {
        setMode('name', false);
      }
      doSearch();
    }

    // ── SET SEARCH MODE ──
    function setMode(mode, andSearch = true) {
      currentMode = mode;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('mode-' + mode).classList.add('active');
      updateSearchQuery();
      if (andSearch) doSearch();
    }

    // ── BUILD SEARCH QUERY ──
    function updateSearchQuery() {
      const p = products[currentIndex];
      if (!p) return;
      const name = p.name.replace(/₹\s*\d+(?:\/-)?/g, '').trim();
      let q = '';
      if (currentMode === 'barcode') {
        q = p.barcode ? p.barcode + ' product India' : name + ' India';
      } else if (currentMode === 'namebar') {
        q = p.barcode ? name + ' ' + p.barcode + ' product' : name + ' product India';
      } else {
        q = name + ' product India';
      }
      document.getElementById('search-input').value = q;
    }

    // ── DO SEARCH ──
    async function doSearch() {
      const q = document.getElementById('search-input').value.trim();
      if (!q) return;

      const btn = document.getElementById('btn-search');
      btn.disabled = true;
      btn.textContent = '...';

      showMsg('spinner', 'Searching Google Images for "' + q + '"...');
      document.getElementById('result-count').textContent = 'Searching...';

      try {
        const res = await fetch('/api/search?q=' + encodeURIComponent(q));
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        renderImages(data);
        document.getElementById('result-count').textContent = data.length + ' results';
      } catch (err) {
        showMsg('❌', 'Search failed: ' + err.message);
        document.getElementById('result-count').textContent = 'Error';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Search';
      }
    }

    // ── RENDER IMAGE GRID ──
    function renderImages(images) {
      const grid = document.getElementById('image-grid');
      if (!images.length) {
        showMsg('🔍', 'No images found. Try editing the search query.');
        return;
      }
      grid.innerHTML = '';
      images.forEach((img, i) => {
        const card = document.createElement('div');
        card.className = 'img-card';
        card.id = 'img-card-' + i;
        card.onclick = () => selectImage(img.url, i);

        const el = document.createElement('img');
        el.src = img.url;
        el.alt = img.title || '';
        el.loading = 'lazy';
        el.onerror = () => { card.style.display = 'none'; };

        const title = document.createElement('div');
        title.className = 'img-title';
        title.textContent = img.title || img.url;

        card.appendChild(el);
        card.appendChild(title);
        grid.appendChild(card);
      });
    }

    // ── SELECT IMAGE ──
    function selectImage(url, index) {
      selectedImageUrl = url;

      // Highlight selected card
      document.querySelectorAll('.img-card').forEach(c => c.classList.remove('selected'));
      const card = document.getElementById('img-card-' + index);
      if (card) card.classList.add('selected');

      // Show preview
      const preview = document.getElementById('selected-preview');
      preview.src = url;
      document.getElementById('selected-preview-wrap').style.display = 'block';

      // Enable submit
      const btn = document.getElementById('btn-submit');
      btn.disabled = false;
      btn.textContent = '✅ Save & Next →';
    }

    // ── SUBMIT SELECTED IMAGE ──
    async function submitImage() {
      if (!selectedImageUrl) return;
      const p = products[currentIndex];
      const btn = document.getElementById('btn-submit');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      try {
        const res = await fetch('/api/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: p.id, imageUrl: selectedImageUrl })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        showToast('✅ Saved! Going to next product...', 'green');
        // Update cached image_url
        products[currentIndex].image_url = data.publicUrl;
        products[currentIndex].has_image = true;

        setTimeout(() => loadProduct(currentIndex + 1), 800);
      } catch (err) {
        showToast('❌ Save failed: ' + err.message, 'red');
        btn.disabled = false;
        btn.textContent = '✅ Save & Next →';
      }
    }

    // ── SKIP PRODUCT ──
    function skipProduct() {
      loadProduct(currentIndex + 1);
    }

    // ── SHOW STATE MESSAGE ──
    function showMsg(icon, text) {
      const grid = document.getElementById('image-grid');
      if (icon === 'spinner') {
        grid.innerHTML = '<div id="state-msg"><div class="spinner"></div><p>' + text + '</p></div>';
      } else {
        grid.innerHTML = '<div id="state-msg"><div class="icon">' + icon + '</div><p>' + text + '</p></div>';
      }
    }

    // ── TOAST ──
    function showToast(msg, color) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.background = color === 'green' ? '#238636' : '#da3633';
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 3000);
    }

    // ── START ──
    init();
  </script>
</body>
</html>`);
});

// ─── START SERVER ───
(async () => {
  try {
    await loadProductCache();
  } catch (err) {
    console.error('❌ Failed to load product cache:', err.message);
    console.error('Server will still start but /api/products will return 503 until cache loads.');
  }

  // Setup Supabase Realtime Listener to automatically fetch images for new products
  const channel = supabase
    .channel('server_product_inserts')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'products' },
      (payload) => {
        const newProd = payload.new;
        if (newProd && !newProd.image_url) {
          console.log(`\n🔔 [Server Realtime] New product created: "${newProd.display_name}" (ID: ${newProd.id})`);
          console.log(`⏳ Auto-fetching image using auto_images.js...`);
          exec(`node auto_images.js --id=${newProd.id}`, (err, stdout, stderr) => {
            if (err) {
              console.error(`❌ [Server Realtime] Image fetch failed for product ${newProd.id}:`, err.message);
            } else {
              console.log(`✅ [Server Realtime] Image fetch completed for product ${newProd.id}:\n`, stdout);
            }
          });
        }
      }
    )
    .subscribe((status) => {
      console.log(`[Server Realtime] Supabase product insert channel status: ${status}`);
    });

  app.listen(3000, () => {
    console.log('\n======================================================');
    console.log('🚀 Image Picker Portal is running at:');
    console.log('👉 http://localhost:3000');
    console.log('======================================================\n');
  });
})();
