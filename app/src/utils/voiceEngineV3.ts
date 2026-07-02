/**
 * Voice AI Engine V3
 * ==================
 * A low-latency multilingual voice billing engine for Sai Ram Kirana.
 *
 * Features:
 * - Supports Telugu, Hindi, English and all mixed combinations
 * - Confidence engine (0-100 scoring)
 * - Decision engine: ≥90 execute | 60-89 suggest | <60 AI fallback
 * - Partial result live parsing
 * - Groq-first → Gemini-backup AI ordering
 * - Self-learning: voice_memory, voice_phrase_cache, voice_corrections, voice_logs
 * - AI usage <10% target
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
  needsConfirmation: boolean;   // true when confidence 60-89
  suggestions: Product[];       // top candidates when confirmation needed
  aiUsed: boolean;
  resolvedByMemory: boolean;
  resolvedByCache: boolean;
  rawText: string;
  executionTimeMs: number;
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
  'आधा': 0.5, 'पाव': 0.25, 'सवा': 1.25, 'डेढ़': 1.5,
  'ढाई': 2.5, 'पौना': 0.75,
  // Phonetic English in Telugu Script
  'వన్': 1, 'టూ': 2, 'త్రీ': 3, 'ఫోర్': 4, 'ఫైవ్': 5,
  'సిక్స్': 6, 'సెవెన్': 7, 'ఎయిట్': 8, 'నైన్': 9, 'టెన్': 10,
  'ట్వంటీ': 20, 'థర్టీ': 30, 'ఫోర్టీ': 40, 'フィフティ': 50, 'ఫిఫ్టీ': 50,
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
  tray: 'Tray', trays: 'Tray', 'ట్రే': 'Tray',
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

// ─── HELPERS & SCORING UTILS ──────────────────────────────────────────────────

interface ScoreResult {
  product: Product;
  score: number;
  matchType: 'exact' | 'alias' | 'fuzzy' | 'memory' | 'cache';
}

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

function isPackagedProduct(product: Product): boolean {
  if (product.category_id !== 1 && product.category_id !== 2) {
    return true;
  }
  const SIZE_SUFFIX_REGEX = /\b(?:\d+(?:\.\d+)?\s*(?:g|kg|ml|l|litre|liter|grams|kilograms|litres|liters)|half\s*(?:kg|litre|liter|kilo)|quarter\s*(?:kg|litre|liter|kilo))\b/i;
  if (SIZE_SUFFIX_REGEX.test(product.display_name)) {
    return true;
  }
  return false;
}

function scoreProducts(
  query: string,
  products: Product[],
  sizeSearchStrings: string[],
  memoryHits: number[],
  correctionHits: number[]
): ScoreResult[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const qTokens = q.split(/\s+/).filter(t => t.length > 1);

  // Initialize Fuse.js for scoring
  const fuse = new Fuse(products, {
    keys: [
      { name: 'display_name', weight: 0.7 },
      { name: 'aliases', weight: 0.3 }
    ],
    threshold: 0.5,
    includeScore: true
  });
  const fuseResults = fuse.search(q);
  const fuseScoreMap = new Map<number, number>();
  for (const res of fuseResults) {
    if (res.score !== undefined) {
      fuseScoreMap.set(res.item.id, res.score);
    }
  }

  const results: ScoreResult[] = [];

  for (const p of products) {
    let score = 0;
    const nameLower = p.display_name.toLowerCase();
    const aliases = (p.aliases || []).map(a => a.toLowerCase());

    // 1. Alias Match (+40): exact display name or exact alias match
    const hasAliasMatch = (nameLower === q || aliases.some(a => a === q));
    if (hasAliasMatch) {
      score += 40;
    }

    // 2. Voice Memory (+30)
    const hasMemoryMatch = memoryHits.includes(p.id);
    if (hasMemoryMatch) {
      score += 30;
    }

    // 3. Variant Match (+20)
    let hasVariantMatch = false;
    if (sizeSearchStrings.length > 0) {
      const nameNorm = nameLower.replace(/\s+/g, '');
      const aliasNorms = aliases.map(a => a.replace(/\s+/g, ''));
      hasVariantMatch = sizeSearchStrings.some(sStr =>
        nameNorm.includes(sStr) || aliasNorms.some(aNorm => aNorm.includes(sStr))
      );
      if (hasVariantMatch) {
        score += 20;
      }
    }

    // 4. Correction Match (+20)
    const hasCorrectionMatch = correctionHits.includes(p.id);
    if (hasCorrectionMatch) {
      score += 20;
    }

    // 5. Fuzzy Match (+10 max): Fuse.js match score converted to points
    let fuzzyScore = 0;
    if (fuseScoreMap.has(p.id)) {
      const fuseScore = fuseScoreMap.get(p.id)!;
      // 0.0 fuseScore -> 10 points, 0.5 fuseScore -> 0 points (linearly scaled)
      fuzzyScore = Math.max(0, Math.min(10, Math.round((1 - (fuseScore / 0.5)) * 10)));
    }
    score += fuzzyScore;

    // Basic token matching overlap check for base score
    const hasTokenOverlap = qTokens.length > 0
      ? qTokens.some(token => nameLower.includes(token) || aliases.some(a => a.includes(token)))
      : (nameLower.includes(q) || aliases.some(a => a.includes(q)));

    // 6. Base Score (+30) for basic token matching
    if (hasAliasMatch || hasMemoryMatch || hasVariantMatch || hasCorrectionMatch || fuzzyScore > 0 || hasTokenOverlap) {
      score += 30;
    } else {
      score -= 50; // Unknown Product penalty
    }

    // Cap between 0 and 100
    const finalScore = Math.max(0, Math.min(score, 100));

    if (finalScore > 0) {
      results.push({
        product: p,
        score: finalScore,
        matchType: hasAliasMatch ? 'alias' : hasMemoryMatch ? 'memory' : hasCorrectionMatch ? 'cache' : 'fuzzy'
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}


// ─── QUANTITY / UNIT / ACTION PARSING ───────────────────────────────────────

interface ParsedTokens {
  action: 'ADD_ITEM' | 'REMOVE_ITEM' | 'UPDATE_ITEM' | 'PRINT_BILL';
  quantity: number; // itemCount
  unit: string; // transaction unit parsed (e.g. KG)
  price?: number;
  productQuery: string;
  sizeQty?: number;
  sizeUnit?: string;
  sizeInQuery?: string;
}

function parseTokens(rawText: string): ParsedTokens {
  let text = rawText.toLowerCase().trim();

  // 1. Check print actions first
  for (const pat of ACTION_PRINT) {
    if (text.includes(pat.toLowerCase())) {
      return { action: 'PRINT_BILL', quantity: 1, unit: 'Piece', productQuery: '' };
    }
  }

  // 2. Determine action
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

  // 3. Regional size normalization (longest match first)
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

  // 4. Standard size pattern: "500g", "1kg", "1.5l", "250ml", etc.
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

  // 5. Replace number words (like "రెండు") with digits
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

  // 6. Extract transaction unit (e.g. loose unit like KG, if specified)
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

  // 7. Extract item count / quantity and price from remaining numbers
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

  // 8. Clean filler words from product query
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
    quantity: quantity ?? 1, // default item count = 1
    unit: resolvedUnit || 'Piece', // default unit = Piece
    price,
    productQuery,
    sizeQty,
    sizeUnit,
    sizeInQuery,
  };
}

// ─── PARTIAL RESULT PROCESSOR ────────────────────────────────────────────────

let _partialCandidateCache: Product[] = [];

/**
 * Process partial transcript from native recognizer while user is still speaking.
 * Returns quickly-loaded product candidates for instant UI feedback.
 */
