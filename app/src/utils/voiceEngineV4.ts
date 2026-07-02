/**
 * Voice AI Engine V4
 * ==================
 * A low-latency multilingual voice billing engine for Sai Ram Kirana.
 *
 * Architecture:
 * Voice Input -> Speech Recognition -> Language Detection -> Transliteration -> Quantity Extraction -> Product Resolution -> Billing Action
 */

import { db } from '../db';
import type { Product } from '../db';
import Fuse from 'fuse.js';

// ─── TYPES ─────────────────────────────────────────────────────────────────

export interface VoiceParseResult {
  action: 'ADD_ITEM' | 'REMOVE_ITEM' | 'UPDATE_ITEM' | 'PRINT_BILL' | 'UNKNOWN';
  resolvedProduct?: Product;
  productName?: string;
  quantity: number;
  unit: string;
  price?: number;
  confidence: number;           // 0-100
  needsConfirmation: boolean;   // Deprecated in V4, but kept for type compatibility (always false)
  suggestions: Product[];       // Deprecated in V4 (always empty)
  aiUsed: boolean;
  resolvedByMemory: boolean;
  resolvedByCache: boolean;
  rawText: string;
  executionTimeMs: number;
  languageTags?: { word: string; lang: 'Telugu' | 'Hindi' | 'English' }[];
  variants?: Product[];
  variantAction?: 'SHOW_VARIANTS' | null;
  variantGroup?: string;
}

// ─── MULTILINGUAL CONSTANTS ──────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  // English
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  half: 0.5, quarter: 0.25,
  // Telugu
  'సున్న': 0, 'ఒకటి': 1, 'ఒక': 1, 'ఒక్కటి': 1,
  'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4, 'ఐదు': 5,
  'ఆరు': 6, 'ఏడు': 7, 'ఎనిమిది': 8, 'తొమ్మిది': 9,
  'పది': 10, 'పన్నెండు': 12, 'పదిహేను': 15, 'ఇరవై': 20,
  'అర': 0.5, 'సగం': 0.5, 'పావు': 0.25,
  'ముప్పావు': 0.75, 'ఒకటిన్నర': 1.5, 'రెండున్నర': 2.5,
  // Hindi
  'शून्य': 0, 'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4,
  'पाँच': 5, 'पांच': 5, 'छह': 6, 'सात': 7, 'आठ': 8,
  'नौ': 9, 'दस': 10, 'बारह': 12, 'पंद्रह': 15, 'बीस': 20,
  'आधा': 0.5, 'भाव': 0.5, 'आधा लीटर': 500, 'आधा किलो': 500,
  'पाव': 0.25, 'सवा': 1.25, 'डेढ़': 1.5,
  'ढाई': 2.5, 'पौना': 0.75,
  // Phonetic English in Telugu Script
  'వన్': 1, 'టూ': 2, 'త్రీ': 3, 'ఫోర్': 4, 'ఫైవ్': 5,
  'సిక్స్': 6, 'సెవెన్': 7, 'ఎయిట్': 8, 'నైన్': 9, 'టెన్': 10,
  'ట్వంటీ': 20, 'థర్టీ': 30, 'ఫోర్టీ': 40, 'ఫిఫ్టీ': 50,
  'హండ్రెడ్': 100, 'టూ హండ్రెడ్': 200, 'ఫైవ్ హండ్రెడ్': 500,
  // Phonetic English in Hindi Script
  'वन': 1, 'टू': 2, 'थ्री': 3, 'फोर': 4, 'फाइव': 5,
  'सिक्स': 6, 'सेवन': 7, 'एट': 8, 'नाइन': 9, 'टेन': 10,
  // Transliterated Telugu Numbers
  'okati': 1, 'oka': 1, 'rendu': 2, 'moodu': 3, 'mudu': 3,
  'nalugu': 4, 'naalugu': 4, 'aidu': 5, 'aaru': 6,
  'yedu': 7, 'aedu': 7, 'enimidi': 8, 'tommidi': 9, 'padi': 10,
  'iravai': 20, 'muppai': 30, 'yabhai': 50, 'yabai': 50,
  'vanda': 100, 'nuru': 100, 'okatinara': 1.5, 'rendunnara': 2.5,
  'okatiన్నర': 1.5, 'renduన్నర': 2.5,
  // Transliterated Hindi Numbers
  'ek': 1, 'do': 2, 'teen': 3, 'chaar': 4, 'char': 4,
  'paanch': 5, 'panch': 5, 'chhah': 6, 'che': 6, 'saat': 7,
  'aath': 8, 'bees': 20, 'tees': 30, 'chalis': 40, 'pachas': 50,
  'dhai sau': 250, 'dhai': 2.5, 'dedh': 1.5, 'ded': 1.5,
  'adha': 0.5, 'aadha': 0.5, 'pav': 0.25, 'paav': 0.25,
};

