package com.gorantlasadwik.synctunes;

import android.Manifest;
import android.graphics.Rect;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Handler;
import android.os.Looper;
import android.media.Image;
import android.os.AsyncTask;
import android.util.DisplayMetrics;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import androidx.annotation.OptIn;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ExperimentalGetImage;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.LifecycleOwner;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import java.util.List;

@CapacitorPlugin(
    name = "BarcodeScannerPlugin",
    permissions = {
        @Permission(
            alias = "camera",
            strings = { Manifest.permission.CAMERA }
        )
    }
)
public class BarcodeScannerPlugin extends Plugin {

    private FrameLayout scannerContainer = null;
    private PreviewView previewView = null;
    private ProcessCameraProvider cameraProvider = null;
    private Camera camera = null;
    private PluginCall activeCall = null;

    private Handler timerHandler = new Handler(Looper.getMainLooper());
    private Runnable flashRunnable = null;
    private Runnable zoomRunnable = null;

    private class ScanBoxOverlayView extends View {
        private Paint paint = new Paint();
        private Paint borderPaint = new Paint();
        private RectF box = new RectF();

        public ScanBoxOverlayView(android.content.Context context) {
            super(context);
            // Semi-transparent overlay paint (60% opacity black)
            paint.setColor(Color.parseColor("#99000000"));
            paint.setStyle(Paint.Style.FILL);
            
            // Border paint (amber yellow)
            borderPaint.setColor(Color.parseColor("#f59e0b"));
            borderPaint.setStyle(Paint.Style.STROKE);
            borderPaint.setStrokeWidth(6.0f);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            
            int width = getWidth();
            int height = getHeight();
            
            // Define box: center 60% width, 50% height
            float boxW = width * 0.6f;
            float boxH = height * 0.5f;
            float left = (width - boxW) / 2f;
            float right = left + boxW;
            float top = (height - boxH) / 2f;
            float bottom = top + boxH;
            
            box.set(left, top, right, bottom);
            
            // Draw four outer rectangles around the center box
            // Top overlay
            canvas.drawRect(0, 0, width, top, paint);
            // Left overlay
            canvas.drawRect(0, top, left, bottom, paint);
            // Right overlay
            canvas.drawRect(right, top, width, bottom, paint);
            // Bottom overlay
            canvas.drawRect(0, bottom, width, height, paint);
            
            // Draw center box border
            canvas.drawRect(box, borderPaint);
            
            // Draw corners
            Paint cornerPaint = new Paint();
            cornerPaint.setColor(Color.parseColor("#f59e0b"));
            cornerPaint.setStyle(Paint.Style.STROKE);
            cornerPaint.setStrokeWidth(12.0f);
            
            float cl = 40.0f; // corner length
            // Top-left corner
            canvas.drawLine(left, top, left + cl, top, cornerPaint);
            canvas.drawLine(left, top, left, top + cl, cornerPaint);
            
            // Top-right corner
            canvas.drawLine(right, top, right - cl, top, cornerPaint);
            canvas.drawLine(right, top, right, top + cl, cornerPaint);
            
            // Bottom-left corner
            canvas.drawLine(left, bottom, left + cl, bottom, cornerPaint);
            canvas.drawLine(left, bottom, left, bottom - cl, cornerPaint);
            
            // Bottom-right corner
            canvas.drawLine(right, bottom, right - cl, bottom, cornerPaint);
            canvas.drawLine(right, bottom, right, bottom - cl, cornerPaint);
        }
    }

    @PluginMethod
    public void startScan(PluginCall call) {
        if (activeCall != null) {
            activeCall.reject("A scan session is already in progress");
            return;
        }

        if (getPermissionState("camera") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermissionCallback");
            return;
        }

        activeCall = call;
        setupAndStartScanner(call);
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        if (getPermissionState("camera") == com.getcapacitor.PermissionState.GRANTED) {
            activeCall = call;
            setupAndStartScanner(call);
        } else {
            call.reject("Camera permission was denied");
        }
    }

    private void setupAndStartScanner(PluginCall call) {
        // Retrieve and scale coordinates
        final double x = call.getDouble("x", 0.0);
        final double y = call.getDouble("y", 0.0);
        final double width = call.getDouble("width", 300.0);
        final double height = call.getDouble("height", 300.0);

        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    DisplayMetrics dm = getContext().getResources().getDisplayMetrics();
                    float density = dm.density;
                    int pxX = (int) (x * density);
                    int pxY = (int) (y * density);
                    int pxWidth = (int) (width * density);
                    int pxHeight = (int) (height * density);

                    // Ensure minimum dimensions
                    if (pxWidth <= 0) pxWidth = (int) (300 * density);
                    if (pxHeight <= 0) pxHeight = (int) (200 * density);

                    // Create view container
                    ViewGroup rootView = (ViewGroup) getActivity().getWindow().getDecorView().findViewById(android.R.id.content);
                    if (scannerContainer != null) {
                        rootView.removeView(scannerContainer);
                    }

                    scannerContainer = new FrameLayout(getContext());
                    scannerContainer.setId(View.generateViewId());
                    
                    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(pxWidth, pxHeight);
                    lp.leftMargin = pxX;
                    lp.topMargin = pxY;
                    scannerContainer.setLayoutParams(lp);

                    previewView = new PreviewView(getContext());
                    previewView.setLayoutParams(new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    ));
                    // Scale type fit center or fill to keep aspects matching the box
                    previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
                    scannerContainer.addView(previewView);

