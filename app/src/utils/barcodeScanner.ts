import { Capacitor, registerPlugin } from '@capacitor/core';

const BarcodeScannerPlugin = registerPlugin<any>('BarcodeScannerPlugin');

// ─── State ───────────────────────────────────────────────────────────────────
let activeMode: 'native-mlkit' | 'native-capacitor' | 'native' | 'quagga' | null = null;
let stopRequested = false;

// Native mode resources
let nativeStream: MediaStream | null = null;
let nativeVideo: HTMLVideoElement | null = null;
let nativeRafId: number | null = null;
let activeVideoTrack: MediaStreamTrack | null = null;
let lastAcceptedBarcode = '';
let lastAcceptedAt = 0;
let flashTimer: any = null;
let zoomTimer: any = null;

type BarcodeCandidate = {
  code: string;
  format: string;
};

const DUPLICATE_WINDOW_MS = 2000;
const BARCODE_DEBUG = true;

const FORMAT_PRIORITY: Record<string, number> = {
  internal_sys: 1,
  internal_numeric: 1,
  ean_13_890: 2,
  ean_13: 3,
  upc_a: 4,
  ean_8: 5,
  code_128: 6,
  code_39: 7,
  itf: 8,
};

function normalizeFormat(format?: string): string {
  const f = (format || '').toLowerCase().replace(/[_\s-]/g, '');
  if (f.includes('ean13') || f === 'ean') return 'ean_13';
  if (f.includes('ean8')) return 'ean_8';
  if (f.includes('upca')) return 'upc_a';
  if (f.includes('upce')) return 'upc_e';
  if (f.includes('code128')) return 'code_128';
  if (f.includes('code39')) return 'code_39';
  if (f.includes('i2of5') || f.includes('itf') || f.includes('interleaved2of5')) return 'itf';
  return format || 'unknown';
}

function cleanBarcode(raw: string): string {
  return (raw || '').trim().replace(/\s+/g, '').toUpperCase();
}