const REGIONAL_SIZE_MAP: Record<string, { qty: number; unit: string }> = {
  // English / Transliterated
  'half kg': { qty: 500, unit: 'Gram' }, 'half kilo': { qty: 500, unit: 'Gram' },
  'quarter kg': { qty: 250, unit: 'Gram' }, 'quarter kilo': { qty: 250, unit: 'Gram' },
  'three quarter kg': { qty: 750, unit: 'Gram' }, 'three quarter kilo': { qty: 750, unit: 'Gram' },
  'half litre': { qty: 500, unit: 'ML' }, 'half liter': { qty: 500, unit: 'ML' }, 'half l': { qty: 500, unit: 'ML' },
  'quarter litre': { qty: 250, unit: 'ML' }, 'quarter liter': { qty: 250, unit: 'ML' },
  'three quarter litre': { qty: 750, unit: 'ML' }, 'three quarter liter': { qty: 750, unit: 'ML' },
  'dedh kilo': { qty: 1.5, unit: 'KG' }, 'ded kilo': { qty: 1.5, unit: 'KG' },
  'dhai kilo': { qty: 2.5, unit: 'KG' }, 'dai kilo': { qty: 2.5, unit: 'KG' },
  'sawa kilo': { qty: 1.25, unit: 'KG' }, 'sava kilo': { qty: 1.25, unit: 'KG' },
  'paune do kilo': { qty: 1.75, unit: 'KG' }, 'pone do kilo': { qty: 1.75, unit: 'KG' },
  'paune do kg': { qty: 1.75, unit: 'KG' }, 'pone do kg': { qty: 1.75, unit: 'KG' },
  'tola': { qty: 10, unit: 'Gram' }, 'stullam': { qty: 10, unit: 'Gram' }, 'thulam': { qty: 10, unit: 'Gram' },
  'cheytak': { qty: 50, unit: 'Gram' }, 'chhatak': { qty: 50, unit: 'Gram' }, 'chatak': { qty: 50, unit: 'Gram' },
  'cheetak': { qty: 50, unit: 'Gram' }, 'cheetaak': { qty: 50, unit: 'Gram' },
  'adda pav': { qty: 125, unit: 'Gram' }, 'adha pav': { qty: 125, unit: 'Gram' },
  'adda paav': { qty: 125, unit: 'Gram' }, 'adha paav': { qty: 125, unit: 'Gram' },
  'addapavu': { qty: 125, unit: 'Gram' }, 'adhapavu': { qty: 125, unit: 'Gram' },
  'teen pav': { qty: 750, unit: 'Gram' }, 'teen paav': { qty: 750, unit: 'Gram' },
  'thin pav': { qty: 750, unit: 'Gram' }, 'thin paav': { qty: 750, unit: 'Gram' },
  'teenpav': { qty: 750, unit: 'Gram' }, 'thinpav': { qty: 750, unit: 'Gram' },

  // Telugu
  'అర కేజీ': { qty: 500, unit: 'Gram' }, 'అర కిలో': { qty: 500, unit: 'Gram' },
  'సగం కేజీ': { qty: 500, unit: 'Gram' }, 'ఆధా కిలో': { qty: 500, unit: 'Gram' },
  'పావు కేజీ': { qty: 250, unit: 'Gram' }, 'పావు కిలో': { qty: 250, unit: 'Gram' },
  'ముప్పావు కేజీ': { qty: 750, unit: 'Gram' }, 'ముప్పావు కిలో': { qty: 750, unit: 'Gram' },
  'అద్దపావు': { qty: 125, unit: 'Gram' }, 'ఆధా పావు': { qty: 125, unit: 'Gram' },
  'అరపావు': { qty: 125, unit: 'Gram' }, 'ఆధాపవు': { qty: 125, unit: 'Gram' },
  'తీన్ పావు': { qty: 750, unit: 'Gram' }, 'తీన్పావు': { qty: 750, unit: 'Gram' },
  'చేతక్': { qty: 50, unit: 'Gram' }, 'ఛటాక్': { qty: 50, unit: 'Gram' }, 'చటాక్': { qty: 50, unit: 'Gram' },
  'అర లీటర్': { qty: 500, unit: 'ML' }, 'అర లీటరు': { qty: 500, unit: 'ML' },
  'పావు లీటర్': { qty: 250, unit: 'ML' }, 'ముప్పావు లీటర్': { qty: 750, unit: 'ML' },
  'డేడ్ కిలో': { qty: 1.5, unit: 'KG' }, 'డేడ్ కేజీ': { qty: 1.5, unit: 'KG' },
  'రెండున్నర కిలో': { qty: 2.5, unit: 'KG' }, 'రెండున్నర కేజీ': { qty: 2.5, unit: 'KG' },
  'సవా కిలో': { qty: 1.25, unit: 'KG' }, 'సవా కేజీ': { qty: 1.25, unit: 'KG' },
  'తులం': { qty: 10, unit: 'Gram' },

  // Hindi
  'आधा किलो': { qty: 500, unit: 'Gram' }, 'आधा केजी': { qty: 500, unit: 'Gram' },
  'पाव किलो': { qty: 250, unit: 'Gram' }, 'पाव केजी': { qty: 250, unit: 'Gram' },
  'पौना किलो': { qty: 750, unit: 'Gram' }, 'पौने तीन पाव': { qty: 750, unit: 'Gram' }, 'तीन पाव': { qty: 750, unit: 'Gram' },
  'आधा पाव': { qty: 125, unit: 'Gram' }, 'अधा पाव': { qty: 125, unit: 'Gram' },
  'छटाक': { qty: 50, unit: 'Gram' },
  'आधा लीटर': { qty: 500, unit: 'ML' }, 'पाव लीटर': { qty: 250, unit: 'ML' }, 'पौना लीटर': { qty: 750, unit: 'ML' },
  'डेढ़ किलो': { qty: 1.5, unit: 'KG' }, 'डेढ़ केजी': { qty: 1.5, unit: 'KG' },
  'ढाई किलो': { qty: 2.5, unit: 'KG' }, 'ढाई केजी': { qty: 2.5, unit: 'KG' },
  'सवा किलो': { qty: 1.25, unit: 'KG' }, 'सवा केजी': { qty: 1.25, unit: 'KG' },
  'पौने दो किलो': { qty: 1.75, unit: 'KG' }, 'पौने दो केजी': { qty: 1.75, unit: 'KG' },
  'तुला': { qty: 10, unit: 'Gram' },
};

const UNIT_MAP: Record<string, string> = {
  // Weight
  g: 'Gram', gram: 'Gram', grams: 'Gram', grm: 'Gram', gm: 'Gram', gms: 'Gram',
  gramulu: 'Gram', 'గ్రాములు': 'Gram', 'గ్రాం': 'Gram', 'ग्राम': 'Gram',
  kg: 'KG', kgs: 'KG', kilo: 'KG', kilos: 'KG', kilogram: 'KG', kilograms: 'KG',
  'కిలో': 'KG', 'కేజీ': 'KG', 'కేజీలు': 'KG', 'किलो': 'KG', 'किलोग्राम': 'KG',
  // Volume
  ml: 'ML', milliliter: 'ML', milliliters: 'ML', 'మిల్లీలీటర్': 'ML', 'मिलीलीटर': 'ML',
  l: 'Litre', litre: 'Litre', litres: 'Litre', liter: 'Litre', liters: 'Litre',
  'లీటర్': 'Litre', 'లీటరు': 'Litre', 'लीटर': 'Litre',
  // Count
  piece: 'Piece', pieces: 'Piece', pcs: 'Piece', pc: 'Piece', 'నగ': 'Piece', 'पीस': 'Piece',
  packet: 'Piece', packets: 'Piece', pack: 'Piece', packs: 'Piece',
  'ప్యాకెట్': 'Piece', 'पैकेट': 'Piece',
  bag: 'Bag', bags: 'Bag', 'బస్తా': 'Bag', 'बोरी': 'Bag',
  sheet: 'Sheet', sheets: 'Sheet', 'షీట్': 'Sheet',
  tray: 'Tray', trays: 'Tray', 'ట్రే': 'Piece',
  carton: 'Carton', cartons: 'Carton',
  pudha: 'Pudha', pudhas: 'Pudha', puda: 'Pudha',
  // Box
  box: 'Piece', boxes: 'Piece', 'బాక్స్': 'Piece', 'డిబ్బా': 'Piece', 'डिब्बा': 'Piece',
};

const ACTION_REMOVE = [
  'remove', 'delete', 'cancel',
  'తీసేయ్', 'తొలగించు', 'తీసివేయి', 'తీసేయి', 'తీసు',
  'हटाओ', 'काट', 'निकालो', 'हटा',
];

