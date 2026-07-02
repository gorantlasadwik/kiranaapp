// list_groq_models.js
import fs from 'fs';
import path from 'path';
import Groq from 'groq-sdk';

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

async function list() {
  try {
    const list = await groq.models.list();
    console.log("Groq Models:");
    list.data.forEach(m => {
      console.log(`- ${m.id}`);
    });
  } catch (e) {
    console.log("Error:", e.message);
  }
}

list();