                    ScanBoxOverlayView overlayView = new ScanBoxOverlayView(getContext());
                    overlayView.setLayoutParams(new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    ));
                    scannerContainer.addView(overlayView);

                    rootView.addView(scannerContainer);

                    // Bind CameraX
                    bindCameraUseCases(call);

                } catch (Exception e) {
                    cleanupScanner();
                    call.reject("Failed to setup native preview container: " + e.getMessage());
                }
            }
        });
    }

    private void bindCameraUseCases(PluginCall call) {
        ListenableFuture<ProcessCameraProvider> cameraProviderFuture = ProcessCameraProvider.getInstance(getContext());
        cameraProviderFuture.addListener(new Runnable() {
            @Override
            public void run() {
                try {
                    cameraProvider = cameraProviderFuture.get();

                    // Preview
                    Preview preview = new Preview.Builder().build();
                    preview.setSurfaceProvider(previewView.getSurfaceProvider());

                    // Image Analysis (continuous frames processing)
                    ImageAnalysis imageAnalysis = new ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build();

                    // Configure ML Kit barcode scanner (1D codes only)
                    BarcodeScannerOptions options = new BarcodeScannerOptions.Builder()
                        .setBarcodeFormats(
                            Barcode.FORMAT_EAN_13,
                            Barcode.FORMAT_UPC_A,
                            Barcode.FORMAT_EAN_8,
                            Barcode.FORMAT_CODE_128,
                            Barcode.FORMAT_CODE_39,
                            Barcode.FORMAT_ITF
                        )
                        .build();

                    BarcodeScanner scanner = BarcodeScanning.getClient(options);
                    long startedAt = System.currentTimeMillis();

                    imageAnalysis.setAnalyzer(AsyncTask.THREAD_POOL_EXECUTOR, new ImageAnalysis.Analyzer() {
                        @Override
                        @OptIn(markerClass = ExperimentalGetImage.class)
                        public void analyze(androidx.camera.core.ImageProxy imageProxy) {
                            Image mediaImage = imageProxy.getImage();
                            if (mediaImage != null) {
                                InputImage image = InputImage.fromMediaImage(mediaImage, imageProxy.getImageInfo().getRotationDegrees());
                                scanner.process(image)
                                    .addOnSuccessListener(barcodes -> {
                                        if (barcodes.size() > 0 && activeCall != null) {
                                            Barcode selected = pickBestBarcode(barcodes, image.getWidth(), image.getHeight());
                                            if (selected != null) {
                                                String rawValue = selected.getRawValue();
                                                int format = selected.getFormat();
                                                long elapsed = System.currentTimeMillis() - startedAt;

                                                // Found it, notify on main thread
                                                getActivity().runOnUiThread(() -> {
                                                    resolveScan(rawValue, format, elapsed);
                                                });
                                            }
                                        }
                                    })
                                    .addOnFailureListener(e -> {
                                        // Ignore frame failure
                                    })
                                    .addOnCompleteListener(task -> {
                                        imageProxy.close();
                                    });
                            } else {
                                imageProxy.close();
                            }
                        }
                    });

                    CameraSelector cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA;
                    cameraProvider.unbindAll();

                    camera = cameraProvider.bindToLifecycle(
                        (LifecycleOwner) getActivity(),
                        cameraSelector,
                        preview,
                        imageAnalysis
                    );

                    flashRunnable = new Runnable() {
                        @Override
                        public void run() {
                            if (camera != null && activeCall != null) {
                                camera.getCameraControl().enableTorch(true);
                            }
                        }
                    };
                    zoomRunnable = new Runnable() {
                        @Override
                        public void run() {
                            if (camera != null && activeCall != null) {
                                camera.getCameraControl().setZoomRatio(2.0f);
                            }
                        }
                    };

                    timerHandler.postDelayed(flashRunnable, 2000);
                    timerHandler.postDelayed(zoomRunnable, 4000);

                } catch (Exception e) {
                    cleanupScanner();
                    call.reject("Failed to bind CameraX use cases: " + e.getMessage());
                }
            }
        }, ContextCompat.getMainExecutor(getContext()));
    }

    private Barcode pickBestBarcode(List<Barcode> barcodes, int imgW, int imgH) {
        Barcode best = null;
        int highestPriority = 999;

        // Bounding box filter (Relative to InputImage coordinates):
        // Only accept barcodes whose center lies within the central 60% width and 50% height scan box region.
        double leftLimit = imgW * 0.20;
        double rightLimit = imgW * 0.80;
        double topLimit = imgH * 0.25;
        double bottomLimit = imgH * 0.75;

        for (Barcode b : barcodes) {
            String value = b.getRawValue();
            if (value == null) continue;

            Rect rect = b.getBoundingBox();
            if (rect != null) {
                int cx = rect.centerX();
                int cy = rect.centerY();
                if (cx < leftLimit || cx > rightLimit || cy < topLimit || cy > bottomLimit) {
                    continue; // Skip barcodes outside the scan box
                }
            } else {
                continue; // Skip if bounding box is not available
            }

            int format = b.getFormat();
            int priority = 99;

            if (value.startsWith("SYS-")) {
                priority = 1;
            } else if (value.startsWith("299")) {
                priority = 2;
            } else if (value.startsWith("890") && format == Barcode.FORMAT_EAN_13) {
                priority = 3;
            } else if (format == Barcode.FORMAT_EAN_13) {
                priority = 4;
            } else if (format == Barcode.FORMAT_UPC_A) {
                priority = 5;
            } else if (format == Barcode.FORMAT_EAN_8) {
                priority = 6;
            } else if (format == Barcode.FORMAT_CODE_128) {
                priority = 7;
            } else if (format == Barcode.FORMAT_CODE_39) {
                priority = 8;
            } else if (format == Barcode.FORMAT_ITF) {
                priority = 9;
            }

            if (priority < highestPriority) {
                highestPriority = priority;
                best = b;
            }
        }
        return best;
    }

    private String getFormatString(int format) {
        switch (format) {
            case Barcode.FORMAT_EAN_13: return "EAN_13";
            case Barcode.FORMAT_UPC_A: return "UPC_A";
            case Barcode.FORMAT_EAN_8: return "EAN_8";
            case Barcode.FORMAT_CODE_128: return "CODE_128";
            case Barcode.FORMAT_CODE_39: return "CODE_39";
            case Barcode.FORMAT_ITF: return "ITF";
            default: return "UNKNOWN";
        }
    }

    private void resolveScan(String value, int format, long elapsedMs) {
        if (activeCall == null) return;

        cleanupScanner();

        JSObject ret = new JSObject();
        ret.put("value", value);
        ret.put("format", getFormatString(format));
        ret.put("length", value.length());
        ret.put("detectionTimeMs", elapsedMs);

        PluginCall call = activeCall;
        activeCall = null;
        call.resolve(ret);
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        cleanupScanner();
        activeCall = null;
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void setTorch(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        attemptSetTorch(call, enabled, 0);
    }

    private void attemptSetTorch(PluginCall call, boolean enabled, int retryCount) {
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (flashRunnable != null) {
                    timerHandler.removeCallbacks(flashRunnable);
                    flashRunnable = null;
                }
                if (camera != null) {
                    try {
                        ListenableFuture<Void> future = camera.getCameraControl().enableTorch(enabled);
                        future.addListener(new Runnable() {
                            @Override
                            public void run() {
                                try {
                                    future.get();
                                    JSObject ret = new JSObject();
                                    ret.put("success", true);
                                    call.resolve(ret);
                                } catch (Exception e) {
                                    call.reject("Failed to toggle torch: " + e.getMessage());
                                }
                            }
                        }, ContextCompat.getMainExecutor(getContext()));
                    } catch (Exception e) {
                        call.reject("Failed to set torch: " + e.getMessage());
                    }
                } else if (activeCall != null && retryCount < 5) {
                    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            attemptSetTorch(call, enabled, retryCount + 1);
                        }
                    }, 200);
                } else {
                    call.reject("Camera is not active or initialized on native side");
                }
            }
        });
    }

    private void cleanupScanner() {
        if (flashRunnable != null) {
            timerHandler.removeCallbacks(flashRunnable);
            flashRunnable = null;
        }
        if (zoomRunnable != null) {
            timerHandler.removeCallbacks(zoomRunnable);
            zoomRunnable = null;
        }
        getActivity().runOnUiThread(() -> {
            if (cameraProvider != null) {
                try {
                    cameraProvider.unbindAll();
                } catch (Exception e) {
                    // Ignore
                }
                cameraProvider = null;
            }
            camera = null;

            if (scannerContainer != null) {
                ViewGroup rootView = (ViewGroup) getActivity().getWindow().getDecorView().findViewById(android.R.id.content);
                rootView.removeView(scannerContainer);
                scannerContainer = null;
                previewView = null;
            }
        });
    }
}