const ACTION_UPDATE = [
  'change', 'update', 'edit', 'set', 'modify', 'price of',
  'మార్చు', 'సవరించు', 'చేంజ్', 'సెట్', 'అప్డేట్', 'ఎడిట్', 'మార్చండి', 'మార్చి',
  'बदलो', 'बदल', 'चेंज', 'अपडेट', 'सेट', 'बदलें',
];

const ACTION_PRINT = [
  'print bill', 'print', 'checkout', 'complete',
  'బిల్ ప్రింట్', 'ప్రింట్ బిల్', 'ప్రింట్', 'ముగించు', 'పూర్తి',
  'बिल प्रिंट', 'प्रिंट', 'प्रिंट बिल',
];

// ─── LANGUAGE IDENTIFICATION (Layer 3) ───────────────────────────────────────

export function identifyLanguageOfWord(word: string): 'Telugu' | 'Hindi' | 'English' {
  const cleanWord = word.toLowerCase().trim();
  if (!cleanWord) return 'English';

  // Check scripts directly using Unicode ranges
  if (/[\u0C00-\u0C7F]/.test(word)) return 'Telugu';
  if (/[\u0900-\u097F]/.test(word)) return 'Hindi';

  // Known transliterated numbers and regional vocabulary
  const teluguWords = new Set([
    'okati', 'oka', 'rendu', 'moodu', 'mudu', 'nalugu', 'naalugu', 'aidu', 'aaru', 'yedu', 'aedu', 'enimidi', 'tommidi', 'padi',
    'iravai', 'muppai', 'yabhai', 'yabai', 'vanda', 'nuru', 'okatinara', 'rendunnara', 'ara', 'pavu', 'paavu', 'muppavu',
    'chakkera', 'nune', 'pappu', 'karam', 'uppu', 'bellam', 'pasupu', 'minapappu', 'senagapappu', 'pesarapappu', 'allam',
    'elakulu', 'miriyalu', 'dhaniyalu', 'jeelakarra', 'godhuma', 'varipindi', 'atukulu'
  ]);

  const hindiWords = new Set([
    'ek', 'do', 'teen', 'chaar', 'char', 'paanch', 'panch', 'chhah', 'che', 'saat', 'aath', 'nau', 'das',
    'bees', 'tees', 'chalis', 'pachas', 'sau', 'dhai', 'dedh', 'ded', 'aadha', 'adha', 'pav', 'paav', 'pouna',
    'cheeni', 'tel', 'namak', 'haldi', 'dhaniya', 'jeera', 'aata', 'chawal', 'dahi', 'doodh', 'ghee'
  ]);

  if (teluguWords.has(cleanWord)) return 'Telugu';
  if (hindiWords.has(cleanWord)) return 'Hindi';

  return 'English';
}

export function tagTranscriptLanguages(text: string): { word: string; lang: 'Telugu' | 'Hindi' | 'English' }[] {
  const words = text.split(/\s+/).filter(w => w.trim().length > 0);
  return words.map(word => ({
    word,
    lang: identifyLanguageOfWord(word)
  }));
}

// ─── TRANSLITERATION ENGINE (Layer 4) ────────────────────────────────────────