export async function processPartialTranscript(partialText: string): Promise<Product[]> {
  if (!partialText.trim()) return [];
  try {
    const products = await db.getProducts();
    const tokens = parseTokens(partialText);
    if (!tokens.productQuery) return [];

    const sizeSearchStrings = (tokens.sizeQty && tokens.sizeUnit)
      ? getSizeSearchStrings(tokens.sizeQty, tokens.sizeUnit)
      : [];

    const scored = scoreProducts(tokens.productQuery, products, sizeSearchStrings, [], []);
    _partialCandidateCache = scored.slice(0, 5).map(s => s.product);
    return _partialCandidateCache;
  } catch {
    return [];
  }
}

// ─── MAIN VOICE RESOLVE ──────────────────────────────────────────────────────

/**
 * Process a final voice transcript and resolve it to a billing action.
 * This is the core engine entry point.
 */
export async function resolveVoiceCommand(rawText: string): Promise<VoiceParseResult> {
  const startTime = Date.now();
  let aiUsed = false;
  let resolvedByMemory = false;
  let resolvedByCache = false;

  // ── 1. Phrase cache lookup (fastest path) ──────────────────────────────
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
        confidence: 95,
        needsConfirmation: false,
        suggestions: [],
        aiUsed: false,
        resolvedByMemory: false,
        resolvedByCache: true,
        rawText,
        executionTimeMs: Date.now() - startTime,
      };
      await _logVoiceAttempt(rawText, resolvedProduct.id, resolvedProduct.id, 95, false, result.executionTimeMs, true);
      return result;
    }
  }

  // ── 2. Parse tokens (action, quantity, unit, product query) ──────────────
  const tokens = parseTokens(rawText);

  if (tokens.action === 'PRINT_BILL') {
    return {
      action: 'PRINT_BILL', quantity: 1, unit: 'Piece',
      confidence: 100, needsConfirmation: false, suggestions: [],
      aiUsed: false, resolvedByMemory: false, resolvedByCache: false,
      rawText, executionTimeMs: Date.now() - startTime,
    };
  }

  const products = await db.getProducts();
  const productQuery = tokens.productQuery;

  // ── 3. Find memory and corrections hits for main scoring
  const voiceMemory = await db.getVoiceMemory();
  const memoryHits = voiceMemory
    .filter(v =>
      v.key.toLowerCase() === rawText.toLowerCase().trim() ||
      v.key.toLowerCase() === productQuery.toLowerCase()
    )
    .map(v => v.product_id);

  const corrections = await db.getVoiceCorrections();
  const correctionHits = corrections
    .filter(c =>
      c.phrase.toLowerCase() === rawText.toLowerCase().trim() ||
      c.phrase.toLowerCase() === productQuery.toLowerCase()
    )
    .map(c => c.correct_product_id);

  // ── 4. Main Scoring & Fuzzy matching
  const sizeSearchStrings = (tokens.sizeQty && tokens.sizeUnit)
    ? getSizeSearchStrings(tokens.sizeQty, tokens.sizeUnit)
    : [];

  let scored = scoreProducts(productQuery, products, sizeSearchStrings, memoryHits, correctionHits);

  const topScore = scored[0]?.score ?? 0;
  const topProduct = scored[0]?.product;

  // Map quantity and unit depending on loose commodity vs packaged variant
  let finalQty = tokens.quantity; // default: itemCount
  let finalUnit = tokens.unit; // default: Piece or resolvedUnit

  if (topProduct) {
    if (isPackagedProduct(topProduct)) {
      finalQty = tokens.quantity;
      finalUnit = topProduct.units?.[0]?.unit_name || 'Piece';
    } else {
      if (tokens.sizeQty) {
        finalQty = tokens.quantity * tokens.sizeQty;
        finalUnit = tokens.sizeUnit || 'Piece';
      } else {
        finalQty = tokens.quantity;
        finalUnit = tokens.unit;
      }
    }
  }

  // ── 5. Confidence engine decision ─────────────────────────────────────────

  // Check if resolved by memory in scoring
  if (topProduct && memoryHits.includes(topProduct.id)) {
    resolvedByMemory = true;
  }

  // ≥ 90: execute immediately
  if (topScore >= 90 && topProduct) {
    const result: VoiceParseResult = {
      action: tokens.action,
      resolvedProduct: topProduct,
      productName: topProduct.display_name,
      quantity: finalQty,
      unit: finalUnit,
      price: tokens.price,
      confidence: Math.min(topScore, 99),
      needsConfirmation: false,
      suggestions: [],
      aiUsed: false,
      resolvedByMemory,
      resolvedByCache: false,
      rawText,
      executionTimeMs: Date.now() - startTime,
    };
    await _logVoiceAttempt(rawText, topProduct.id, topProduct.id, result.confidence, false, result.executionTimeMs, true);
    return result;
  }

  // 60-89: suggest top 3 for confirmation
  if (topScore >= 60 && topProduct) {
    const suggestions = scored.slice(0, 3).map(s => s.product);
    const result: VoiceParseResult = {
      action: tokens.action,
      resolvedProduct: topProduct,
      productName: topProduct.display_name,
      quantity: finalQty,
      unit: finalUnit,
      price: tokens.price,
      confidence: topScore,
      needsConfirmation: true,
      suggestions,
      aiUsed: false,
      resolvedByMemory,
      resolvedByCache: false,
      rawText,
      executionTimeMs: Date.now() - startTime,
    };
    await _logVoiceAttempt(rawText, topProduct.id, null, topScore, false, result.executionTimeMs, false);
    return result;
  }

  // < 60: AI fallback ────────────────────────────────────────────────────────
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
    };
    const pid = aiResult.resolvedProduct?.id ?? null;
    await _logVoiceAttempt(rawText, pid, pid, aiResult.confidence, true, result.executionTimeMs, pid !== null);

    // Cache successful AI resolution
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

  // Complete failure → return UNKNOWN for manual selection
  return {
    action: 'UNKNOWN',
    quantity: finalQty,
    unit: finalUnit,
    price: tokens.price,
    confidence: 0,
    needsConfirmation: false,
    suggestions: scored.slice(0, 5).map(s => s.product),
    aiUsed,
    resolvedByMemory,
    resolvedByCache,
    rawText,
    executionTimeMs: Date.now() - startTime,
  };
}

