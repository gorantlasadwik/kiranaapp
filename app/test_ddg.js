// test_ddg3.js - use DDG images API with token from search query page
const query = 'Parle G biscuit';

// DDG now uses a different endpoint to get VQD
const searchRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=images`, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'en-IN,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml',
  }
});
const html = await searchRes.text();

// Try multiple VQD patterns
const vqdPatterns = [
  /vqd=([\d-]+)/,
  /vqd="([\d-]+)"/,
  /"vqd":\s*"([^"]+)"/,
  /data-vqd="([^"]+)"/,
  /vqd=([^&"'\s]+)/,
];

let vqd = null;
for (const p of vqdPatterns) {
  const m = html.match(p);
  if (m?.[1]) { vqd = m[1]; console.log('Found VQD with pattern', p, '->', vqd); break; }
}

if (!vqd) {
  console.log('VQD not found. Checking HTML snippet...');
  // Print lines that have numbers or tokens
  html.split('\n').slice(0, 20).forEach(l => {
    if (l.length < 300) console.log(l.slice(0, 200));
  });
  process.exit(0);
}

// Try image search
const params = new URLSearchParams({ q: query, o: 'json', p: '1', s: '0', u: 'bing', f: ',,,', l: 'in-en', vqd });
const imgRes = await fetch('https://duckduckgo.com/i.js?' + params, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://duckduckgo.com/',
    'Accept': 'application/json',
  }
});
const data = await imgRes.json();
console.log('Image results:', data.results?.length);
if (data.results?.[0]) console.log('Top image:', data.results[0].image);