export function transliterateTeluguOrHindiWord(word: string): string[] {
  const cleanWord = word.trim();
  if (!cleanWord) return [];

  // If already pure ASCII (English), return lowercased
  if (/^[a-zA-Z0-9\s.,?!#@$%^&*()_+=\-[\]{}|;:'"<>\/]+$/.test(cleanWord)) {
    return [cleanWord.toLowerCase()];
  }

  const results: string[] = [cleanWord];

  let translit1 = '';
  let translit2 = '';

  for (let i = 0; i < cleanWord.length; i++) {
    const char = cleanWord[i];
    const code = char.charCodeAt(0);

    // Devanagari (Hindi) Block: 0900 - 097F
    if (code >= 0x0900 && code <= 0x097F) {
      const devanagariMap: Record<string, [string, string]> = {
        'अ': ['a', 'a'], 'आ': ['aa', 'a'], 'इ': ['i', 'i'], 'ई': ['ee', 'i'],
        'उ': ['u', 'u'], 'ऊ': ['oo', 'u'], 'ऋ': ['ri', 'ri'], 'ए': ['e', 'e'],
        'ऐ': ['ai', 'ai'], 'ओ': ['o', 'o'], 'औ': ['au', 'au'], 'अं': ['am', 'an'],
        'ा': ['aa', 'a'], 'ि': ['i', 'i'], 'ी': ['ee', 'i'], 'ु': ['u', 'u'],
        'ू': ['oo', 'u'], 'ृ': ['ri', 'ri'], 'े': ['e', 'e'], 'ै': ['ai', 'ai'],
        'ो': ['o', 'o'], 'ौ': ['au', 'au'], 'ं': ['n', 'm'], 'ः': ['h', 'h'],
        'क': ['k', 'k'], 'ख': ['kh', 'kh'], 'ग': ['g', 'g'], 'घ': ['gh', 'gh'],
        'च': ['ch', 'ch'], 'छ': ['chh', 'ch'], 'ज': ['j', 'j'], 'झ': ['jh', 'j'],
        'ट': ['t', 't'], 'ठ': ['th', 't'], 'ड': ['d', 'd'], 'ढ': ['dh', 'd'], 'ण': ['n', 'n'],
        'त': ['t', 't'], 'थ': ['th', 't'], 'द': ['d', 'd'], 'ध': ['dh', 'd'], 'न': ['n', 'n'],
        'प': ['p', 'p'], 'फ': ['ph', 'f'], 'ब': ['b', 'b'], 'भ': ['bh', 'b'], 'म': ['m', 'm'],
        'य': ['y', 'y'], 'र': ['r', 'r'], 'ल': ['l', 'l'], 'व': ['v', 'w'],
        'श': ['sh', 'sh'], 'ष': ['sh', 'sh'], 'स': ['s', 's'], 'ह': ['h', 'h'],
        'ळ': ['l', 'l'], 'क्ष': ['ksh', 'ksh'], 'ज्ञ': ['gy', 'gy']
      };

      const mapped = devanagariMap[char];
      if (mapped) {
        translit1 += mapped[0];
        translit2 += mapped[1];
      } else {
        if (char === '्') {
          if (translit1.endsWith('a')) translit1 = translit1.slice(0, -1);
          if (translit2.endsWith('a')) translit2 = translit2.slice(0, -1);
        }
      }

      const isConsonant = (code >= 0x0915 && code <= 0x0939) || char === 'ळ';
      if (isConsonant && i + 1 < cleanWord.length) {
        const nextChar = cleanWord[i + 1];
        const nextCode = nextChar.charCodeAt(0);
        const isNextVowelSign = (nextCode >= 0x093E && nextCode <= 0x094C) || nextChar === '्' || nextChar === 'ं';
        if (!isNextVowelSign) {
          translit1 += 'a';
          translit2 += 'a';
        }
      }
    }

    // Telugu Block: 0C00 - 0C7F
    else if (code >= 0x0C00 && code <= 0x0C7F) {
      const teluguMap: Record<string, [string, string]> = {
        'అ': ['a', 'a'], 'ఆ': ['aa', 'a'], 'ఇ': ['i', 'i'], 'ఈ': ['ee', 'i'],
        'ఉ': ['u', 'u'], 'ఊ': ['oo', 'u'], 'ఋ': ['ru', 'ru'], 'ఎ': ['e', 'e'],
        'ఏ': ['ee', 'ae'], 'ఐ': ['ai', 'ai'], 'ఒ': ['o', 'o'], 'ఓ': ['oo', 'o'], 'ఔ': ['au', 'au'],
        'ా': ['aa', 'a'], 'ి': ['i', 'i'], 'ీ': ['ee', 'i'], 'ు': ['u', 'u'],
        'ూ': ['oo', 'u'], 'ృ': ['ru', 'ru'], 'ె': ['e', 'e'], 'ే': ['ee', 'e'],
        'ై': ['ai', 'ai'], 'ొ': ['o', 'o'], 'ో': ['oo', 'o'], 'ౌ': ['au', 'au'],
        'ం': ['n', 'm'], 'ః': ['h', 'h'],
        'క': ['k', 'k'], 'ఖ': ['kh', 'kh'], 'గ': ['g', 'g'], 'ఘ': ['gh', 'gh'],
        'చ': ['ch', 'ch'], 'ఛ': ['chh', 'ch'], 'జ': ['j', 'j'], 'ఝ': ['jh', 'j'],
        'ట': ['t', 't'], 'ఠ': ['th', 't'], 'డ': ['d', 'd'], 'ఢ': ['dh', 'd'], 'ణ': ['n', 'n'],
        'త': ['t', 't'], 'థ': ['th', 't'], 'ద': ['d', 'd'], 'ధ': ['dh', 'd'], 'న': ['n', 'n'],
        'ప': ['p', 'p'], 'ఫ': ['ph', 'f'], 'బ': ['b', 'b'], 'భ': ['bh', 'b'], 'మ': ['m', 'm'],
        'య': ['y', 'y'], 'ర': ['r', 'r'], 'ల': ['l', 'l'], 'వ': ['v', 'w'],
        'శ': ['sh', 'sh'], 'ष': ['sh', 'sh'], 'స': ['s', 's'], 'హ': ['h', 'h'],
        'ళ': ['l', 'l'], 'క్ష': ['ksh', 'ksh']
      };

      const mapped = teluguMap[char];
      if (mapped) {
        translit1 += mapped[0];
        translit2 += mapped[1];
      } else {
        if (char === '్') {
          if (translit1.endsWith('a')) translit1 = translit1.slice(0, -1);
          if (translit2.endsWith('a')) translit2 = translit2.slice(0, -1);
        }
      }

      const isConsonant = (code >= 0x0C15 && code <= 0x0C39) || char === 'ళ';
      if (isConsonant && i + 1 < cleanWord.length) {
        const nextChar = cleanWord[i + 1];
        const nextCode = nextChar.charCodeAt(0);
        const isNextVowelSign = (nextCode >= 0x0C3E && nextCode <= 0x0C4C) || nextChar === '్' || nextChar === 'ం';
        if (!isNextVowelSign) {
          translit1 += 'a';
          translit2 += 'a';
        }
      }
    } else {
      translit1 += char;
      translit2 += char;
    }
  }

  if (translit1) results.push(translit1.toLowerCase());
  if (translit2 && translit2 !== translit1) results.push(translit2.toLowerCase());

  const spellingVariants = (str: string): string[] => {
    let variants = [str];
    if (str.includes('ee')) variants.push(str.replace(/ee/g, 'i'));
    if (str.includes('oo')) variants.push(str.replace(/oo/g, 'u'));
    if (str.includes('aa')) variants.push(str.replace(/aa/g, 'a'));
    if (str.includes('i') && !str.includes('ee')) variants.push(str.replace(/i/g, 'ee'));
    if (str.includes('u') && !str.includes('oo')) variants.push(str.replace(/u/g, 'oo'));
    if (str.includes('a') && !str.includes('aa')) variants.push(str.replace(/a/g, 'aa'));
    
    if (str.includes('f')) variants.push(str.replace(/f/g, 'ph'));
    if (str.includes('ph')) variants.push(str.replace(/ph/g, 'f'));
    if (str.includes('w')) variants.push(str.replace(/w/g, 'v'));
    if (str.includes('v')) variants.push(str.replace(/v/g, 'w'));

    return Array.from(new Set(variants));
  };

  const finalResults: string[] = [];
  results.forEach(res => {
    spellingVariants(res).forEach(variant => {
      finalResults.push(variant);
      // Append terminal soft schwa 'a' if word ends in a consonant
      if (/([^aeiou])$/i.test(variant)) {
        finalResults.push(variant + 'a');
      }
    });
  });

  return Array.from(new Set(finalResults));
}

export function transliterateQueryString(query: string): string[] {
  const words = query.split(/\s+/).filter(w => w.trim().length > 0);
  if (words.length === 0) return [];

  const wordsTranslit = words.map(w => transliterateTeluguOrHindiWord(w));

  let combos: string[] = [''];
  for (const translits of wordsTranslit) {
    const nextCombos: string[] = [];
    for (const prefix of combos) {
      for (const t of translits) {
        nextCombos.push((prefix + ' ' + t).trim());
      }
    }
    combos = nextCombos;
  }

  return Array.from(new Set(combos));
}

// ─── SCORING & RESOLUTION (Layer 5 & 7) ──────────────────────────────────────

interface ScoreResult {
  product: Product;
  score: number;
  matchType: 'exact' | 'alias' | 'memory' | 'cache' | 'fuzzy';
}

function scoreProductsV4(
  queryVariants: string[],
  products: Product[],
  sizeSearchStrings: string[],
  memoryHits: number[],
  correctionHits: number[]
): ScoreResult[] {
  if (queryVariants.length === 0) return [];

  const fuse = new Fuse(products, {
    keys: [
      { name: 'display_name', weight: 0.7 },
      { name: 'aliases', weight: 0.3 }
    ],
    threshold: 0.45,
    includeScore: true
  });

  const results: ScoreResult[] = [];

  for (const p of products) {
    const nameLower = p.display_name.toLowerCase().trim();
    const aliases = (p.aliases || []).map(a => a.toLowerCase().trim());

    let maxScore = 0;
    let bestMatchType: ScoreResult['matchType'] = 'fuzzy';

    for (const q of queryVariants) {
      let score = 0;
      let matchType: ScoreResult['matchType'] = 'fuzzy';

      const exactName = (nameLower === q);
      const exactAlias = aliases.some(a => a === q);

      if (exactName) {
        score = 98;
        matchType = 'exact';
      } else if (exactAlias) {
        score = 95;
        matchType = 'alias';
      } else if (memoryHits.includes(p.id)) {
        score = 92;
        matchType = 'memory';
      } else if (correctionHits.includes(p.id)) {
        score = 91;
        matchType = 'cache';
      } else {
        const fuseRes = fuse.search(q);
        const match = fuseRes.find(r => r.item.id === p.id);
        if (match && match.score !== undefined) {
          score = Math.max(0, Math.min(89, Math.round((1 - (match.score / 0.45)) * 89)));
          matchType = 'fuzzy';
        }
      }

      if (score > 0 && sizeSearchStrings.length > 0) {
        const nameNorm = nameLower.replace(/\s+/g, '');
        const aliasNorms = aliases.map(a => a.replace(/\s+/g, ''));
        const sizeMatch = sizeSearchStrings.some(sStr =>
          nameNorm.includes(sStr) || aliasNorms.some(aNorm => aNorm.includes(sStr))
        );
        if (sizeMatch) {
          score = Math.min(99, score + 10);
        }
      }

      if (score > maxScore) {
        maxScore = score;
        bestMatchType = matchType;
      }
    }

    if (maxScore > 0) {
      results.push({
        product: p,
        score: maxScore,
        matchType: bestMatchType
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

// ─── HELPERS & SIZE STRINGS ──────────────────────────────────────────────────

function getSizeSearchStrings(qty: number, unit: string): string[] {
  const normUnit = unit.toLowerCase().trim();
  const strings: string[] = [
    `${qty}${normUnit}`,
    `${qty} ${normUnit}`
  ];

  if (normUnit === 'gram') {
    strings.push(`${qty}g`, `${qty} g`, `${qty}gm`, `${qty} gm`, 'gram', 'grams');
    if (qty === 500) strings.push('half kg', 'half kilo', 'ara kg', 'ara kilo', 'అర కేజీ', 'అర కిలో', 'आधा किलो');
    if (qty === 250) strings.push('quarter kg', 'quarter kilo', 'paavu kg', 'pavu kilo', 'పావు కేజీ', 'పావు కిలో', 'पाव किलो');
    if (qty === 750) strings.push('three quarter', 'muppavu', 'पौना किलो');
  } else if (normUnit === 'kg') {
    strings.push(`${qty}kg`, `${qty} kg`, `${qty}kilo`, `${qty} kilo`, 'kilogram', 'kilograms');
    if (qty === 0.5) strings.push('500g', '500 g', 'half kg', 'half kilo', 'ara kg', 'ara kilo', 'అర కేజీ', 'అర కిలో', 'आधा किलो');
    if (qty === 0.25) strings.push('250g', '250 g', 'quarter kg', 'quarter kilo', 'paavu kg', 'pavu kilo', 'పావు కేజీ', 'పావు కిలో', 'पाव किलो');
    if (qty === 1.5) strings.push('dedh', 'ded', 'డేడ్', 'डेढ़');
    if (qty === 2.5) strings.push('dhai', 'dai', 'రెండున్నర', 'ढाई');
  } else if (normUnit === 'ml') {
    strings.push(`${qty}ml`, `${qty} ml`, 'ml');
    if (qty === 500) strings.push('half litre', 'half liter', 'half l', 'ara litre', 'అర లీటర్', 'आधा लीटर');
    if (qty === 250) strings.push('quarter litre', 'quarter liter', 'pavu litre', 'పావు లీటర్', 'पाव लीटर');
  } else if (normUnit === 'litre') {
    strings.push(`${qty}l`, `${qty} l`, `${qty}litre`, `${qty} liter`, 'litre', 'liter', 'litres', 'liters');
    if (qty === 0.5) strings.push('500ml', '500 ml', 'half litre', 'half liter', 'half l', 'ara litre', 'అర లీటర్', 'आधा लीटर');
    if (qty === 0.25) strings.push('250ml', '250 ml', 'quarter litre', 'quarter liter', 'pavu litre', 'పావు లీటర్', 'पाव लीटर');
  }

  return Array.from(new Set(strings.map(s => s.toLowerCase().replace(/\s+/g, ''))));
}

function getProductType(product: Product): 'WEIGHT' | 'VOLUME' | 'PACKAGED' {
  if (product.product_type === 'WEIGHT' || product.product_type === 'VOLUME' || product.product_type === 'PACKAGED') {
    return product.product_type;
  }
  if (product.category_id === 1) return 'WEIGHT';
  if (product.category_id === 2) return 'VOLUME';
  
  const displayLower = product.display_name.toLowerCase();
  const WEIGHT_PRODUCTS = ['sugar', 'rice', 'wheat', 'atta', 'maida', 'rava', 'dal', 'salt', 'besan', 'kandi pappu'];
  const VOLUME_PRODUCTS = ['oil', 'milk', 'ghee', 'vinegar'];
  
  if (WEIGHT_PRODUCTS.some(w => displayLower.includes(w))) return 'WEIGHT';
  if (VOLUME_PRODUCTS.some(v => displayLower.includes(v))) return 'VOLUME';
  
  return 'PACKAGED';
}

function parseDefaultQuantity(defaultQtyStr?: string): { quantity: number; unit: string } {
  if (!defaultQtyStr) return { quantity: 1, unit: '' };
  const clean = defaultQtyStr.toLowerCase().trim().replace(/\s+/g, '');
  const match = clean.match(/^(\d+(?:\.\d+)?)(g|gram|grams|kg|kilo|kilograms|ml|l|litre|liter|litres|liters|piece|pieces|packet|pack|pouch|bottle)$/);
  if (match) {
    const qty = parseFloat(match[1]);
    let unit = match[2];
    if (unit === 'g' || unit === 'gram' || unit === 'grams') unit = 'Gram';
    else if (unit === 'kg' || unit === 'kilo' || unit === 'kilograms') unit = 'KG';
    else if (unit === 'l' || unit === 'litre' || unit === 'liter' || unit === 'litres' || unit === 'liters') unit = 'Litre';
    else if (unit === 'ml') unit = 'ML';
    else if (unit === 'piece' || unit === 'pieces') unit = 'Piece';
    else if (unit === 'packet') unit = 'Packet';
    else if (unit === 'pack') unit = 'Pack';
    else if (unit === 'pouch') unit = 'Pouch';
    else if (unit === 'bottle') unit = 'Bottle';
    return { quantity: qty, unit };
  }
  return { quantity: 1, unit: '' };
}

// ─── QUANTITY / UNIT / ACTION PARSING (Layer 6) ───────────────────────────────

interface ParsedTokens {
  action: 'ADD_ITEM' | 'REMOVE_ITEM' | 'UPDATE_ITEM' | 'PRINT_BILL';
  quantity: number;
  unit: string;
  price?: number;
  productQuery: string;
  sizeQty?: number;
  sizeUnit?: string;
  sizeInQuery?: string;
}

function parseTokensV4(rawText: string): ParsedTokens {
  let text = rawText.toLowerCase().trim();

  for (const pat of ACTION_PRINT) {
    if (text.includes(pat.toLowerCase())) {
      return { action: 'PRINT_BILL', quantity: 1, unit: 'Piece', productQuery: '' };
    }
  }

  let action: ParsedTokens['action'] = 'ADD_ITEM';
  for (const pat of ACTION_REMOVE) {
    if (text.includes(pat.toLowerCase())) {
      text = text.replace(pat.toLowerCase(), ' ').trim();
      action = 'REMOVE_ITEM';
      break;
    }
  }
  if (action === 'ADD_ITEM') {
    for (const pat of ACTION_UPDATE) {
      if (text.includes(pat.toLowerCase())) {
        text = text.replace(pat.toLowerCase(), ' ').trim();
        action = 'UPDATE_ITEM';
        break;
      }
    }
  }

  let sizeQty: number | undefined;
  let sizeUnit: string | undefined;
  let sizeInQuery: string | undefined;

  const regionKeys = Object.keys(REGIONAL_SIZE_MAP).sort((a, b) => b.length - a.length);
  for (const key of regionKeys) {
    if (text.includes(key.toLowerCase())) {
      const mapped = REGIONAL_SIZE_MAP[key];
      sizeQty = mapped.qty;
      sizeUnit = mapped.unit;
      sizeInQuery = key;
      text = text.replace(key.toLowerCase(), ' ').trim();
      break;
    }
  }

  if (!sizeQty) {
    const sizePattern = /(\d+(?:\.\d+)?)\s*(g|kg|ml|l|litre|liter|grams|kilograms|litres|liters|మిల్లీలీటర్|లీటర్|కేజీ|కిలో|గ్రామ్|గ్రాములు|ग्राम|किलोग्राम|लीटर|मिलीलीटर)\b/gi;
    const sizeMatch = sizePattern.exec(text);
    if (sizeMatch) {
      const num = parseFloat(sizeMatch[1]);
      const u = sizeMatch[2].toLowerCase();
      const mapped = UNIT_MAP[u];
      if (mapped) {
        sizeQty = num;
        sizeUnit = mapped;
        sizeInQuery = sizeMatch[0];
        text = text.replace(sizeMatch[0], ' ').trim();
      }
    }
  }

  const numKeys = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length);
  for (const word of numKeys) {
    const isLatin = /^[a-zA-Z\s]+$/.test(word);
    const regex = isLatin
      ? new RegExp(`\\b${word}\\b`, 'gi')
      : new RegExp(word, 'g');
    if (regex.test(text)) {
      text = text.replace(regex, ` ${NUMBER_WORDS[word]} `);
    }
  }
  text = text.replace(/\s+/g, ' ').trim();

  let resolvedUnit: string | undefined;
  const unitKeys = Object.keys(UNIT_MAP).sort((a, b) => b.length - a.length);
  for (const u of unitKeys) {
    const isLatin = /^[a-zA-Z]+$/.test(u);
    const regex = isLatin ? new RegExp(`\\b${u}\\b`, 'gi') : new RegExp(u, 'g');
    if (regex.test(text)) {
      resolvedUnit = UNIT_MAP[u];
      text = text.replace(regex, ' ').trim();
      break;
    }
  }

  let quantity: number | undefined;
  let price: number | undefined;
  const numMatches = text.match(/(\d+(?:\.\d+)?)/g) || [];

  const priceKeywords = ['price', 'rate', 'rs', 'rupees', 'rupee', 'ధర', 'రేటు', 'रेट', 'भाव'];
  const hasPriceKw = priceKeywords.some(kw => rawText.toLowerCase().includes(kw));

  if (numMatches.length >= 2) {
    quantity = parseFloat(numMatches[0]!);
    price = parseFloat(numMatches[1]!);
    if (action === 'ADD_ITEM') action = 'UPDATE_ITEM';
    text = text.replace(numMatches[0]!, ' ').replace(numMatches[1]!, ' ').trim();
  } else if (numMatches.length === 1) {
    const val = parseFloat(numMatches[0]!);
    if (hasPriceKw) {
      price = val;
      if (action === 'ADD_ITEM') action = 'UPDATE_ITEM';
    } else {
      quantity = val;
    }
    text = text.replace(numMatches[0]!, ' ').trim();
  }

  const fillers = [
    'of', 'to', 'for', 'from', 'the', 'add', 'yaad',
    'యొక్క', 'ను', 'nu', 'నుండి', 'ఆడ్', 'యాడ్',
    'का', 'को', 'की', 'जोड़', 'मिला',
  ];
  for (const f of fillers) {
    const isLatin = /^[a-zA-Z]+$/.test(f);
    const regex = isLatin ? new RegExp(`\\b${f}\\b`, 'gi') : new RegExp(f, 'g');
    text = text.replace(regex, ' ');
  }

  const productQuery = text.replace(/\s+/g, ' ').trim();

  return {
    action,
    quantity: quantity ?? 1,
    unit: resolvedUnit || 'Piece',
    price,
    productQuery,
    sizeQty,
    sizeUnit,
    sizeInQuery,
  };
}

// ─── PARTIAL RESULT PROCESSOR (Layer 1) ──────────────────────────────────────

export async function processPartialTranscript(_partialText: string): Promise<Product[]> {
  return [];
}

// ─── MAIN VOICE RESOLVE ──────────────────────────────────────────────────────

export async function resolveVoiceCommand(rawText: string): Promise<VoiceParseResult> {
  const startTime = Date.now();
  let aiUsed = false;
  let resolvedByMemory = false;
  let resolvedByCache = false;

  const languageTags = tagTranscriptLanguages(rawText);

  const cached = await db.findVoiceCacheEntry(rawText);
  if (cached) {
    const products = await db.getProducts();
    const resolvedProduct = products.find(p => p.id === cached.product_id);
    if (resolvedProduct) {
      resolvedByCache = true;
      const result: VoiceParseResult = {
        action: cached.action as any,
        resolvedProduct,
        productName: resolvedProduct.display_name,
        quantity: cached.quantity,
        unit: cached.unit,
        confidence: 97,
        needsConfirmation: false,
        suggestions: [],
        aiUsed: false,
        resolvedByMemory: false,
        resolvedByCache: true,
        rawText,
        executionTimeMs: Date.now() - startTime,
        languageTags
      };
      await _logVoiceAttempt(rawText, resolvedProduct.id, resolvedProduct.id, 97, false, result.executionTimeMs, true);
      return result;
    }
  }

  const tokens = parseTokensV4(rawText);

  if (tokens.action === 'PRINT_BILL') {
    return {
      action: 'PRINT_BILL', quantity: 1, unit: 'Piece',
      confidence: 100, needsConfirmation: false, suggestions: [],
      aiUsed: false, resolvedByMemory: false, resolvedByCache: false,
      rawText, executionTimeMs: Date.now() - startTime,
      languageTags
    };
  }

  const products = await db.getProducts();
  const productQuery = tokens.productQuery;

  if (!productQuery) {
    return {
      action: 'UNKNOWN', quantity: tokens.quantity, unit: tokens.unit, price: tokens.price,
      confidence: 0, needsConfirmation: false, suggestions: [],
      aiUsed: false, resolvedByMemory: false, resolvedByCache: false,
      rawText, executionTimeMs: Date.now() - startTime,
      languageTags
    };
  }

  const queryVariants = transliterateQueryString(productQuery);

  const voiceMemory = await db.getVoiceMemory();
  const memoryHits = voiceMemory
    .filter(v =>
      v.key.toLowerCase() === rawText.toLowerCase().trim() ||
      v.key.toLowerCase() === productQuery.toLowerCase() ||
      queryVariants.includes(v.key.toLowerCase())
    )
    .map(v => v.product_id);

  const corrections = await db.getVoiceCorrections();
  const correctionHits = corrections
    .filter(c =>
      c.phrase.toLowerCase() === rawText.toLowerCase().trim() ||
      c.phrase.toLowerCase() === productQuery.toLowerCase() ||
      queryVariants.includes(c.phrase.toLowerCase())
    )
    .map(c => c.correct_product_id);

  const sizeSearchStrings = (tokens.sizeQty && tokens.sizeUnit)
    ? getSizeSearchStrings(tokens.sizeQty, tokens.sizeUnit)
    : [];

  let scored = scoreProductsV4(queryVariants, products, sizeSearchStrings, memoryHits, correctionHits);

  const topScore = scored[0]?.score ?? 0;
  const topProduct = scored[0]?.product;

  if (topProduct && memoryHits.includes(topProduct.id)) {
    resolvedByMemory = true;
  }

  // Local Resolution (Confidence >= 80) -> Execute or route to variants modal
  if (topScore >= 80 && topProduct) {
    const pType = getProductType(topProduct);

    if (pType === 'WEIGHT' || pType === 'VOLUME') {
      let finalQty = tokens.quantity;
      let finalUnit = tokens.unit;

      if (tokens.unit && tokens.unit !== 'Piece') {
        finalQty = tokens.quantity;
        finalUnit = tokens.unit;
      } else if (tokens.sizeQty && tokens.sizeUnit) {
        finalQty = tokens.quantity * tokens.sizeQty;
        finalUnit = tokens.sizeUnit;
      } else {
        const def = parseDefaultQuantity(topProduct.default_quantity || (pType === 'WEIGHT' ? '1kg' : '1L'));
        finalQty = def.quantity;
        finalUnit = def.unit || (pType === 'WEIGHT' ? 'KG' : 'Litre');
      }

      const result: VoiceParseResult = {
        action: tokens.action,
        resolvedProduct: topProduct,
        productName: topProduct.display_name,
        quantity: finalQty,
        unit: finalUnit,
        price: tokens.price,
        confidence: topScore,
        needsConfirmation: false,
        suggestions: [],
        aiUsed: false,
        resolvedByMemory,
        resolvedByCache: false,
        rawText,
        executionTimeMs: Date.now() - startTime,
        languageTags
      };
      await _logVoiceAttempt(rawText, topProduct.id, topProduct.id, result.confidence, false, result.executionTimeMs, true);
      return result;
    } else {
      // Packaged Products
      const hasSize = !!(tokens.sizeQty || tokens.sizeUnit || tokens.sizeInQuery);
      const vGroup = topProduct.variant_group;
      const variants = vGroup
        ? products.filter(p => p.variant_group === vGroup && !p.is_deleted)
        : [];

      if (!hasSize && variants.length > 1) {
        // Size not mentioned, display variant selector
        const result: VoiceParseResult = {
          action: tokens.action,
          productName: topProduct.display_name,
          quantity: tokens.quantity,
          unit: 'Piece',
          price: tokens.price,
          confidence: topScore,
          needsConfirmation: false,
          suggestions: [],
          aiUsed: false,
          resolvedByMemory,
          resolvedByCache: false,
          rawText,
          executionTimeMs: Date.now() - startTime,
          languageTags,
          variants,
          variantAction: 'SHOW_VARIANTS',
          variantGroup: vGroup
        };
        await _logVoiceAttempt(rawText, null, null, result.confidence, false, result.executionTimeMs, false);
        return result;
      } else {
        // Size mentioned or single product -> add directly
        let finalQty = tokens.quantity;
        let finalUnit = tokens.unit || topProduct.units?.[0]?.unit_name || 'Piece';

        const result: VoiceParseResult = {
          action: tokens.action,
          resolvedProduct: topProduct,
          productName: topProduct.display_name,
          quantity: finalQty,
          unit: finalUnit,
          price: tokens.price,
          confidence: topScore,
          needsConfirmation: false,
          suggestions: [],
          aiUsed: false,
          resolvedByMemory,
          resolvedByCache: false,
          rawText,
          executionTimeMs: Date.now() - startTime,
          languageTags
        };
        await _logVoiceAttempt(rawText, topProduct.id, topProduct.id, result.confidence, false, result.executionTimeMs, true);
        return result;
      }
    }
  }

  // AI Fallback Resolution (Confidence < 80)
  aiUsed = true;
  const candidates = scored.slice(0, 8).map(s => s.product);
  const aiResult = await _callAI(rawText, tokens, candidates, products);

  if (aiResult) {
    const result: VoiceParseResult = {
      ...aiResult,
      rawText,
      executionTimeMs: Date.now() - startTime,
      aiUsed: true,
      resolvedByMemory: false,
      resolvedByCache: false,
      languageTags
    };
    const pid = aiResult.resolvedProduct?.id ?? null;
    await _logVoiceAttempt(rawText, pid, pid, aiResult.confidence, true, result.executionTimeMs, pid !== null);

    if (aiResult.resolvedProduct) {
      await db.saveVoiceCacheEntry({
        phrase: rawText.toLowerCase().trim(),
        product_id: aiResult.resolvedProduct.id,
        quantity: aiResult.quantity,
        unit: aiResult.unit,
        action: aiResult.action as 'ADD_ITEM' | 'REMOVE_ITEM' | 'UPDATE_ITEM',
      });
    }
    return result;
  }

  // Failed completely -> Return UNKNOWN with parsed productQuery for search box fallback
  return {
    action: 'UNKNOWN',
    productName: productQuery,
    quantity: tokens.quantity,
    unit: tokens.unit,
    price: tokens.price,
    confidence: 0,
    needsConfirmation: false,
    suggestions: [],
    aiUsed,
    resolvedByMemory,
    resolvedByCache,
    rawText,
    executionTimeMs: Date.now() - startTime,
    languageTags
  };
}

// ─── AI FALLBACK (Llama-3.3 / Gemini-1.5) ────────────────────────────────────

async function _callAI(
  rawText: string,
  tokens: ParsedTokens,
  candidates: Product[],
  allProducts: Product[]
): Promise<Omit<VoiceParseResult, 'rawText' | 'executionTimeMs' | 'aiUsed' | 'resolvedByMemory' | 'resolvedByCache'> | null> {
  const groqKey = db.getSetting('groq_api_key') || (import.meta as any).env?.VITE_GROQ_API_KEY || '';
  const geminiKey = db.getSetting('gemini_api_key') || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';

  if (!groqKey && !geminiKey) return null;

  const prompt = _buildAIPrompt(rawText, candidates);

  if (groqKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'You are a billing assistant. Respond only with valid JSON.' },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
        return _mapAIResponse(parsed, tokens, allProducts);
      }
    } catch (e) {
      console.warn('[VoiceV4] Groq failed:', e);
    }
  }

  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
          })
        }
      );
      if (res.ok) {
        const data = await res.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (jsonText) {
          const parsed = JSON.parse(jsonText);
          return _mapAIResponse(parsed, tokens, allProducts);
        }
      }
    } catch (e) {
      console.warn('[VoiceV4] Gemini failed:', e);
    }
  }

  return null;
}

