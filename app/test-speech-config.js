import assert from 'assert';
import fs from 'fs';

const speechPlugin = fs.readFileSync(
  'android/app/src/main/java/com/gorantlasadwik/synctunes/SpeechPlugin.java',
  'utf8'
);
const appTsx = fs.readFileSync('src/App.tsx', 'utf8');

assert.match(speechPlugin, /EXTRA_ENABLE_LANGUAGE_DETECTION/);
assert.match(speechPlugin, /EXTRA_ENABLE_LANGUAGE_SWITCH/);
assert.match(speechPlugin, /EXTRA_LANGUAGE_DETECTION_ALLOWED_LANGUAGES/);
assert.match(speechPlugin, /EXTRA_LANGUAGE_SWITCH_ALLOWED_LANGUAGES/);
assert.match(speechPlugin, /SpeechRecognizer\.DETECTED_LANGUAGE/);
assert.doesNotMatch(speechPlugin, /putExtra\s*\(\s*RecognizerIntent\.EXTRA_LANGUAGE\s*,/);
assert.doesNotMatch(speechPlugin, /EXTRA_PREFER_OFFLINE\s*,\s*true/);

assert.doesNotMatch(appTsx, /\.lang\s*=\s*['"](te-IN|hi-IN|en-IN)['"]/);

const nativeStarts = appTsx.match(/SpeechPlugin\.startListening/g) || [];
assert.ok(nativeStarts.length >= 3, 'Billing, product creation, and Khata voice should use native speech in Capacitor');

console.log('Speech configuration checks passed.');
