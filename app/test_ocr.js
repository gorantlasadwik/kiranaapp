import Tesseract from 'tesseract.js';
import fetch from 'node-fetch';

console.log('Testing Tesseract.js OCR...');
try {
  // Let's use a known public image of Colgate
  const imgUrl = 'https://m.media-amazon.com/images/I/71O4KJu7QSL._AC_UF350,350_QL80_.jpg';
  console.log('Downloading test image...');
  const res = await fetch(imgUrl);
  if (!res.ok) throw new Error('Download failed');
  const buffer = await res.arrayBuffer();
  console.log('Buffer size:', buffer.byteLength, 'bytes');

  console.log('Running OCR recognition (this might download eng.traineddata)...');
  const { data: { text } } = await Tesseract.recognize(
    Buffer.from(buffer),
    'eng',
    { logger: m => console.log('Tesseract progress:', m) }
  );

  console.log('\n--- OCR RESULT ---');
  console.log(text);
  console.log('------------------');
} catch (err) {
  console.error('OCR test error:', err);
}