function _buildAIPrompt(rawText: string, candidates: Product[]): string {
  return `You are an AI billing assistant for "Sai Ram Kirana" grocery store in India.
Parse this spoken command (may be Telugu, Hindi, English, or mixed): "${rawText}"

Candidate products from our catalog:
${JSON.stringify(candidates.map(p => ({ id: p.id, name: p.display_name, aliases: p.aliases })), null, 2)}

Rules:
1. Detect language automatically (Telugu script, transliterated Telugu, Hindi, English, mixed).
2. Map regional numbers: రెండు=2, दो=2, అర=0.5, आधा=0.5, పావు=0.25, पाव=0.25.
3. Map regional sizes: "అర కేజీ"=500g, "आधा किलो"=500g, "half kg"=500g, "dedh kilo"=1.5kg.
4. Set action: "ADD_ITEM" | "REMOVE_ITEM" | "UPDATE_ITEM" | "PRINT_BILL".
5. Match to the best candidate product, set resolvedProductId to its id.
6. Respond ONLY with JSON:
{"action":"ADD_ITEM","resolvedProductId":null,"productName":"","quantity":1,"unit":"Piece","price":null}`;
}

function _mapAIResponse(
  parsed: any,
  tokens: ParsedTokens,
  products: Product[]
): Omit<VoiceParseResult, 'rawText' | 'executionTimeMs' | 'aiUsed' | 'resolvedByMemory' | 'resolvedByCache'> {
  let resolvedProduct: Product | undefined;
  if (parsed.resolvedProductId) {
    resolvedProduct = products.find(p => p.id === parsed.resolvedProductId);
  }
  if (!resolvedProduct && parsed.productName) {
    const pn = parsed.productName.toLowerCase();
    resolvedProduct = products.find(p =>
      p.display_name.toLowerCase() === pn ||
      p.aliases?.some(a => a.toLowerCase() === pn) ||
      p.display_name.toLowerCase().includes(pn) ||
      p.aliases?.some(a => a.toLowerCase().includes(pn))
    );
  }
  const confidence = resolvedProduct ? 85 : 30;
  return {
    action: parsed.action || tokens.action,
    resolvedProduct,
    productName: resolvedProduct?.display_name || parsed.productName || '',
    quantity: parsed.quantity ?? tokens.quantity,
    unit: parsed.unit || tokens.unit || 'Piece',
    price: parsed.price ?? tokens.price,
    confidence,
    needsConfirmation: false,
    suggestions: [],
  };
}

