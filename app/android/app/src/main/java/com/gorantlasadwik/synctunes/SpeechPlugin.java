package com.gorantlasadwik.synctunes;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

@CapacitorPlugin(
    name = "SpeechPlugin",
    permissions = {
        @Permission(strings = {Manifest.permission.RECORD_AUDIO}, alias = "microphone")
    }
)
public class SpeechPlugin extends Plugin {
    private SpeechRecognizer speechRecognizer;
    private PluginCall activeCall;
    private String lastDetectedLanguage = "";
    private int lastLanguageDetectionConfidence = SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL_UNKNOWN;
    private int lastLanguageSwitchResult = SpeechRecognizer.LANGUAGE_SWITCH_RESULT_NOT_ATTEMPTED;

    @PluginMethod
    public void startListening(PluginCall call) {
        if (!getPermissionState("microphone").equals(com.getcapacitor.PermissionState.GRANTED)) {
            requestPermissionForAlias("microphone", call, "microphoneCallback");
            return;
        }
        startSpeechService(call);
    }

    @PermissionCallback
    private void microphoneCallback(PluginCall call) {
        if (getPermissionState("microphone").equals(com.getcapacitor.PermissionState.GRANTED)) {
            startSpeechService(call);
        } else {
            call.reject("PERMISSION_DENIED", "Microphone permission was denied by the user.");
        }
    }

    private void startSpeechService(PluginCall call) {
        this.activeCall = call;
        getBridge().getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    // Destroy any previous recognizer to avoid ERROR_RECOGNIZER_BUSY
                    if (speechRecognizer != null) {
                        speechRecognizer.cancel();
                        speechRecognizer.destroy();
                        speechRecognizer = null;
                    }
                    lastDetectedLanguage = "";
                    lastLanguageDetectionConfidence = SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL_UNKNOWN;
                    lastLanguageSwitchResult = SpeechRecognizer.LANGUAGE_SWITCH_RESULT_NOT_ATTEMPTED;

                    if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                        if (activeCall != null) {
                            activeCall.reject("ENGINE_UNAVAILABLE", "Speech recognition engine is not available on this device.");
                            activeCall = null;
                        }
                        return;
                    }

                    speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                    speechRecognizer.setRecognitionListener(new RecognitionListener() {
                        @Override
                        public void onReadyForSpeech(Bundle params) {
                            JSObject ret = new JSObject();
                            ret.put("status", "ready");
                            notifyListeners("onStatusChange", ret);
                        }

                        @Override
                        public void onBeginningOfSpeech() {
                            JSObject ret = new JSObject();
                            ret.put("status", "listening");
                            notifyListeners("onStatusChange", ret);
                        }

                        @Override
                        public void onRmsChanged(float rmsdB) {
                            // Emit volume level for animated mic indicator
                            JSObject ret = new JSObject();
                            ret.put("rms", rmsdB);
                            notifyListeners("onRmsChange", ret);
                        }

                        @Override
                        public void onBufferReceived(byte[] buffer) {}

                        @Override
                        public void onEndOfSpeech() {
                            JSObject ret = new JSObject();
                            ret.put("status", "processing");
                            notifyListeners("onStatusChange", ret);
                        }

                        @Override
                        public void onError(int error) {
                            String code;
                            String message;
                            switch (error) {
                                case SpeechRecognizer.ERROR_AUDIO:
                                    code = "ERROR_AUDIO";
                                    message = "Audio recording error. Check microphone hardware.";
                                    break;
                                case SpeechRecognizer.ERROR_CLIENT:
                                    code = "ERROR_CLIENT";
                                    message = "Speech client error. Please try again.";
                                    break;
                                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                                    code = "PERMISSION_DENIED";
                                    message = "Microphone permission denied.";
                                    break;
                                case SpeechRecognizer.ERROR_NETWORK:
                                    code = "ERROR_NETWORK";
                                    message = "Network error. Speech engine may need internet for first-time setup.";
                                    break;
                                case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                                    code = "ERROR_NETWORK_TIMEOUT";
                                    message = "Network timeout. Check your internet connection.";
                                    break;
                                case SpeechRecognizer.ERROR_NO_MATCH:
                                    code = "ERROR_NO_MATCH";
                                    message = "Could not hear you clearly. Please try again.";
                                    break;
                                case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                                    code = "ERROR_RECOGNIZER_BUSY";
                                    message = "Speech engine is busy. Please wait a moment.";
                                    break;
                                case SpeechRecognizer.ERROR_SERVER:
                                    code = "ERROR_SERVER";
                                    message = "Server error from speech engine.";
                                    break;
                                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                                    code = "ERROR_SPEECH_TIMEOUT";
                                    message = "No speech detected. Please speak clearly.";
                                    break;
                                default:
                                    code = "ERROR_UNKNOWN";
                                    message = "Speech recognition failed (code " + error + "). Please try again.";
                                    break;
                            }
                            if (activeCall != null) {
                                activeCall.reject(code, message);
                                activeCall = null;
                            }
                        }

                        @Override
                        public void onResults(Bundle results) {
                            ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                            float[] confidences = results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
                            if (matches != null && !matches.isEmpty()) {
                                String detectedLanguage = results.getString(SpeechRecognizer.DETECTED_LANGUAGE);
                                if (detectedLanguage != null && !detectedLanguage.isEmpty()) {
                                    lastDetectedLanguage = detectedLanguage;
                                }
                                JSObject ret = new JSObject();
                                ret.put("transcript", matches.get(0));
                                ret.put("detectedLanguage", lastDetectedLanguage);
                                ret.put("languageDetectionConfidence", lastLanguageDetectionConfidence);
                                ret.put("languageSwitchResult", lastLanguageSwitchResult);
                                // Include top 3 alternatives if available
                                if (matches.size() > 1) ret.put("alt1", matches.get(1));
                                if (matches.size() > 2) ret.put("alt2", matches.get(2));
                                if (confidences != null && confidences.length > 0) {
                                    ret.put("confidence", confidences[0]);
                                }
                                if (activeCall != null) {
                                    activeCall.resolve(ret);
                                    activeCall = null;
                                }
                            } else {
                                if (activeCall != null) {
                                    activeCall.reject("ERROR_NO_MATCH", "No speech matches found.");
                                    activeCall = null;
                                }
                            }
                        }

                        @Override
                        public void onPartialResults(Bundle partialResults) {
                            // Fire partial transcript events so UI can update live as user speaks
                            ArrayList<String> partials = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                            if (partials != null && !partials.isEmpty()) {
                                JSObject ret = new JSObject();
                                ret.put("partial", partials.get(0));
                                ret.put("detectedLanguage", lastDetectedLanguage);
                                ret.put("languageDetectionConfidence", lastLanguageDetectionConfidence);
                                ret.put("languageSwitchResult", lastLanguageSwitchResult);
                                notifyListeners("onPartialResult", ret);
                            }
                        }

                        @Override
                        public void onLanguageDetection(Bundle results) {
                            String detectedLanguage = results.getString(SpeechRecognizer.DETECTED_LANGUAGE);
                            if (detectedLanguage != null && !detectedLanguage.isEmpty()) {
                                lastDetectedLanguage = detectedLanguage;
                            }
                            lastLanguageDetectionConfidence = results.getInt(
                                SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL,
                                SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL_UNKNOWN
                            );
                            lastLanguageSwitchResult = results.getInt(
                                SpeechRecognizer.LANGUAGE_SWITCH_RESULT,
                                SpeechRecognizer.LANGUAGE_SWITCH_RESULT_NOT_ATTEMPTED
                            );

                            JSObject ret = new JSObject();
                            ret.put("detectedLanguage", lastDetectedLanguage);
                            ret.put("languageDetectionConfidence", lastLanguageDetectionConfidence);
                            ret.put("languageSwitchResult", lastLanguageSwitchResult);
                            notifyListeners("onLanguageDetection", ret);
                        }

                        @Override
                        public void onEvent(int eventType, Bundle params) {}
                    });