// ─── AI FALLBACK ─────────────────────────────────────────────────────────────

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

  // Try Groq first (faster, better for short commands)
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
      console.warn('[VoiceV3] Groq failed:', e);
    }
  }

  // Gemini backup
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
      console.warn('[VoiceV3] Gemini failed:', e);
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
  const confidence = resolvedProduct ? 75 : 30;
  return {
    action: parsed.action || tokens.action,
    resolvedProduct,
    productName: resolvedProduct?.display_name || parsed.productName || '',
    quantity: parsed.quantity ?? tokens.quantity,
    unit: parsed.unit || tokens.unit || 'Piece',
    price: parsed.price ?? tokens.price,
    confidence,
    needsConfirmation: !resolvedProduct,
    suggestions: resolvedProduct ? [] : [],
  };
}

// ─── SELF-LEARNING ───────────────────────────────────────────────────────────

/**
 * Call this after a successful voice command execution to train memory.
 */
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
    console.error('[VoiceV3] recordVoiceSuccess error:', e);
  }
}

/**
 * Call this when the user corrects a wrong AI prediction.
 */
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
    console.error('[VoiceV3] recordVoiceCorrection error:', e);
  }
}

// ─── INTERNAL LOGGING ────────────────────────────────────────────────────────

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
    // Non-critical — don't crash if logging fails
  }
}