function hasValidGtinCheckDigit(code: string): boolean {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const checkDigit = digits[digits.length - 1];
  const body = digits.slice(0, -1).reverse();
  const sum = body.reduce((total, digit, idx) => total + digit * (idx % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
}

export function isValidBarcodeCandidate(rawCode: string, rawFormat = ''): boolean {
  const code = cleanBarcode(rawCode);
  const format = normalizeFormat(rawFormat);
  if (!code) return false;
  if (/^SYS-\d+(?:-\d+)?$/.test(code)) return true;
  if (/^299\d{6,}$/.test(code)) return true;
  if (format === 'ean_13') return /^\d{13}$/.test(code) && hasValidGtinCheckDigit(code);
  if (format === 'upc_a') return /^\d{12}$/.test(code) && hasValidGtinCheckDigit(code);
  if (format === 'ean_8') return /^\d{8}$/.test(code) && hasValidGtinCheckDigit(code);
  if (format === 'upc_e') return false;
  if (format === 'code_128') return /^SYS-\d+(?:-\d+)?$/.test(code) || /^299\d{6,}$/.test(code) || (/^[A-Z0-9-]{4,40}$/.test(code) && !/^\d{4,8}$/.test(code));
  if (format === 'code_39') return /^SYS-\d+(?:-\d+)?$/.test(code) || (/^[A-Z0-9 .$/+%-]{4,40}$/.test(code) && !/^\d{4,8}$/.test(code));
  if (format === 'itf') return /^\d{6,18}$/.test(code);
  if (/^890\d{10}$/.test(code)) return hasValidGtinCheckDigit(code);
  if (/^\d{13}$/.test(code) || /^\d{12}$/.test(code) || /^\d{8}$/.test(code)) return hasValidGtinCheckDigit(code);
  return /^SYS-\d+(?:-\d+)?$/.test(code) || /^299\d{6,}$/.test(code);
}

function getBarcodePriority(candidate: BarcodeCandidate): number {
  const code = cleanBarcode(candidate.code);
  const format = normalizeFormat(candidate.format);
  if (/^SYS-\d+(?:-\d+)?$/.test(code)) return FORMAT_PRIORITY.internal_sys;
  if (/^299\d{6,}$/.test(code)) return FORMAT_PRIORITY.internal_numeric;
  if (/^890\d{10}$/.test(code)) return FORMAT_PRIORITY.ean_13_890;
  if (format === 'ean_13' || /^\d{13}$/.test(code)) return FORMAT_PRIORITY.ean_13;
  if (format === 'upc_a' || /^\d{12}$/.test(code)) return FORMAT_PRIORITY.upc_a;
  if (format === 'ean_8' || /^\d{8}$/.test(code)) return FORMAT_PRIORITY.ean_8;
  if (format === 'code_128') return FORMAT_PRIORITY.code_128;
  if (format === 'code_39') return FORMAT_PRIORITY.code_39;
  if (format === 'itf') return FORMAT_PRIORITY.itf;
  return 99;
}

export function pickBestBarcodeCandidate(candidates: BarcodeCandidate[]): BarcodeCandidate | null {
  const valid = candidates
    .map(c => ({ code: cleanBarcode(c.code), format: normalizeFormat(c.format) }))
    .filter(c => isValidBarcodeCandidate(c.code, c.format));
  if (!valid.length) return null;
  valid.sort((a, b) => getBarcodePriority(a) - getBarcodePriority(b));
  return valid[0];
}

async function acceptDetectedBarcode(
  candidates: BarcodeCandidate[],
  startedAt: number,
  onDetected: (code: string) => void
): Promise<boolean> {
  const selected = pickBestBarcodeCandidate(candidates);
  if (!selected) return false;

  const now = Date.now();
  if (selected.code === lastAcceptedBarcode && now - lastAcceptedAt < DUPLICATE_WINDOW_MS) {
    if (BARCODE_DEBUG) {
      console.log('[BarcodeScanner] Duplicate ignored', {
        barcode_value: selected.code,
        barcode_format: selected.format,
        barcode_length: selected.code.length,
      });
    }
    await stopBarcodeScanner();
    return true;
  }

  lastAcceptedBarcode = selected.code;
  lastAcceptedAt = now;
  if (BARCODE_DEBUG) {
    console.log('[BarcodeScanner] Barcode accepted', {
      barcode_value: selected.code,
      barcode_format: selected.format,
      barcode_length: selected.code.length,
      detection_time: `${now - startedAt}ms`,
    });
  }
  await stopBarcodeScanner();
  onDetected(selected.code);
  return true;
}

// Intercept getUserMedia globally to capture camera track (covers library internals like Quagga2)
if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async function (constraints) {
    const stream = await originalGetUserMedia(constraints);
    const track = stream.getVideoTracks()[0];
    if (track) {
      activeVideoTrack = track;
    }
    return stream;
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function setTorch(on: boolean): Promise<boolean> {
  if (flashTimer) {
    clearTimeout(flashTimer);
    flashTimer = null;
  }
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await BarcodeScannerPlugin.setTorch({ enabled: on });
      if (res && res.success) {
        return true;
      }
    } catch (err) {
      console.warn('[BarcodeScanner] Native setTorch failed, falling back to Web camera track:', err);
    }
  }

  if (!activeVideoTrack) {
    console.warn('[BarcodeScanner] No active camera track found');
    return false;
  }
  try {
    const capabilities = typeof activeVideoTrack.getCapabilities === 'function' 
      ? (activeVideoTrack.getCapabilities() as any) 
      : null;
    
    if (capabilities && !capabilities.torch) {
      console.warn('[BarcodeScanner] Torch is not supported by this camera device');
      return false;
    }

    await activeVideoTrack.applyConstraints({
      advanced: [{ torch: on }]
    } as any);
    return true;
  } catch (err) {
    console.error('[BarcodeScanner] Failed to set torch constraint:', err);
    return false;
  }
}

export async function startBarcodeScanner(
  containerId: string,
  onDetected: (code: string) => void,
  onError: (err: string) => void
): Promise<void> {
  if (activeMode) return; // already running
  stopRequested = false;

  if (!Capacitor.isNativePlatform()) {
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(async () => {
      if (activeMode) {
        await setTorch(true);
        console.log('[BarcodeScanner] Browser flash auto-enabled');
      }
    }, 2000);

    if (zoomTimer) clearTimeout(zoomTimer);
    zoomTimer = setTimeout(async () => {
      if (activeMode && activeVideoTrack) {
        try {
          const capabilities = typeof activeVideoTrack.getCapabilities === 'function' 
            ? (activeVideoTrack.getCapabilities() as any) 
            : null;
          if (capabilities && capabilities.zoom) {
            const max = capabilities.zoom.max || 2;
            const targetZoom = Math.min(2.0, max);
            await activeVideoTrack.applyConstraints({
              advanced: [{ zoom: targetZoom }]
            } as any);
            console.log('[BarcodeScanner] Browser zoom auto-enabled');
          }
        } catch (err) {}
      }
    }, 4000);
  }

  if (Capacitor.isNativePlatform()) {
    try {
      const container = document.getElementById(containerId);
      if (!container) {
        throw new Error(`Viewfinder container #${containerId} not found`);
      }

      const rect = container.getBoundingClientRect();
      const startedAt = Date.now();

      activeMode = 'native-mlkit';

      const result = await BarcodeScannerPlugin.startScan({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      });

      const now = Date.now();
      const code = (result.value || '').trim();
      const format = result.format;
      const elapsed = result.detectionTimeMs || (now - startedAt);

      if (!code) {
        throw new Error('No barcode returned');
      }

      // Check duplicate scan window
      if (code === lastAcceptedBarcode && now - lastAcceptedAt < DUPLICATE_WINDOW_MS) {
        if (BARCODE_DEBUG) {
          console.log('[BarcodeScanner] Native duplicate ignored', {
            barcode_value: code,
            barcode_format: format,
            barcode_length: code.length
          });
        }
        await stopBarcodeScanner();
        return;
      }

      lastAcceptedBarcode = code;
      lastAcceptedAt = now;

      if (BARCODE_DEBUG) {
        console.log('[BarcodeScanner] Native barcode accepted', {
          barcode_value: code,
          barcode_format: format,
          barcode_length: code.length,
          detection_time: `${elapsed}ms`
        });
      }

      await stopBarcodeScanner();
      onDetected(code);
      return;
    } catch (e: any) {
      console.error('[BarcodeScanner] Native scanner failed, falling back to Web components:', e);
      await stopBarcodeScanner();
      stopRequested = false;
    }
  }

  // 1. Try Native BarcodeDetector first (fastest — hardware accelerated on Android)
  if (typeof (window as any).BarcodeDetector !== 'undefined') {
    try {
      await startNativeScanner(containerId, onDetected, onError);
      return;
    } catch (e) {
      console.warn('Native BarcodeDetector failed, falling back to Quagga2:', e);
      await stopBarcodeScanner(); // clean up any partial state
      stopRequested = false;
    }
  }

  // 2. Fall back to Quagga2
  await startQuaggaScanner(containerId, onDetected, onError);
}

export async function stopBarcodeScanner(): Promise<void> {
  stopRequested = true;
  const mode = activeMode;
  activeMode = null;
  activeVideoTrack = null;

  if (flashTimer) {
    clearTimeout(flashTimer);
    flashTimer = null;
  }
  if (zoomTimer) {
    clearTimeout(zoomTimer);
    zoomTimer = null;
  }

  if (mode === 'native-mlkit') {
    try {
      await BarcodeScannerPlugin.stopScan();
    } catch (e) {
      // ignore
    }
  } else if (mode === 'native-capacitor') {
    // The Capacitor barcode scanner runs as a native modal, so stopping is handled natively or via user cancel.
  } else if (mode === 'native') {
    if (nativeRafId !== null) {
      cancelAnimationFrame(nativeRafId);
      nativeRafId = null;
    }
    if (nativeVideo) {
      nativeVideo.srcObject = null;
      nativeVideo.remove();
      nativeVideo = null;
    }
    if (nativeStream) {
      nativeStream.getTracks().forEach(t => t.stop());
      nativeStream = null;
    }
  } else if (mode === 'quagga') {
    try {
      const Quagga = (await import('@ericblade/quagga2')).default;
      Quagga.offDetected();
      Quagga.stop();
    } catch (e) {
      // ignore
    }
  }
}

// ─── Native BarcodeDetector (Android Chrome / Edge) ──────────────────────────

async function startNativeScanner(
  containerId: string,
  onDetected: (code: string) => void,
  _onError: (err: string) => void
): Promise<void> {
  const startedAt = Date.now();
  const container = document.getElementById(containerId);
  if (!container) throw new Error(`Container #${containerId} not found`);

  // Build detector for 1D formats
  const BarcodeDetector = (window as any).BarcodeDetector;
  const supported: string[] = await BarcodeDetector.getSupportedFormats();
  const desired = ['ean_13', 'upc_a', 'ean_8', 'code_128', 'code_39', 'itf'];
  const formats = desired.filter(f => supported.includes(f));
  if (formats.length === 0) throw new Error('No supported 1D formats');

  const detector = new BarcodeDetector({ formats });

  // Get camera stream
  nativeStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'environment',
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  activeVideoTrack = nativeStream.getVideoTracks()[0] || null;

  // Create a video element and append to the container
  const video = document.createElement('video');
  video.setAttribute('playsinline', 'true');
  video.setAttribute('autoplay', 'true');
  video.setAttribute('muted', 'true');
  video.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;';
  container.innerHTML = '';
  container.appendChild(video);
  nativeVideo = video;

  video.srcObject = nativeStream;
  await video.play();

  activeMode = 'native';

  // Scanning loop using rAF for max responsiveness
  const scan = async () => {
    if (stopRequested || activeMode !== 'native') return;

    try {
      const results = await detector.detect(video);
      if (results.length > 0) {
        // Filter results: check if barcode center lies inside 60%x50% scan region
        const filtered = results.filter((r: any) => {
          if (!r.boundingBox) return false;
          const rect = r.boundingBox;
          const cx = rect.x + rect.width / 2;
          const cy = rect.y + rect.height / 2;
          const videoW = video.videoWidth || 1280;
          const videoH = video.videoHeight || 720;
          const leftLimit = videoW * 0.20;
          const rightLimit = videoW * 0.80;
          const topLimit = videoH * 0.25;
          const bottomLimit = videoH * 0.75;
          return cx >= leftLimit && cx <= rightLimit && cy >= topLimit && cy <= bottomLimit;
        });

        if (filtered.length > 0) {
          const candidates = filtered.map((result: any) => ({
            code: result.rawValue,
            format: result.format,
          }));
          if (await acceptDetectedBarcode(candidates, startedAt, onDetected)) return;
        }
      }
    } catch (e) {
      // Frame not ready yet — keep scanning
    }

    nativeRafId = requestAnimationFrame(() => { scan(); });
  };

  nativeRafId = requestAnimationFrame(() => { scan(); });
}

// ─── Quagga2 Fallback ─────────────────────────────────────────────────────────

async function startQuaggaScanner(
  containerId: string,
  onDetected: (code: string) => void,
  onError: (err: string) => void
): Promise<void> {
  try {
    const startedAt = Date.now();
    const Quagga = (await import('@ericblade/quagga2')).default;

    await new Promise<void>((resolve, reject) => {
      Quagga.init(
        {
          inputStream: {
            type: 'LiveStream',
            target: document.getElementById(containerId) as HTMLElement,
            constraints: {
              facingMode: 'environment',
              width: { min: 640, ideal: 1280, max: 1920 },
              height: { min: 480, ideal: 720, max: 1080 },
            },
            area: {
              top: '25%',
              right: '20%',
              left: '20%',
              bottom: '25%',
            },
          },
          decoder: {
            readers: [
              'ean_reader',        // EAN-13
              'upc_reader',        // UPC-A
              'ean_8_reader',      // EAN-8
              'code_128_reader',   // CODE-128
              'code_39_reader',    // CODE-39
              'i2of5_reader',      // ITF
            ],
            multiple: true,
          },
          locate: true,
          numOfWorkers: 2,
          frequency: 15,
        },
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    activeMode = 'quagga';

    Quagga.onDetected(async (result) => {
      if (stopRequested) return;
      const code = result?.codeResult?.code;
      if (!code) return;
      const candidates: BarcodeCandidate[] = [
        {
          code,
          format: result?.codeResult?.format,
        },
        ...((result as any)?.barcodes || []).map((candidate: any) => ({
          code: candidate?.codeResult?.code || candidate?.code,
          format: candidate?.codeResult?.format || candidate?.format,
        })),
      ];
      await acceptDetectedBarcode(candidates, startedAt, onDetected);
    });

    Quagga.start();
  } catch (err: any) {
    activeMode = null;
    console.error('Quagga2 start error:', err);
    onError(err?.message || 'Could not start camera. Check permissions.');
  }
}