                    Intent recognizerIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    ArrayList<String> supportedLanguages = new ArrayList<>();
                    supportedLanguages.add("te-IN");
                    supportedLanguages.add("hi-IN");
                    supportedLanguages.add("en-IN");

                    // Use FREE_FORM with no single forced EXTRA_LANGUAGE.
                    recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                    recognizerIntent.putExtra(RecognizerIntent.EXTRA_ENABLE_LANGUAGE_DETECTION, true);
                    recognizerIntent.putExtra(RecognizerIntent.EXTRA_ENABLE_LANGUAGE_SWITCH, RecognizerIntent.LANGUAGE_SWITCH_BALANCED);
                    recognizerIntent.putStringArrayListExtra(RecognizerIntent.EXTRA_LANGUAGE_DETECTION_ALLOWED_LANGUAGES, supportedLanguages);
                    recognizerIntent.putStringArrayListExtra(RecognizerIntent.EXTRA_LANGUAGE_SWITCH_ALLOWED_LANGUAGES, supportedLanguages);
                    recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_SWITCH_MAX_SWITCHES, 5);
                    recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_SWITCH_INITIAL_ACTIVE_DURATION_TIME_MILLIS, 30000);
                    recognizerIntent.putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_LATENCY);
                    // Return up to 3 alternative transcripts
                    recognizerIntent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
                    // Enable partial results so we get live transcript updates
                    recognizerIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                    // Do not force offline mode; many devices only have English offline packs.
                    recognizerIntent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false);
                    // Caller package for recognizer
                    recognizerIntent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());

                    speechRecognizer.startListening(recognizerIntent);
                } catch (Exception e) {
                    if (activeCall != null) {
                        activeCall.reject("ERROR_INIT", "Failed to initialize speech recognizer: " + e.getMessage());
                        activeCall = null;
                    }
                }
            }
        });
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        getBridge().getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (speechRecognizer != null) {
                    speechRecognizer.stopListening();
                }
                call.resolve();
            }
        });
    }

    @PluginMethod
    public void cancelListening(PluginCall call) {
        getBridge().getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (speechRecognizer != null) {
                    speechRecognizer.cancel();
                }
                if (activeCall != null) {
                    activeCall.reject("CANCELLED", "Listening was cancelled.");
                    activeCall = null;
                }
                call.resolve();
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        if (speechRecognizer != null) {
            speechRecognizer.cancel();
            speechRecognizer.destroy();
            speechRecognizer = null;
        }
    }
}