// ─── SELF-LEARNING & LOGGING ──────────────────────────────────────────────────

export async function recordVoiceSuccess(
  rawText: string,
  productId: number,
  quantity: number,
  unit: string,
  action: string
): Promise<void> {
  try {
    await db.saveVoiceMemory({
      key: rawText.toLowerCase().trim(),
      product_id: productId,
      quantity,
      unit,
      action,
    });
    await db.saveVoiceCacheEntry({
      phrase: rawText.toLowerCase().trim(),
      product_id: productId,
      quantity,
      unit,
      action: action as 'ADD_ITEM' | 'REMOVE_ITEM' | 'UPDATE_ITEM',
    });
  } catch (e) {
    console.error('[VoiceV4] recordVoiceSuccess error:', e);
  }
}

export async function recordVoiceCorrection(
  rawText: string,
  wrongProductId: number | undefined,
  correctProductId: number,
  quantity: number,
  unit: string,
  action: string
): Promise<void> {
  try {
    if (wrongProductId !== undefined) {
      await db.saveVoiceCorrection(rawText.toLowerCase().trim(), wrongProductId, correctProductId);
    }
    await db.saveVoiceMemory({
      key: rawText.toLowerCase().trim(),
      product_id: correctProductId,
      quantity,
      unit,
      action,
    });
    await db.saveVoiceCacheEntry({
      phrase: rawText.toLowerCase().trim(),
      product_id: correctProductId,
      quantity,
      unit,
      action: action as 'ADD_ITEM' | 'REMOVE_ITEM' | 'UPDATE_ITEM',
    });
  } catch (e) {
    console.error('[VoiceV4] recordVoiceCorrection error:', e);
  }
}

async function _logVoiceAttempt(
  transcript: string,
  predictedProductId: number | null | undefined,
  finalProductId: number | null | undefined,
  confidence: number,
  aiUsed: boolean,
  executionTimeMs: number,
  success: boolean
): Promise<void> {
  try {
    await db.saveVoiceLog({
      transcript,
      predicted_product_id: predictedProductId ?? null,
      final_product_id: finalProductId ?? null,
      confidence,
      ai_used: aiUsed,
      execution_time_ms: executionTimeMs,
      success,
    });
  } catch {
    // Non-critical
  }
}
