// Voice Intelligence Engine for parsing billing and system commands
// Supports multilingual input (English, Telugu, Hindi) and fallback rules.

import { db } from '../db';
import type { Product, Customer } from '../db';

export interface ParsedCommand {
  action: 'ADD_ITEM' | 'REMOVE_ITEM' | 'UPDATE_ITEM' | 'PRINT_BILL' | 'CLEAR_KHATA' | 'UNKNOWN';
  productName?: string;
  quantity?: number;
  unit?: string;
  price?: number;
  rawText: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  resolvedProduct?: Product;
  resolvedByAI?: boolean;
}

// Language Translations dictionaries
const TELUGU_NUMBERS: Record<string, number> = {
  'ఒకటి': 1, 'ఒక': 1, 'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4, 'ఐదు': 5, 
  'ఆరు': 6, 'ఏడు': 7, 'ఎనిమిది': 8, 'తొమ్మిది': 9, 'పది': 10,
  'పన్నెండు': 12, 'పద్నాలుగు': 14, 'ఇరవై': 20, 'ముప్పై': 30, 
  'నలభై': 40, 'యాభై': 50, 'డెబ్బై': 70, 'ఎనభై': 80, 'తొంభై': 90,
  'రెండు వందల యాభై': 250, 'రెండు వందల': 200, 'వంద': 100, 'నూరు': 100, 'ఐదు వందల': 500,
  'అర': 0.5, 'పావు': 0.25, 'ముప్పావు': 0.75, 'ఒకటిన్నర': 1.5, 'రెండున్నర': 2.5,
  // Phonetic English numbers in Telugu script
  'వన్': 1, 'టూ': 2, 'త్రీ': 3, 'ఫోర్': 4, 'ఫైవ్': 5, 'సిక్స్': 6, 'సెవెన్': 7, 'ఎయిట్': 8, 'నైన్': 9, 'టెన్': 10,
  'ట్వంటీ': 20, 'థర్టీ': 30, 'ఫోర్టీ': 40, 'ఫిఫ్టీ': 50, 'హండ్రెడ్': 100, 'టూ హండ్రెడ్': 200, 'ఫైవ్ హండ్రెడ్': 500,
  // Transliterated Telugu numbers & compound terms
  'rendu vandala yabhai': 250,
  'rendu vandala yabai': 250,
  'rendu vandala yaabhai': 250,
  'rendu vandalu': 200,
  'rendu vandala': 200,
  'aidu vandalu': 500,
  'aidu vandala': 500,
  'vanda': 100,
  'nuru': 100,
  'okatinara': 1.5,
  'rendunnara': 2.5,
  'okatiన్నర': 1.5,
  'renduన్నర': 2.5,
  'okati': 1, 'oka': 1, 'rendu': 2, 'moodu': 3, 'mudu': 3, 'nalugu': 4, 'naalugu': 4, 'aidu': 5, 
  'aaru': 6, 'yedu': 7, 'aedu': 7, 'enimidi': 8, 'tommidi': 9, 'padi': 10,
  'iravai': 20, 'muppai': 30, 'nalabhai': 40, 'yabhai': 50, 'yaabhai': 50, 'yabai': 50,
  'ara': 0.5, 'pavu': 0.25, 'paavu': 0.25, 'muppavu': 0.75
};

const HINDI_NUMBERS: Record<string, number> = {
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पाँच': 5, 'छह': 6, 'सात': 7, 
  'आठ': 8, 'नौ': 9, 'दस': 10, 'बारह': 12, 'चौदह': 14, 'बीस': 20, 
  'तीस': 30, 'चालीस': 40, 'पचास': 50, 'ढाई सौ': 250, 'दो सौ': 200, 'सौ': 100, 'पाँच सौ': 500,
  'आधा': 0.5, 'पाव': 0.25, 'पौना': 0.75, 'डेढ़': 1.5, 'ढाई': 2.5,
  // Transliterated Hindi numbers
  'ek': 1, 'do': 2, 'teen': 3, 'chaar': 4, 'char': 4, 'paanch': 5, 'panch': 5, 'chhah': 6, 'che': 6, 'saat': 7,
  'aath': 8, 'nau': 9, 'das': 10, 'bees': 20, 'tees': 30, 'chalis': 40, 'pachas': 50, 'dhai sau': 250,
  'adha': 0.5, 'aadha': 0.5, 'pav': 0.25, 'paav': 0.25, 'pouna': 0.75, 'dedh': 1.5, 'ded': 1.5, 'dhai': 2.5
};

const ENGLISH_NUMBERS: Record<string, number> = {
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7,
  'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13,
  'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'twenty': 20, 'thirty': 30,
  'forty': 40, 'fifty': 50, 'two hundred fifty': 250, 'two hundred and fifty': 250, 'hundred': 100,
  'half': 0.5, 'quarter': 0.25
};

// Unit mapping
const UNIT_MAP: Record<string, string> = {
  // Grams
  'g': 'Gram', 'gram': 'Gram', 'grams': 'Gram', 'gramullu': 'Gram', 'gramulu': 'Gram', 'gramula': 'Gram', 'గ్రాములు': 'Gram', 'గ్రాముల': 'Gram', 'గ్రామ్': 'Gram', 'గ్రాం': 'Gram', 'ग्राम': 'Gram',
  // KG
  'kg': 'KG', 'kgs': 'KG', 'kilo': 'KG', 'kilos': 'KG', 'కేజీ': 'KG', 'కేజీలు': 'KG', 'కెజి': 'KG', 'కెజీ': 'KG', 'కిలో': 'KG', 'కిలోలు': 'KG', 'కిలోల': 'KG', 'केजी': 'KG', 'किलोग्राम': 'KG', 'किलो': 'KG',
  // Litre
  'l': 'Litre', 'litre': 'Litre', 'litres': 'Litre', 'లీటర్': 'Litre', 'లీటర్లు': 'Litre', 'లీటర్ల': 'Litre', 'లీటరు': 'Litre', 'लीटर': 'Litre',
  // ML
  'ml': 'ML', 'mls': 'ML', 'మిల్లీలీటర్': 'ML', 'एमएल': 'ML', 'मिलीलीटर': 'ML',
  // Packet
  'packet': 'Pudha', 'packets': 'Pudha', 'ప్యాకెట్': 'Pudha', 'ప్యాకెట్లు': 'Pudha', 'पैकेट': 'Pudha',
  // Pudha (Pouch/Packet)
  'pudha': 'Pudha', 'pudhas': 'Pudha', 'puda': 'Pudha', 'pudas': 'Pudha', 'pooda': 'Pudha', 'poodas': 'Pudha', 'పుడ': 'Pudha', 'పుడలు': 'Pudha', 'పుడా': 'Pudha', 'पुड़ा': 'Pudha', 'पुड़े': 'Pudha',
  // Piece
  'piece': 'Piece', 'pieces': 'Piece', 'ピーస్': 'Piece', 'ピーసులు': 'Piece', 'पीस': 'Piece', 'నగ': 'Piece', 'single': 'Piece', 'singles': 'Piece',
  // Sheet
  'sheet': 'Sheet', 'sheets': 'Sheet', 'షీట్': 'Sheet', 'షీట్లు': 'Sheet', 'शीट': 'Sheet',
  // Bag
  'bag': 'Bag', 'bags': 'Bag', 'బస్తా': 'Bag', 'బస్తాలు': 'Bag', 'बोरी': 'Bag', 'बैग': 'Bag',
  // Box
  'box': 'Box', 'boxes': 'Box', 'బాక్స్': 'Box', 'డిబ్బా': 'Box', 'डिब्बा': 'Box'
};

const REGIONAL_SIZE_NORMALIZATIONS: Record<string, string> = {
  // 50g (Cheytak / Chhatak)
  'చేతక్': '50g', 'ఛటాక్': '50g', 'చటాక్': '50g',
  'cheytak': '50g', 'chhatak': '50g', 'chatak': '50g', 'cheetak': '50g', 'cheetaak': '50g',
  'छटाक': '50g',

  // 125g (Adha Pav / Adda Pav)
  'అద్దపావు': '125g', 'ఆధా పావు': '125g', 'అరపావు': '125g', 'ఆధాపవు': '125g',
  'adda pav': '125g', 'adha pav': '125g', 'adda paav': '125g', 'adha paav': '125g',
  'addapavu': '125g', 'adhapavu': '125g',
  'आधा पाव': '125g', 'अधा पाव': '125g',

  // 750g (Three-Quarter KG / Pouna Kilo / Thin Pav)
  'ముప్పావు కేజీ': '750g', 'ముప్పావు కిలో': '750g', 'ముప్పావుకేజీ': '750g', 'ముప్పావుకిలో': '750g',
  'తీన్ పావు': '750g', 'తీన్పావు': '750g',
  'muppavu kg': '750g', 'muppavu kilo': '750g', 'muppaavu kg': '750g', 'muppaavu kilo': '750g',
  'three quarter kg': '750g', 'three quarter kilo': '750g', 'three quarters kg': '750g',
  'thin pav': '750g', 'teen pav': '750g', 'teen paav': '750g', 'thin paav': '750g',
  'teenpav': '750g', 'thinpav': '750g',
  'पौना किलो': '750g', 'पौने तीन पाव': '750g', 'तीन पाव': '750g',
  'pouna kilo': '750g', 'pouna kg': '750g', 'pona kilo': '750g', 'pona kg': '750g',

  // 1.5kg (Dedh Kilo)
  'డేడ్ కిలో': '1.5kg', 'డేడ్ కేజీ': '1.5kg',
  'dedh kilo': '1.5kg', 'ded kilo': '1.5kg', 'dedh kg': '1.5kg', 'ded kg': '1.5kg',
  'dedh ser': '1.5kg', 'ded ser': '1.5kg',
  'डेढ़ किलो': '1.5kg', 'डेढ़ केजी': '1.5kg',

  // 10g (Stullam / Thulam / Tola)
  'తులం': '10g', 'తులా': '10g', 'తోలా': '10g', 'తోలం': '10g',
  'stullam': '10g', 'thulam': '10g', 'tola': '10g', 'tula': '10g',
  'तोलं': '10g', 'तौला': '10g', 'तुला': '10g',

  // 1.25kg (Sawa Kilo)
  'సవా కిలో': '1.25kg', 'సవా కేజీ': '1.25kg',
  'sawa kilo': '1.25kg', 'sava kilo': '1.25kg', 'sawa kg': '1.25kg', 'sava kg': '1.25kg',
  'सवा किलो': '1.25kg', 'सवा केजी': '1.25kg',

  // 2.5kg (Dhai Kilo)
  'రెండున్నర కిలో': '2.5kg', 'రెండున్నర కేజీ': '2.5kg',
  'dhai kilo': '2.5kg', 'dai kilo': '2.5kg', 'dhai kg': '2.5kg', 'dai kg': '2.5kg',
  'ढाई किलो': '2.5kg', 'ढाई केजी': '2.5kg',

  // 1.75kg (Paune Do Kilo)
  'पौने दो किलो': '1.75kg', 'पौने दो केजी': '1.75kg',
  'paune do kilo': '1.75kg', 'pone do kilo': '1.75kg', 'paune do kg': '1.75kg', 'pone do kg': '1.75kg',

  // 500g (Half KG / Ara Kilo) equivalents
  'అర కేజీ': '500g', 'అర కిలో': '500g', 'సగం కేజీ': '500g', 'సగం కిలో': '500g',
  'అరకేజీ': '500g', 'అరకిలో': '500g', 'హాఫ్ కేజీ': '500g', 'హాఫ్ కిలో': '500g',
  'హాఫ్ కేజి': '500g', 'హాఫ్ కిలోల': '500g', 'హాఫ్ కేజీల': '500g',
  'ara kg': '500g', 'ara kilo': '500g', 'sagam kg': '500g', 'sagam kilo': '500g',
  'half kg': '500g', 'half kilo': '500g', 'haaf kg': '500g', 'haaf kilo': '500g',
  'आधा किलो': '500g', 'आधा केजी': '500g', 'अधा किलो': '500g',
  'aadha kilo': '500g', 'aadha kg': '500g', 'adha kilo': '500g', 'adha kg': '500g',
  'half kilogram': '500g', 'half kilograms': '500g',

  // 250g (Quarter KG / Pav Kilo) equivalents
  'పావు కేజీ': '250g', 'పావు కిలో': '250g', 'పావుకేజీ': '250g', 'పావుకిలో': '250g',
  'పావు కేజి': '250g', 'పావు కిలోల': '250g', 'పావు కేజీల': '250g',
  'pavu kg': '250g', 'pavu kilo': '250g', 'paavu kg': '250g', 'paavu kilo': '250g',
  'quarter kg': '250g', 'quarter kilo': '250g',
  'पाव किलो': '250g', 'पाव केजी': '250g',
  'pao kilo': '250g', 'pao kg': '250g', 'pav kilo': '250g', 'pav kg': '250g',
  'quarter kilogram': '250g', 'quarter kilograms': '250g',

  // 500ml (Half Litre) equivalents
  'అర లీటర్': '500ml', 'అర లీటరు': '500ml', 'సగం లీటర్': '500ml', 'హాఫ్ లీటర్': '500ml',
  'ara litre': '500ml', 'half litre': '500ml', 'half liter': '500ml',
  'आधा लीटर': '500ml', 'aadha liter': '500ml', 'adha liter': '500ml',

  // 250ml (Quarter Litre) equivalents
  'పావు లీటర్': '250ml', 'పావు లీటరు': '250ml',
  'pavu litre': '250ml', 'quarter litre': '250ml', 'quarter liter': '250ml',
  'पाव लीटर': '250ml', 'pav liter': '250ml',

  // 750ml (Three-Quarter Litre) equivalents
  'ముప్పావు లీటర్': '750ml', 'ముప్పావు లీటరు': '750ml',
  'muppavu litre': '750ml', 'three quarter litre': '750ml',
  'पौना लीटर': '750ml', 'pouna liter': '750ml'
};

// Main local parser
export async function parseVoiceCommandLocal(text: string): Promise<ParsedCommand> {
  const cleanText = text.toLowerCase().trim();
  const products = await db.getProducts();

  // 1. Check for system commands
  if (
    cleanText.includes('print bill') || 
    cleanText.includes('బిల్ ప్రింట్') || 
    cleanText.includes('ప్రింట్ బిల్') || 
    cleanText.includes('बिल प्रिंट')
  ) {
    return { action: 'PRINT_BILL', rawText: text, confidence: 'HIGH' };
  }

  // 2. Identify Action type
  let action: ParsedCommand['action'] = 'ADD_ITEM';
  let processedText = cleanText;

  // Normalize regional weight/volume size descriptions first (e.g. half kg -> 500g)
  const normalizationKeys = Object.keys(REGIONAL_SIZE_NORMALIZATIONS).sort((a, b) => b.length - a.length);
  for (const k of normalizationKeys) {
    const isEnglish = /^[a-zA-Z\s]+$/.test(k);
    const regex = isEnglish ? new RegExp(`\\b${k}\\b`, 'gi') : new RegExp(k, 'g');
    processedText = processedText.replace(regex, ` ${REGIONAL_SIZE_NORMALIZATIONS[k]} `).trim();
  }

  const removePatterns = [
    'remove', 'delete', 'cancel', 
    'తీసేయ్', 'తొలగించు', 'తీసివేయి', 'తీసేయి',
    'हटाओ', 'काट दो', 'निकालो'
  ];
  const editPatterns = [
    'change', 'update', 'edit', 'set', 'modify', 'price of',
    'మార్చు', 'చేయి', 'సవరించు', 'చేంజ్', 'చెంజ్', 'మార్చండి', 'మార్చి', 'సెట్', 'అప్డేట్', 'ఎడిట్',
    'बदलो', 'कर दो', 'चेंज', 'अपडेट', 'सेट', 'बदलें', 'बदल', 'बदल दो', 'badlo'
  ];

  const hasRemove = removePatterns.some(pat => {
    if (cleanText.includes(pat)) {
      processedText = cleanText.replace(pat, '').trim();
      return true;
    }
    return false;
  });

  if (hasRemove) {
    action = 'REMOVE_ITEM';
  } else {
    const hasEdit = editPatterns.some(pat => {
      if (cleanText.includes(pat)) {
        processedText = cleanText.replace(pat, '').trim();
        return true;
      }
      return false;
    });
    if (hasEdit) {
      action = 'UPDATE_ITEM';
    }
  }

  // 3. Extract quantity, unit and price
  let quantity: number | undefined;
  let price: number | undefined;
  let unit: string | undefined;

  // Replace number words with digits first (surrounded by spaces)
  const allNumberWords = {
    ...ENGLISH_NUMBERS,
    ...HINDI_NUMBERS,
    ...TELUGU_NUMBERS
  };
  const numberWordKeys = Object.keys(allNumberWords).sort((a,b) => b.length - a.length);

  for (const word of numberWordKeys) {
    const isEnglishWord = /^[a-zA-Z\s]+$/.test(word);
    const regex = isEnglishWord ? new RegExp(`\\b${word}\\b`, 'gi') : new RegExp(word, 'g');
    if (regex.test(processedText)) {
      processedText = processedText.replace(regex, ` ${allNumberWords[word]} `).trim();
    }
  }

  // Detect size patterns (e.g. 500 grams, 1 kg) when multiple numbers are present
  const sizePatternRegex = /(\d+(?:\.\d+)?)\s*(g|gram|grams|grm|grms|gm|gms|gramulu|గ్రాములు|గ్రాముల|గ్రామ్స్|గ్రామ్|గ్రాం|గ్రాంలు|కిలో|కేజీ|కిలోలు|కేజీలు|కెజి|కెజీ|కిలోల|కేజీల|kg|kilo|kilograms|kilos|l|litre|litres|లీటర్|లీటర్లు|లీటరు|ml|milliliter|మిల్లీలీటర్|మిల్లీలీటర్లు)/gi;
  const sizeMatches = [...processedText.matchAll(sizePatternRegex)];
  const allNumbers = processedText.match(/(\d+(?:\.\d+)?)/g) || [];

  let sizeText = '';
  let numberStringForExtraction = processedText;

  if (allNumbers.length >= 2 && sizeMatches.length > 0) {
    const fullSizeMatchText = sizeMatches[0][0];
    const matchedSizeNum = sizeMatches[0][1];
    const matchedSizeUnit = sizeMatches[0][2];
    
    const mappedUnit = UNIT_MAP[matchedSizeUnit.toLowerCase()];
    const normalizedUnitChar = mappedUnit === 'Gram' ? 'g' : 
                               mappedUnit === 'KG' ? 'kg' : 
                               mappedUnit === 'ML' ? 'ml' : 
                               mappedUnit === 'Litre' ? 'l' : matchedSizeUnit.toLowerCase();
    
    sizeText = `${matchedSizeNum}${normalizedUnitChar}`;
    
    // Replace the size match with space-padded normalized size in processedText
    processedText = processedText.replace(fullSizeMatchText, ` ${sizeText} `).trim();
    
    // Replace the normalized size text with placeholder in numberStringForExtraction
    numberStringForExtraction = processedText.replace(sizeText, '__SIZE__');
  }

  // We want to find the unit first so it doesn't get messed up by number strings or names
  // We run unit detection on numberStringForExtraction to avoid matching unit characters inside normalized size text (like 'g' in '500g')
  const unitKeys = Object.keys(UNIT_MAP).sort((a,b) => b.length - a.length);
  for (const unitText of unitKeys) {
    const isEnglishUnit = /^[a-zA-Z]+$/.test(unitText);
    const regex = isEnglishUnit ? new RegExp(`\\b${unitText}\\b`, 'gi') : new RegExp(unitText, 'g');

    if (regex.test(numberStringForExtraction)) {
      unit = UNIT_MAP[unitText];
      numberStringForExtraction = numberStringForExtraction.replace(regex, ' ').trim();
      // Remove it from processedText as well so the product query doesn't contain it
      processedText = processedText.replace(regex, ' ').trim();
      break;
    }
  }

  // Check for custom item addition command
  const isCustomItem = 
    processedText.includes('item') || 
    processedText.includes('ఐటమ్') || 
    processedText.includes('ఐటమ్స్') || 
    processedText.includes('ఆడ్ ఐటమ్') ||
    processedText.includes('आइटम');

  if (isCustomItem && (processedText.includes('add') || processedText.includes('yaad') || processedText.includes('యాడ్') || processedText.includes('जोड़ो') || processedText.includes('मिलाओ') || processedText.includes('కలుపు') || processedText.includes('ఆడ్'))) {
    const priceRegexes = [
      /price\s+(?:of\s+)?(\d+(?:\.\d+)?)/i,
      /(\d+(?:\.\d+)?)\s*(?:rupees|rupee|rs|రూపాయలు|రూపాయల|రూ|रूपए|रुपये)/i,
      /(?:rate|cost|price|ధర|రేటు|रेट|दाम)\s*(\d+(?:\.\d+)?)/i
    ];
    let detectedPrice: number | undefined;
    for (const priceRegex of priceRegexes) {
      const match = processedText.match(priceRegex);
      if (match) {
        detectedPrice = parseFloat(match[1]);
        break;
      }
    }

    if (detectedPrice !== undefined) {
      const textWithoutPrice = processedText.replace(String(detectedPrice), '').trim();
      
      const qtyRegexes = [
        /(?:quantity|qty|క్వాంటిటీ|మాత్ర|संख्या)\s*(?:is\s+)?(\d+(?:\.\d+)?)/i,
        /(\d+(?:\.\d+)?)\s*(?:quantity|qty|క్వాంటిటీ|మాత్ర|संख्या)/i
      ];
      let detectedQty: number | undefined;
      for (const qtyRegex of qtyRegexes) {
        const match = textWithoutPrice.match(qtyRegex);
        if (match) {
          detectedQty = parseFloat(match[1]);
          break;
        }
      }

      if (detectedQty === undefined) {
        const numbers = textWithoutPrice.match(/(\d+(\.\d+)?)/g);
        if (numbers && numbers.length > 0) {
          detectedQty = parseFloat(numbers[0]);
        }
      }

      return {
        action: 'ADD_ITEM',
        productName: 'item',
        quantity: detectedQty !== undefined ? detectedQty : 1,
        price: detectedPrice,
        unit: detectedQty !== undefined ? 'Piece' : 'NA',
        rawText: text,
        confidence: 'HIGH'
      };
    }
  }

  // Extract all numeric digits (including decimals) from numberStringForExtraction in order
  const matches = numberStringForExtraction.match(/(\d+(\.\d+)?)/g);
  if (matches) {
    if (matches.length >= 2) {
      quantity = parseFloat(matches[0]);
      price = parseFloat(matches[1]);
      processedText = processedText.replace(matches[0], ' ').replace(matches[1], ' ').trim();
      // If we find two numbers, it is highly likely an update or pricing action!
      if (action !== 'REMOVE_ITEM') {
        action = 'UPDATE_ITEM';
      }
    } else if (matches.length === 1) {
      const val = parseFloat(matches[0]);
      processedText = processedText.replace(matches[0], ' ').trim();

      const priceKeywords = [
        'price', 'rate', 'cost', 'rs', 'rupees', 'rupee',
        'ప్రైస్', 'రేట్', 'రేటు', 'ధర', 'రూపాయలు', 'రూపాయల',
        'रेट', 'भाव', 'दाम', 'रुपये', 'मूल्य',
        'dhara', 'rate', 'rupayalu', 'rupeelu', 'bhav', 'daam', 'rupaye'
      ];
      const hasPriceKeyword = priceKeywords.some(keyword => cleanText.includes(keyword));
      if (hasPriceKeyword) {
        price = val;
        if (action !== 'REMOVE_ITEM') {
          action = 'UPDATE_ITEM';
        }
      } else {
        quantity = val;
      }
    }
  }

  // 4. Resolve Product Name from the remaining text
  // Clear common filler words
  const fillers = [
    'of', 'to', 'for', 'changed', 'from', 'rate', 'price',
    'యొక్క', 'ను', 'nu', 'నుండి', 'ధర', 'రేటు',
    'का', 'को', 'की', 'भाव', 'रेट'
  ];
  fillers.forEach(f => {
    const reg = new RegExp(`\\b${f}\\b`, 'g');
    processedText = processedText.replace(reg, ' ').trim();
  });

  const queryProduct = processedText.replace(/\s+/g, ' ').trim();
  let resolvedProduct: Product | undefined;

  if (queryProduct) {
    // Priority 1: Exact Display Name match
    resolvedProduct = products.find(p => p.display_name.toLowerCase() === queryProduct) || undefined;

    // Priority 2: Exact Alias match
    if (!resolvedProduct) {
      resolvedProduct = products.find(p => 
        p.aliases?.some(a => a.toLowerCase() === queryProduct)
      ) || undefined;
    }

    // Priority 3: Substring check (query includes product name or alias)
    if (!resolvedProduct) {
      resolvedProduct = products.find(p => 
        queryProduct.includes(p.display_name.toLowerCase()) ||
        p.aliases?.some(a => queryProduct.includes(a.toLowerCase()))
      ) || undefined;
    }

    // Priority 4: Fuzzy Display Name match (product name or alias includes query)
    if (!resolvedProduct) {
      resolvedProduct = products.find(p => 
        p.display_name.toLowerCase().includes(queryProduct) ||
        p.aliases?.some(a => a.toLowerCase().includes(queryProduct))
      ) || undefined;
    }

    // Priority 5: Token-based match (all words in query must be present in display_name or aliases)
    if (!resolvedProduct) {
      const queryTokens = queryProduct.split(/\s+/).filter(t => t.length > 0);
      if (queryTokens.length > 0) {
        resolvedProduct = products.find(p => {
          const nameLower = p.display_name.toLowerCase();
          const matchesName = queryTokens.every(token => nameLower.includes(token));
          if (matchesName) return true;
          
          return p.aliases?.some(alias => {
            const aliasLower = alias.toLowerCase();
            return queryTokens.every(token => aliasLower.includes(token));
          });
        }) || undefined;
      }
    }
  }

  // Default quantity if none found and it's not a price update
  if (quantity === undefined && price === undefined) {
    quantity = 1;
  }

  // Default unit if product is found and has a standard unit
  if (!unit && resolvedProduct) {
    unit = resolvedProduct.units && resolvedProduct.units.length > 0 ? resolvedProduct.units[0].unit_name : 'Piece';
  }

  // Confidence check
  let confidence: ParsedCommand['confidence'] = 'LOW';
  if (resolvedProduct && (quantity !== undefined || price !== undefined)) {
    confidence = 'HIGH';
  } else if (resolvedProduct) {
    confidence = 'MEDIUM';
  }

  return {
    action,
    productName: resolvedProduct ? resolvedProduct.display_name : queryProduct,
    quantity,
    price,
    unit,
    rawText: text,
    confidence,
    resolvedProduct
  };
}

// Helper to extract candidate products matching keywords in text (fuzzy matching / nearby things)
export function getFuzzyCandidates(text: string, products: Product[]): Product[] {
  const cleanText = text.toLowerCase().trim();
  if (!cleanText) return [];

  // Define stopwords (numbers, units, actions, fillers) to isolate potential product keywords
  const stopWords = new Set<string>([
    // English fillers, units, actions, numbers
    'add', 'remove', 'delete', 'cancel', 'update', 'change', 'edit', 'print', 'bill', 'of', 'to', 'for', 'from', 'with', 'and', 'the',
    'kg', 'kgs', 'g', 'gram', 'grams', 'litre', 'litres', 'ml', 'mls', 'piece', 'pieces', 'sheet', 'sheets', 'bag', 'bags', 'pudha', 'pudhas', 'puda', 'pudas',
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'hundred', 'thousand',
    
    // Telugu fillers, units, actions, numbers
    'తీసేయ్', 'తొలగించు', 'తీసివేయి', 'తీసేయి', 'మార్చు', 'చేయి', 'సవరించు', 'ప్రింట్', 'బిల్', 'బిల్లు',
    'యొక్క', 'ను', 'nu', 'నుండి', 'ధర', 'రేటు',
    'ఒకటి', 'ఒక', 'రెండు', 'మూడు', 'నాలుగు', 'ఐదు', 'ఆరు', 'ఏడు', 'ఎనిమిది', 'తొమ్మిది', 'పది',
    'కేజీ', 'కేజీలు', 'కెజి', 'కెజీ', 'కిలో', 'కిలోలు', 'కిలోల', 'గ్రాములు', 'గ్రాముల', 'గ్రామ్', 'గ్రాం',
    'లీటర్', 'లీటర్లు', 'లీటర్ల', 'లీటరు', 'మిల్లీలీటర్', 'ప్యాకెట్', 'ప్యాకెట్లు', 'పీస్', 'పీసులు', 'నగ', 'బస్తా', 'బస్తాలు', 'బాక్స్',

    // Hindi fillers, units, actions, numbers
    'हटाओ', 'काट', 'दो', 'निकालो', 'बदलो', 'कर', 'को', 'की', 'का', 'भाव', 'रेट',
    'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस',
    'ग्राम', 'किलोग्राम', 'लीटर', 'मिलीलीटर', 'पैकेट', 'पीस', 'बोरी', 'डिब्बा'
  ]);

  // Extract word tokens (support Telugu, Hindi, English characters)
  const tokens = cleanText
    .split(/[\s,.\-!?()'"\/]+/)
    .map(t => t.trim())
    .filter(t => t.length > 1) // ignore single letter tokens
    .filter(t => !/^\d+$/.test(t)) // ignore pure numbers
    .filter(t => !stopWords.has(t));

  if (tokens.length === 0) {
    return products;
  }

  const scored = products.map(product => {
    let score = 0;
    const nameLower = product.display_name.toLowerCase();
    const notesLower = (product.notes || '').toLowerCase();
    const aliasesLower = (product.aliases || []).map(a => a.toLowerCase());

    for (const token of tokens) {
      if (nameLower === token || aliasesLower.includes(token)) {
        score += 10;
      } else if (nameLower.includes(token)) {
        score += 5;
      } else if (aliasesLower.some(alias => alias.includes(token))) {
        score += 4;
      } else if (notesLower.includes(token)) {
        score += 2;
      }
    }
    return { product, score };
  });

  const matched = scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.product);

  return matched.length > 0 ? matched : products;
}

// Online parser proxying to Gemini / Groq if configured, falls back to local parser
export async function parseVoiceCommand(text: string): Promise<ParsedCommand> {
  // 1. Check local voice phrase cache first to save rate limits
  const cachedEntry = await db.findVoiceCacheEntry(text);
  if (cachedEntry) {
    const products = await db.getProducts();
    const resolvedProduct = products.find(p => p.id === cachedEntry.product_id);
    if (resolvedProduct) {
      return {
        action: cachedEntry.action,
        productName: resolvedProduct.display_name,
        quantity: cachedEntry.quantity,
        unit: cachedEntry.unit,
        rawText: text,
        confidence: 'HIGH',
        resolvedProduct,
        resolvedByAI: false
      };
    }
  }

  // 2. Run local parser first (inbuild offline detection)
  const localResult = await parseVoiceCommandLocal(text);
  if (localResult.confidence === 'HIGH' || localResult.action === 'PRINT_BILL') {
    return localResult;
  }

  const geminiKey = db.getSetting('gemini_api_key') || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
  const groqKey = db.getSetting('groq_api_key') || (import.meta as any).env?.VITE_GROQ_API_KEY || '';

  if (!geminiKey && !groqKey) {
    return localResult;
  }

  const products = await db.getProducts();
  const candidates = getFuzzyCandidates(text, products);

  const promptText = `You are an AI billing assistant for "Sai Ram Kirana" grocery store.
Parse the spoken command (can be in Telugu, Hindi, or English) and return a structured JSON response.

Here is a list of candidate products from our store catalog that matched the user's spoken words:
${JSON.stringify(candidates.map(p => ({ id: p.id, display_name: p.display_name, aliases: p.aliases })), null, 2)}

User Spoken Command: "${text}"

Rules:
1. Auto-detect if the user is speaking in Telugu (script or English letters like "rendu", "chakkera"), Hindi, or English.
2. Translate/map any regional numbers or quantities (e.g. "రెండు" = 2, "ara" = 0.5, "dhai sau" = 250) and units correctly.
   Specifically, translate regional weight/volume size terms to standard sizes matching candidate names:
   - "cheytak" / "chhatak" / "చేతక్" / "ఛటాక్" / "छटाक" must map to "50g" or "50 grams".
   - "adda pav" / "adha pav" / "అద్దపావు" / "ఆధా పావు" / "आधा पाव" must map to "125g" or "125 grams".
   - "thin pav" / "teen pav" / "తీన్ పావు" / "तीन पाव" must map to "750g" or "750 grams".
   - "dedh kilo" / "dedh ser" / "డేడ్ కిలో" / "डेढ़ किलो" must map to "1.5kg" or "1.5 kg".
   - "stullam" / "thulam" / "tola" / "తులం" / "तुला" must map to "10g" or "10 grams".
   - "sawa kilo" / "సవా కిలో" / "सवा किलो" must map to "1.25kg" or "1.25 kg".
   - "dhai kilo" / "రెండున్నర కిలో" / "ढाई किलो" must map to "2.5kg" or "2.5 kg".
   - "half kg" / "అర కేజీ" / "సగం కేజీ" / "ఆధా కిలో" / "హాఫ్ కేజీ" must map to "500g" or "500 grams".
   - "quarter kg" / "పావు కేజీ" / "पाव किलो" must map to "250g" or "250 grams".
   - "three quarter kg" / "ముప్పావు కేజీ" / "पौना किलो" must map to "750g" or "750 grams".
   - "half litre" / "అర లీటర్" / "హాఫ్ లీటర్" / "आधा लीटर" must map to "500ml" or "500 milliliters".
   - "quarter litre" / "పావు లీటర్" / "पाव लीटर" must map to "250ml" or "250 milliliters".
3. Map the spoken product name to the most appropriate candidate product from the list above.
4. If the product matches one of the candidate products, set "productName" to that product's exact display_name, and "resolvedProductId" to its id.
5. If the spoken product does not match any candidate product, set "productName" to a best-guess English name for the item, and set "resolvedProductId" to null.
6. If the user specifies both a quantity and a price, or specifies a price/rate (e.g. "change Kandi Pappu price to 100", or "Sugar 1 kg 40 rupees"), set "action" to "UPDATE_ITEM", set "price" to the spoken price numeric value, and set "quantity" and "unit" accordingly.
7. The JSON response must strictly conform to this schema:
{
  "action": "ADD_ITEM" | "REMOVE_ITEM" | "UPDATE_ITEM" | "PRINT_BILL" | "UNKNOWN",
  "productName": "exact display_name from candidates if matched, else best guess",
  "resolvedProductId": number | null,
  "quantity": number,
  "price": number | null,
  "unit": "Gram" | "KG" | "Litre" | "ML" | "Piece" | "Sheet" | "Bag" | "Pudha" | null
}
Respond ONLY with the JSON object. Do not include markdown code block formatting or any other text.`;

  // 2. Try Groq Llama first
  if (groqKey) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: 'You are an AI billing assistant for "Sai Ram Kirana" grocery store. Respond only with valid JSON.'
            },
            {
              role: 'user',
              content: promptText
            }
          ],
          response_format: { type: 'json_object' }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const jsonText = data.choices?.[0]?.message?.content;
        if (jsonText) {
          const parsed = JSON.parse(jsonText);
          let resolvedProduct: Product | undefined;
          if (parsed.resolvedProductId) {
            resolvedProduct = products.find(p => p.id === parsed.resolvedProductId);
          }
          if (!resolvedProduct && parsed.productName) {
            resolvedProduct = products.find(p =>
              p.display_name.toLowerCase() === parsed.productName.toLowerCase() ||
              p.aliases?.some(a => a.toLowerCase() === parsed.productName.toLowerCase()) ||
              p.display_name.toLowerCase().includes(parsed.productName.toLowerCase()) ||
              p.aliases?.some(a => a.toLowerCase().includes(parsed.productName.toLowerCase()))
            );
          }

          return {
            action: parsed.action || 'ADD_ITEM',
            productName: resolvedProduct ? resolvedProduct.display_name : parsed.productName,
            quantity: parsed.quantity !== undefined ? parsed.quantity : 1,
            price: parsed.price !== undefined ? parsed.price : undefined,
            unit: parsed.unit || (resolvedProduct?.units?.[0]?.unit_name || 'Piece'),
            rawText: text,
            confidence: resolvedProduct ? 'HIGH' : 'MEDIUM',
            resolvedProduct,
            resolvedByAI: true
          };
        }
      } else {
        console.warn(`Groq api returned error status: ${response.status}`);
      }
    } catch (err) {
      console.error('Groq AI parsing error:', err);
    }
  }

  if (geminiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (jsonText) {
          const parsed = JSON.parse(jsonText);
          let resolvedProduct: Product | undefined;
          if (parsed.resolvedProductId) {
            resolvedProduct = products.find(p => p.id === parsed.resolvedProductId);
          }
          if (!resolvedProduct && parsed.productName) {
            resolvedProduct = products.find(p =>
              p.display_name.toLowerCase() === parsed.productName.toLowerCase() ||
              p.aliases?.some(a => a.toLowerCase() === parsed.productName.toLowerCase()) ||
              p.display_name.toLowerCase().includes(parsed.productName.toLowerCase()) ||
              p.aliases?.some(a => a.toLowerCase().includes(parsed.productName.toLowerCase()))
            );
          }

          return {
            action: parsed.action || 'ADD_ITEM',
            productName: resolvedProduct ? resolvedProduct.display_name : parsed.productName,
            quantity: parsed.quantity !== undefined ? parsed.quantity : 1,
            price: parsed.price !== undefined ? parsed.price : undefined,
            unit: parsed.unit || (resolvedProduct?.units?.[0]?.unit_name || 'Piece'),
            rawText: text,
            confidence: resolvedProduct ? 'HIGH' : 'MEDIUM',
            resolvedProduct,
            resolvedByAI: true
          };
        }
      }
    } catch (err) {
      console.error('Gemini AI parsing error:', err);
    }
  }

  // Fallback to local parser results if all else fails
  return localResult;
}

// Helper: generates quantity-specific voice aliases for a product name (offline, no AI needed)
export function getLocalQuantityAliases(name: string): string[] {
  const aliases: string[] = [];
  const lower = name.toLowerCase();

  // Try to isolate the base product name by removing size/quantity terms
  const qtyPattern = /\b\d+(?:\.\d+)?\s*(g|gram|grams|grm|grms|gm|gms|gramulu|గ్రాములు|kg|kilo|kilograms|kilos|కిలో|కేజీ|l|litre|litres|లీటర్|ml|milliliter|మిల్లీలీటర్)\b/gi;
  const fractionsPattern = /\b(1\/2|half|ara|pav|paavu|సగం|ఆధా|పావు)\s*(kg|kilo|kilograms|kilos|కిలో|కేజీ|l|litre|litres|లీటర్)\b/gi;

  let baseName = lower
    .replace(qtyPattern, '')
    .replace(fractionsPattern, '');

  // Strip traditional/regional terms (without \b for non-English to prevent boundary issues)
  const traditionalTerms = [
    'cheytak', 'chhatak', 'chatak', 'cheetak', 'cheetaak',
    'adda pav', 'adha pav', 'adda paav', 'adha paav', 'addapavu', 'adhapavu',
    'thin pav', 'teen pav', 'thin paav', 'teen paav', 'thinpav', 'teempav',
    'dedh kilo', 'ded kilo', 'dedh kg', 'ded kg', 'dedh ser', 'ded ser',
    'stullam', 'thulam', 'tola', 'tula',
    'sawa kilo', 'sava kilo', 'sawa kg', 'sava kg',
    'dhai kilo', 'dai kilo', 'dhai kg', 'dai kg',
    'paune do kilo', 'pone do kilo', 'paune do kg', 'pone do kg',
    // Telugu
    'చేతక్', 'ఛటాక్', 'చటాక్', 'అద్దపావు', 'ఆధా పావు', 'అరపావు', 'తీన్ పావు', 'తీన్పావు',
    'డేడ్ కిలో', 'డేడ్ కేజీ', 'తులం', 'తులా', 'తోలా', 'తోలం', 'సవా కిలో', 'సవా కేజీ', 'రెండున్నర కిలో', 'రెండున్నర కేజీ',
    // Hindi
    'छटाक', 'आधा पाव', 'अधा पाव', 'तीन पाव', 'डेढ़ किलो', 'डेढ़ केजी', 'तोलं', 'तौला', 'तुला',
    'सवा किलो', 'सवा केजी', 'ढाई किलो', 'ढाई केजी', 'पौने दो किलो', 'पौने दो केजी'
  ].sort((a, b) => b.length - a.length);

  for (const term of traditionalTerms) {
    const isEnglish = /^[a-zA-Z\s]+$/.test(term);
    const regex = isEnglish ? new RegExp(`\\b${term}\\b`, 'gi') : new RegExp(term, 'g');
    baseName = baseName.replace(regex, '');
  }

  baseName = baseName.replace(/\s+/g, ' ').trim();

  if (!baseName) {
    baseName = lower;
  }

  // Base name in Telugu for common brands
  let teluguBaseName = '';
  if (baseName.includes('tata salt')) {
    teluguBaseName = 'టాటా సాల్ట్';
  } else if (baseName.includes('freedom')) {
    teluguBaseName = 'ఫ్రీడం ఆయిల్';
  }

  // Get quantity variations
  const qtyVars: string[] = [];

  // 50g / Cheytak / Chhatak
  if (/\b50\s*(g|gram|grams|grm|grms|gm|gms|gramulu|గ్రాములు)\b/.test(lower) || lower.includes('cheytak') || lower.includes('chhatak') || lower.includes('chatak') || lower.includes('చేతక్') || lower.includes('ఛటాక్') || lower.includes('छटाक')) {
    qtyVars.push('50g', '50 grams', '50 gram', 'cheytak', 'chhatak', 'chatak', 'cheetak', 'చేతక్', 'ఛటాక్', 'छटाक');
  }
  // 125g / Adda Pav / Adha Pav
  else if (/\b125\s*(g|gram|grams|grm|grms|gm|gms|gramulu|గ్రాములు)\b/.test(lower) || lower.includes('adda pav') || lower.includes('adha pav') || lower.includes('adda paav') || lower.includes('adha paav') || lower.includes('addapavu') || lower.includes('adhapavu') || lower.includes('అద్దపావు') || lower.includes('ఆధా పావు') || lower.includes('ఆధా పావు') || lower.includes('आधा पाव')) {
    qtyVars.push('125g', '125 grams', '125 gram', 'adda pav', 'adha pav', 'adda paav', 'adha paav', 'addapavu', 'adhapavu', 'అద్దపావు', 'ఆధా పావు', 'आधा पाव');
  }
  // 250g
  else if (/\b250\s*(g|gram|grams|grm|grms|gm|gms|gramulu|గ్రాములు)\b/.test(lower) || lower.includes('pav') || lower.includes('పావు')) {
    qtyVars.push('250g', '250grms', '250 gram', '250 grams', 'pav kg', 'paavu kg', 'పావు కేజీ', 'పావు కిలో');
  }
  // 500g / half kg
  else if (/\b500\s*(g|gram|grams|grm|grms|gm|gms|gramulu|గ్రాములు)\b/.test(lower) || lower.includes('1/2') || lower.includes('half') || lower.includes('ara') || lower.includes('అర') || lower.includes('సగం') || lower.includes('आधा')) {
    qtyVars.push('500g', '500grms', '500 grams', '500 gram', 'half kg', '1/2 kg', '1/2kg', 'halfkg', 'ara kg', 'ara-kg', 'అర కేజీ', 'అర కిలో', 'సగం కేజీ', 'आधा किलो');
  }
  // 750g / three quarter kg / thin pav
  else if (/\b750\s*(g|gram|grams|grm|grms|gm|gms|gramulu|గ్రాములు)\b/.test(lower) || lower.includes('three quarter') || lower.includes('muppavu') || lower.includes('ముప్పావు') || lower.includes('पौना') || lower.includes('thin pav') || lower.includes('teen pav') || lower.includes('thin paav') || lower.includes('teen paav') || lower.includes('thinpav') || lower.includes('teempav') || lower.includes('తీన్ పావు') || lower.includes('తీన్పావు') || lower.includes('तीन पाव')) {
    qtyVars.push('750g', '750grms', '750 grams', '750 gram', 'three quarter kg', 'three quarters kg', 'muppavu kg', 'muppaavu kg', 'ముప్పావు కేజీ', 'తీన్ పావు', 'తీన్పావు', 'three quarter kilo', 'three quarters kilo', 'thin pav', 'teen pav', 'three quarter', 'पौना किलो', 'तीन पाव');
  }
  // 10g (Stullam / Thulam / Tola)
  else if (/\b10\s*(g|gram|grams|grm|grms|gm|gms|gramulu|గ్రాములు)\b/.test(lower) || lower.includes('stullam') || lower.includes('thulam') || lower.includes('tola') || lower.includes('tula') || lower.includes('తులం') || lower.includes('తులా') || lower.includes('తోలా') || lower.includes('తోలం') || lower.includes('तोलं') || lower.includes('तुला')) {
    qtyVars.push('10g', '10 grams', '10 gram', 'stullam', 'thulam', 'tola', 'tula', 'తులం', 'తులా', 'తోలా', 'తోలం', 'तोलं', 'तुला');
  }
  // 1kg
  else if (/\b1\s*(kg|kilo|kilograms|kilos|కిలో|కేజీ)\b/.test(lower) || lower.includes('one kg') || lower.includes('ఒక కేజీ')) {
    qtyVars.push('1kg', '1 kg', 'one kg', 'one kilo', 'kilo', 'కేజీ', 'కిలో', 'ఒక కేజీ', 'एक किलो');
  }
  // 1.25kg (Sawa Kilo)
  else if (/\b1\.25\s*(kg|kilo|kilograms|kilos|కిలో|కేజీ)\b/.test(lower) || lower.includes('sawa kilo') || lower.includes('sava kilo') || lower.includes('sawa kg') || lower.includes('sava kg') || lower.includes('సవా కిలో') || lower.includes('సవా కేజీ') || lower.includes('सवा किलो')) {
    qtyVars.push('1.25kg', '1.25 kg', 'sawa kilo', 'sava kilo', 'sawa kg', 'sava kg', 'సవా కిలో', 'సవా కేజీ', 'सवा किलो');
  }
  // 1.5kg (Dedh Kilo)
  else if (/\b1\.5\s*(kg|kilo|kilograms|kilos|కిలో|కేజీ)\b/.test(lower) || lower.includes('dedh kilo') || lower.includes('ded kilo') || lower.includes('dedh kg') || lower.includes('ded kg') || lower.includes('dedh ser') || lower.includes('ded ser') || lower.includes('డేడ్ కిలో') || lower.includes('డేడ్ కేజీ') || lower.includes('डेढ़ किलो') || lower.includes('okatinara') || lower.includes('ఒకటిన్నర')) {
    qtyVars.push('1.5kg', '1.5 kg', 'dedh kilo', 'ded kilo', 'dedh kg', 'ded kg', 'dedh ser', 'ded ser', 'డేడ్ కిలో', 'డేడ్ కేజీ', 'डेढ़ किलो', 'okatinara kg', 'ఒకటిన్నర కేజీ', 'एक किलो');
  }
  // 2kg
  else if (/\b2\s*(kg|kilo|kilograms|kilos|కిలో|కేజీ)\b/.test(lower) || lower.includes('two kg') || lower.includes('రెండు కేజీలు')) {
    qtyVars.push('2kg', '2 kg', 'two kg', 'రెండు కేజీలు', 'రెండు కిలోలు');
  }
  // 2.5kg (Dhai Kilo)
  else if (/\b2\.5\s*(kg|kilo|kilograms|kilos|à°•à°¿à°²à±‹|à°•à±‡à°œà±€)\b/.test(lower) || lower.includes('dhai kilo') || lower.includes('dai kilo') || lower.includes('dhai kg') || lower.includes('dai kg') || lower.includes('à°°à±†à°‚à°¡à±à°¨à±à°¨à°° à°•à°¿à°²à±‹') || lower.includes('à°°à±†à°‚à°¡à±à°¨à±à°¨à°° à°•à±‡à°œà±€') || lower.includes('à¤¢à¤¾à¤ˆ à¤•à¤¿à¤²à¥‹')) {
    qtyVars.push('2.5kg', '2.5 kg', 'dhai kilo', 'dai kilo', 'dhai kg', 'dai kg', 'à°°à±†à°‚à°¡à±à°¨à±à°¨à°° à°•à°¿à°²à±‹', 'à°°à±†à°‚à°¡à±à°¨à±à°¨à°° à°•à±‡à°œà±€', 'à¤¢à¤¾à¤ˆ à¤•à¤¿à¤²à¥‹');
  }
  // 5kg
  else if (/\b5\s*(kg|kilo|kilograms|kilos|à°•à°¿à°²à±‹|à°•à±‡à°œà±€)\b/.test(lower) || lower.includes('five kg') || lower.includes('à°à°¦à± à°•à±‡à°œà±€à°²à±')) {
    qtyVars.push('5kg', '5 kg', 'five kg', 'à°à°¦à± à°•à±‡à°œà±€à°²à±', 'à°à°¦à± à°•à°¿à°²à±‹à°²à±');
  }
  // 1L
  else if (/\b1\s*(l|litre|litres|à°²à±€à°Ÿà°°à±)\b/.test(lower)) {
    qtyVars.push('1l', '1 litre', 'one litre', 'à°²à±€à°Ÿà°°à±', 'à°’à°• à°²à±€à°Ÿà°°à±');
  }
  // 2L
  else if (/\b2\s*(l|litre|litres|à°²à±€à°Ÿà°°à±)\b/.test(lower)) {
    qtyVars.push('2l', '2 litre', 'two litres', 'à°°à±†à°‚à°¡à± à°²à±€à°Ÿà°°à±à°²à±');
  }
  // 5L
  else if (/\b5\s*(l|litre|litres|à°²à±€à°Ÿà°°à±)\b/.test(lower)) {
    qtyVars.push('5l', '5 litre', 'five litres', 'à°à°¦à± à°²à±€à°Ÿà°°à±à°²à±');
  }

  // Build per-brand multilingual name variants to combine with size
  // Build per-brand multilingual name variants to combine with size
  const brandVariants: string[] = [baseName];
  const teluguBrandVariants: string[] = teluguBaseName ? [teluguBaseName] : [];

  if (baseName.includes('tata salt')) {
    brandVariants.push('tata uppu', 'tata namak', 'tata lavan');
    teluguBrandVariants.push('టాటా ఉప్పు', 'టాటా నమక్');
  } else if (baseName.includes('aashirvaad') || baseName.includes('ashirvaad')) {
    brandVariants.push('aashirvaad atta');
    teluguBrandVariants.push('ఆశీర్వాద్ పిండి');
  } else if (baseName.includes('fortune') && baseName.includes('oil')) {
    brandVariants.push('fortune oil');
    teluguBrandVariants.push('ఫార్చ్యూన్ నూనె');
  } else if (baseName.includes('freedom') && baseName.includes('oil')) {
    brandVariants.push('freedom oil', 'freedom nune');
    teluguBrandVariants.push('ఫ్రీడం నూనె');
  }

  if (qtyVars.length > 0) {
    // Size IS in the name: EVERY alias must include the size.
    // NEVER push a bare brand name when size variants exist — it would collide
    // with other size variants of the same brand (e.g. Tata Salt 500g vs 1kg).
    qtyVars.forEach(qv => {
      brandVariants.forEach(bv => aliases.push(`${bv} ${qv}`));
      teluguBrandVariants.forEach(tv => aliases.push(`${tv} ${qv}`));
    });
  } else {
    // No size found → safe to push bare brand aliases (no ambiguity)
    brandVariants.forEach(bv => aliases.push(bv));
    teluguBrandVariants.forEach(tv => aliases.push(tv));
  }

  return aliases;
}

// AI product alias generation service
export async function generateProductAliases(productName: string): Promise<string[]> {
  const geminiKey = db.getSetting('gemini_api_key') || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
  const groqKey = db.getSetting('groq_api_key') || (import.meta as any).env?.VITE_GROQ_API_KEY || '';

  const words = productName.toLowerCase().split(/\s+/);
  let defaultAliases = words
    .map(w => w.trim().replace(/[^a-zA-Z0-9\u0c00-\u0c7f\u0900-\u097f]/g, ''))
    .filter(w => w.length > 2);

  // If the product is multi-word (branded/variant), filter out single generic words to prevent collisions
  if (words.length > 1) {
    const GENERIC_STOPWORDS = new Set([
      'salt', 'namak', 'uppu', 'ఉప్పు', 'సాల్ట్', 'నమక్',
      'oil', 'tel', 'nune', 'నూనె', 'तेल',
      'dal', 'dhal', 'pappu', 'పప్పు',
      'water', 'neeru', 'paani', 'पानी',
      'soap', 'sabbu', 'sabun', 'साबुन',
      'shampoo', 'శాంపు', 'शैम्पू', 'shampoos',
      'rice', 'biyyam', 'chawal', 'బియ్యం', 'चावल',
      'sugar', 'chakkera', 'cheeni', 'చక్కెర', 'చక్కర', 'चीनी',
      'noodles', 'నూడుల్స్', 'नुडल्स',
      'drink', 'drinks', 'cooldrink', 'cool drink', 'cool-drink'
    ]);
    defaultAliases = defaultAliases.filter(w => !GENERIC_STOPWORDS.has(w));
  }

  // Add local offline quantity aliases as fallback / default aliases to guarantee voice lookup success
  const localQtyAliases = getLocalQuantityAliases(productName);
  defaultAliases = Array.from(new Set([...defaultAliases, ...localQtyAliases]));

  if (!geminiKey && !groqKey) {
    return defaultAliases;
  }

  try {
    const prompt = `You are a product database helper.
Generate a list of regional voice search aliases (Telugu script, transliterated Telugu, Hindi script, transliterated Hindi, and English variations/synonyms) for the product display name: "${productName}".
Rules:
1. Include common names in Telugu script (e.g. for Sugar -> "చక్కెర", for Oil -> "నూనె", for Dal -> "పప్పు").
2. Include transliterated Telugu (e.g. "chakkera", "nune", "pappu").
3. Include common names in Hindi script (e.g. for Sugar -> "चीनी", for Oil -> "तेल", for Dal -> "दाल").
4. Include transliterated Hindi (e.g. "cheeni", "tel").
5. Do NOT translate brand names literally to Telugu/Hindi. Keep brand names as English or phonetically transliterated (e.g. "Freedom Oil" -> "Freedom Oil" / "ఫ్రీడం ఆయిల్" / "ఫ్రీడం నూనె").
6. STRICT RULE: For branded or specific products (e.g. 'Tata Salt', 'Freedom Sunflower Oil', 'Maggi Noodles'), do NOT generate bare generic aliases (like 'salt', 'namak', 'uppu', 'ఉప్పు', 'సాల్ట్', 'నమక్', 'oil', 'tel', 'నూనె', 'noodles', 'dal', 'pappu'). Every alias must include the brand name or distinct variant (e.g., 'tata salt', 'tata namak', 'freedom oil', 'maggi noodles') to avoid conflict with other items in the store catalog. Bare generic aliases are only allowed if the product itself is a completely unbranded commodity (e.g. loose 'Sugar').
7. If the product name contains a weight/volume size (e.g., '500g', '125g', '750g', '1.5kg', '10g', '1kg'), every alias must include that size or its bilingual/regional equivalents (e.g., for 500g, include '500g', 'half kg'; for 125g, include '125g', 'adda pav'; for 750g, include '750g', 'thin pav', 'teen pav'; for 1.5kg, include '1.5kg', 'dedh kilo'; for 10g, include '10g', 'stullam', 'thulam', 'tola').
8. CRITICAL: Always include the common Hindi BAZAAR/MARKET colloquial names that kirana store shoppers actually say in daily speech. Think: what short, informal word would a customer say at a kirana counter? Examples by product type:
   - Tamarind/Chintapandu -> imly, imli, emli (most important!)
   - Turmeric/Pasupu -> haldi
   - Red Chilli -> mirchi, lal mirch
   - Coriander seeds -> dhaniya
   - Cumin/Jeelakarra -> jeera
   - Fenugreek/Menthulu -> methi
   - Mustard/Avalu -> rai, sarson
   - Coconut/Kobbari -> nariyal
   - Onion/Ullipaya -> pyaz, pyaaz
   - Garlic/Vellulli -> lahsun, lasun
   - Ginger/Allam -> adrak
   - Jaggery/Bellam -> gur, gud
   - Groundnuts/Pallilu -> moongfali
   Apply this to ANY product - always include informal bazaar/market Hindi short forms.
Respond ONLY with a JSON array of strings, e.g. ["alias1", "alias2"]. No markdown, no explanation.`;

    if (groqKey) {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'You are a product alias generator. Respond only with a valid JSON array of strings.' },
            { role: 'user', content: prompt }
          ],

          response_format: { type: 'json_object' }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const jsonText = data.choices?.[0]?.message?.content;
        if (jsonText) {
          const parsed = JSON.parse(jsonText);
          const aiAliases: string[] = Array.isArray(parsed) ? parsed : (parsed.aliases || parsed.data || []);
          if (aiAliases.length > 0) {
            return Array.from(new Set([...aiAliases, ...defaultAliases]));
          }
        }
      }
    }

    if (geminiKey) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (jsonText) {
          const parsed = JSON.parse(jsonText);
          const aiAliases: string[] = Array.isArray(parsed) ? parsed : (parsed.aliases || parsed.data || []);
          if (aiAliases.length > 0) {
            return Array.from(new Set([...aiAliases, ...defaultAliases]));
          }
        }
      }
    }
  } catch (err) {
    console.error('AI alias generation error:', err);
  }

  return defaultAliases;
}

// Type for parsed product creation commands
export type ParsedProductCreation = {
  display_name: string;
  category: 'weight' | 'volume' | 'cartoon' | 'bag' | 'tray' | 'sheet';
  unit: string;
  quantity: number;
  retail_price: number;
  wholesale_price: number;
  aliases: string[];
  overrides: { unit_name: string; price: number }[];
  unit_conversions: { parent_unit: string; child_unit: string; conversion_factor: number }[];
};

export function parseProductCreationVoiceCommandLocal(text: string): ParsedProductCreation {
  const cleanText = text.toLowerCase().trim();
  let processedText = cleanText;

  // Normalize regional weight/volume size descriptions first (e.g. half kg -> 500g)
  const normalizationKeys = Object.keys(REGIONAL_SIZE_NORMALIZATIONS).sort((a, b) => b.length - a.length);
  for (const k of normalizationKeys) {
    const isEnglish = /^[a-zA-Z\s]+$/.test(k);
    const regex = isEnglish ? new RegExp(`\\b${k}\\b`, 'gi') : new RegExp(k, 'g');
    processedText = processedText.replace(regex, ` ${REGIONAL_SIZE_NORMALIZATIONS[k]} `).trim();
  }

  const wordToNumberMap: Record<string, number> = {
    ...TELUGU_NUMBERS,
    ...HINDI_NUMBERS,
    ...ENGLISH_NUMBERS,
  };

  const sortedWords = Object.keys(wordToNumberMap).sort((a, b) => b.length - a.length);
  for (const word of sortedWords) {
    const isEnglish = /^[a-z\s]+$/i.test(word);
    const regex = isEnglish ? new RegExp(`\\b${word}\\b`, 'g') : new RegExp(word, 'g');
    processedText = processedText.replace(regex, String(wordToNumberMap[word]));
  }

  // Detect weight/volume size pattern first to avoid pricing pollution
  let detectedSizeUnit: string | undefined;

  const sizePatternRegex = /(\d+(?:\.\d+)?)\s*(g|gram|grams|grm|grms|gm|gms|gramulu|gramula|gramullu|గ్రాములు|గ్రామ్|గ్రాం|కిలో|కేజీ|కిలోలు|కేజీలు|కెజి|కెజీ|కిలోల|కేజీల|kg|kilo|kilograms|kilos|l|litre|litres|లీటర్|లీటర్లు|లీటరు|ml|milliliter|milliliters|మిల్లీలీటర్|ఎంఎల్)/gi;
  const sizeMatches = [...processedText.matchAll(sizePatternRegex)];
  
  if (sizeMatches.length > 0) {
    const matchedUnitRaw = sizeMatches[0][2].toLowerCase();
    
    // Map matchedUnitRaw to standard unit
    if (['g', 'gm', 'gms', 'grm', 'grms', 'gram', 'grams', 'gramulu', 'gramula', 'gramullu', 'గ్రాములు', 'గ్రామ్', 'గ్రాం'].some(u => matchedUnitRaw === u)) {
      detectedSizeUnit = 'Gram';
    } else if (['kg', 'kilo', 'kilograms', 'kilos', 'కేజీ', 'కిలో', 'కిలోలు', 'కెజి', 'కెజీ', 'కిలోల', 'కేజీల'].some(u => matchedUnitRaw === u)) {
      detectedSizeUnit = 'KG';
    } else if (['ml', 'milliliter', 'milliliters', 'మిల్లీలీటర్', 'ఎంఎల్'].some(u => matchedUnitRaw === u)) {
      detectedSizeUnit = 'ML';
    } else if (['l', 'litre', 'litres', 'లీటర్', 'లీటర్లు', 'లీటరు'].some(u => matchedUnitRaw === u)) {
      detectedSizeUnit = 'Litre';
    }
  }

  // 1. Detect category
  let category: ParsedProductCreation['category'] = 'cartoon';

  const packagingRegex = /\b(packet|packets|pack|packs|pudha|pudhas|puda|pudas|pooda|poodas|box|boxes|carton|cartons|cartoon|cartoons|bag|bags|tray|trays|sheet|sheets|piece|pieces|ピーస్|ピーసులు|ప్యాకెట్|ప్యాకెట్లు|డబ్బా|బాక్స్|బస్తా|బస్తాలు|ట్రే|షీట్)\b/;
  const hasPackaging = packagingRegex.test(processedText);

  if (hasPackaging) {
    if (processedText.includes('carton') || processedText.includes('cartoon') || processedText.includes('కార్టూన్') || processedText.includes('कार्टन')) {
      category = 'cartoon';
    } else if (processedText.includes('bag') || processedText.includes('సంచి') || processedText.includes('బస్తా') || processedText.includes('बोरी')) {
      category = 'bag';
    } else if (processedText.includes('tray') || processedText.includes('ట్రే') || processedText.includes('ट्रे')) {
      category = 'tray';
    } else if (processedText.includes('sheet') || processedText.includes('షీట్') || processedText.includes('शीट')) {
      category = 'sheet';
    } else {
      category = 'cartoon';
    }
  } else {
    // If no packaging term is present, check weight/volume first
    if (processedText.includes('weight') || processedText.includes('బరువు') || processedText.includes('वजन') || detectedSizeUnit === 'Gram' || detectedSizeUnit === 'KG') {
      category = 'weight';
    } else if (processedText.includes('volume') || processedText.includes('వోల్యూమ్') || processedText.includes('आयतन') || detectedSizeUnit === 'ML' || detectedSizeUnit === 'Litre') {
      category = 'volume';
    } else {
      category = 'cartoon';
    }
  }

  // 2. Detect unit
  let unit = 'Piece';
  if (category === 'weight') {
    unit = detectedSizeUnit === 'Gram' ? 'Gram' : 'KG';
  } else if (category === 'volume') {
    unit = detectedSizeUnit === 'ML' ? 'ML' : 'Litre';
  } else if (category === 'cartoon') {
    if (processedText.includes('pudha') || processedText.includes('puda') || processedText.includes('pooda') || processedText.includes('పుడ')) {
      unit = 'Pudha';
    } else if (processedText.includes('piece') || processedText.includes('pieces') || processedText.includes('ピース') || processedText.includes('పీస్') || processedText.includes('పీసులు')) {
      unit = 'Piece';
    } else if (processedText.includes('carton') || processedText.includes('cartoon') || processedText.includes('కార్టూన్') || processedText.includes('कार्टन')) {
      unit = 'Carton';
    } else if (processedText.includes('packet') || processedText.includes('packets') || processedText.includes('pack') || processedText.includes('packs') || processedText.includes('box') || processedText.includes('boxes')) {
      unit = 'Pudha';
    } else {
      unit = 'Piece';
    }
  } else if (category === 'bag') {
    unit = 'Bag';
  } else if (category === 'tray') {
    unit = 'Tray';
  } else if (category === 'sheet') {
    unit = 'Sheet';
  }

  // 3. Extract quantity and prices
  let strippedText = processedText;
  
  // Strip standalone unit keywords so numbers can be parsed cleanly
  const activeUnitRegexes = [
    { regex: /\b(packet|packets|pack|packs|pudha|pudhas|puda|pudas|pooda|poodas)\b/gi, unit: 'Pudha' },
    { regex: /\b(piece|pieces|pc|pcs)\b/gi, unit: 'Piece' },
    { regex: /\b(sheet|sheets)\b/gi, unit: 'Sheet' },
    { regex: /\b(carton|cartons|cartoon|cartoons)\b/gi, unit: 'Carton' },
    { regex: /\b(bag|bags)\b/gi, unit: 'Bag' },
    { regex: /\b(tray|trays)\b/gi, unit: 'Tray' },
    { regex: /(?:\b|(?<=\d))(kg|kilo|kilograms|kilos|కేజీ|కిలో|కిలోలు)\b/gi, unit: 'KG' },
    { regex: /(?:\b|(?<=\d))(g|gm|gms|grm|grms|gram|grams|gramulu|gramula|gramullu|గ్రాములు|గ్రామ్|గ్రాం)\b/gi, unit: 'Gram' },
    { regex: /(?:\b|(?<=\d))(litre|litres|l|లీటర్|లీటర్లు)\b/gi, unit: 'Litre' }
  ];

  for (const { regex } of activeUnitRegexes) {
    strippedText = strippedText.replace(regex, ' ');
  }

  // Parse price keywords
  const priceKeywords = ['retail', 'mrp', 'price', 'rate', 'cost', 'rs', 'rupees', 'రిటైల్', 'ధర', 'రేటు', 'रेट', 'भाव'];
  const wholesaleKeywords = ['wholesale', 'whole sale', 'buying', 'purchase', 'హోల్సేల్', 'थोक'];

  const numbers = (strippedText.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  let quantity = 1;
  let retail_price = 0;
  let wholesale_price = 0;

  const hasWholesale = wholesaleKeywords.some(k => processedText.includes(k));

  if (numbers.length >= 3) {
    quantity = numbers[0];
    retail_price = numbers[1];
    wholesale_price = numbers[2];
  } else if (numbers.length === 2) {
    if (hasWholesale) {
      retail_price = numbers[0];
      wholesale_price = numbers[1];
    } else {
      retail_price = numbers[0];
      wholesale_price = numbers[1];
    }
  } else if (numbers.length === 1) {
    retail_price = numbers[0];
  }

  const hasPriceKeyword = priceKeywords.some(k => processedText.includes(k));
  if (!hasPriceKeyword && numbers.length === 1) {
    retail_price = numbers[0];
  }

  if (wholesale_price === 0 && retail_price > 0) {
    wholesale_price = Math.round(retail_price * 0.95);
  }

  // 4. Parse unit conversions (e.g. 1 sheet contains 14 pieces)
  const conversions: { parent_unit: string; child_unit: string; conversion_factor: number }[] = [];
  const conversionRegex = /(\d+(?:\.\d+)?)\s*(sheet|tray|carton|cartoon|bag|box|packet|pudha)\s+(?:contains?|has|lo|లో|มี)\s+(\d+(?:\.\d+)?)\s*(piece|pieces|pc|pcs|single|singles|egg|eggs|ピーస్|పీసులు)\b/i;
  const convMatch = conversionRegex.exec(processedText);
  if (convMatch) {
    const parentUnit = UNIT_MAP[convMatch[2].toLowerCase()] || convMatch[2];
    const childUnit = UNIT_MAP[convMatch[4].toLowerCase()] || convMatch[4];
    conversions.push({ parent_unit: parentUnit, child_unit: childUnit, conversion_factor: parseFloat(convMatch[3]) });
  }

  // 5. Parse override sub-units
  const overrides: { unit_name: string; price: number }[] = [];
  const overrideRegex = /(\d+(?:\.\d+)?)\s*(g|gm|gms|grm|grms|gram|grams|gramulu|gramula|gramullu|ml|kg|l|litre|packet|packets|pudha|pudhas|puda|pudas|pooda|poodas|piece|pieces|sheet|sheets|tray|trays|bag|bags|carton|cartons|box|boxes|గ్రాములు|కేజీ|పుడ|పుడలు)\s*[^0-9\n]*\s*(\d+(?:\.\d+)?)/g;
  let match;
  while ((match = overrideRegex.exec(processedText)) !== null) {
    const oQty = parseFloat(match[1]);
    const oUnit = match[2];
    const oPrice = parseFloat(match[3]);

    let oUnitName = '';
    if (['g', 'gm', 'gms', 'grm', 'grms', 'gram', 'grams', 'gramulu|gramula|gramullu', 'గ్రాములు'].some(u => oUnit.includes(u))) {
      oUnitName = `${oQty}g`;
    } else if (['ml', 'మిల్లీలీటర్'].some(u => oUnit.includes(u))) {
      oUnitName = `${oQty}ml`;
    } else if (['kg', 'kilo', 'కేజీ', 'కిలో'].some(u => oUnit.includes(u))) {
      oUnitName = `${oQty}kg`;
    } else if (['l', 'litre', 'లీటర్'].some(u => oUnit.includes(u))) {
      oUnitName = `${oQty}L`;
    } else if (['pudha', 'pudhas', 'puda', 'pudas', 'pooda', 'poodas', 'పుడ', 'పుడలు'].some(u => oUnit.includes(u))) {
      oUnitName = `${oQty} Pudha`;
    } else {
      oUnitName = `${oQty} ${oUnit}`;
    }

    if (oQty === quantity && (oUnitName.toLowerCase() === unit.toLowerCase() || (unit === 'KG' && oUnitName === '1kg') || (unit === 'Litre' && oUnitName === '1L'))) {
      continue;
    }

    overrides.push({
      unit_name: oUnitName,
      price: oPrice
    });
  }

  // 6. Clean processedText to extract display name
  let nameStr = processedText;

  const filterTerms = [
    'retail', 'wholesale', 'whole sale', 'price', 'rate', 'cost',
    'weight', 'volume', 'carton', 'cartoon', 'bag', 'tray', 'sheet', 'box', 'pack', 'packet', 'pudha', 'puda', 'pooda', 'pudhas', 'pudas', 'poodas', 'format',
    'kg', 'kilo', 'kilograms', 'gram', 'grams', 'gramulu', 'gramula', 'gramullu', 'litre', 'litres', 'ml', 'mls', 'piece', 'pieces',
    'రిటైల్', 'హోల్సేల్', 'ధర', 'రేటు', 'బరువు', 'కార్టూన్', 'సంచి', 'బస్తా', 'ట్రే', 'షీట్', 'బాక్స్', 'ప్యాకెట్', 'పుడ', 'పుడలు', 'పీస్',
    'ఒకటి', 'ఒక', 'రెండు', 'మూడు', 'నాలుగు', 'ఐదు', 'ఆరు', 'ఏడు', 'ఎనిమిdi', 'तొమ్మిది', 'పది',
    'okati', 'oka', 'rendu', 'moodu', 'mudu', 'nalugu', 'aidu', 'aaru', 'yedu', 'enimidi', 'tommidi', 'padi', 'yabhai', 'nalabhai', 'aravai',
    'is', 'for', 'rupees', 'rupee', 'rs', 'price is', 'rate is', 'quantity', 'qty', 'unit', 'contains', 'or', 'and', 'with', 'units', 'factor'
  ];

  if (category !== 'weight' && category !== 'volume') {
    filterTerms.forEach(term => {
      if (['kg', 'g', 'gram', 'grams', 'ml', 'l', 'litre'].includes(term)) return;
      if (/^[a-z\s]+$/i.test(term)) {
        const reg = new RegExp(`\\b${term}\\b`, 'g');
        nameStr = nameStr.replace(reg, ' ');
      } else {
        const reg = new RegExp(term, 'g');
        nameStr = nameStr.replace(reg, ' ');
      }
    });
  } else {
    nameStr = nameStr.replace(/\b\d+(?:\.\d+)?\b/g, ' ');
    filterTerms.forEach(term => {
      if (/^[a-z\s]+$/i.test(term)) {
        const reg = new RegExp(`\\b${term}\\b`, 'g');
        nameStr = nameStr.replace(reg, ' ');
      } else {
        const reg = new RegExp(term, 'g');
        nameStr = nameStr.replace(reg, ' ');
      }
    });
  }

  nameStr = nameStr.replace(/\s+/g, ' ').trim();
  if (!nameStr) {
    nameStr = 'Unassigned Product';
  }

  let display_name = nameStr
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  // Append size/quantity if not already present in the name
  const hasQuantityInName = /\b\d+\s*(?:g|gram|grams|grm|grms|gm|gms|kg|kilo|kilogram|kilograms|l|litre|litres|ml|milliliter|milliliters|pc|pcs|piece|pieces|sheet|sheets)\b/i.test(display_name);
  if (!hasQuantityInName) {
    if (category === 'weight') {
      if (unit === 'KG') {
        if (quantity === 1) {
          display_name = display_name + ' 1kg';
        } else if (quantity === 0.5) {
          display_name = display_name + ' 500g';
        } else if (quantity === 0.25) {
          display_name = display_name + ' 250g';
        } else if (quantity === 0.1) {
          display_name = display_name + ' 100g';
        } else {
          display_name = display_name + ` ${quantity}kg`;
        }
      } else if (unit === 'Gram') {
        display_name = display_name + ` ${quantity}g`;
      }
    } else if (category === 'volume') {
      if (unit === 'Litre') {
        if (quantity === 1) {
          display_name = display_name + ' 1L';
        } else if (quantity === 0.5) {
          display_name = display_name + ' 500ml';
        } else if (quantity === 0.25) {
          display_name = display_name + ' 250ml';
        } else if (quantity === 0.1) {
          display_name = display_name + ' 100ml';
        } else {
          display_name = display_name + ` ${quantity}L`;
        }
      } else if (unit === 'ML') {
        display_name = display_name + ` ${quantity}ml`;
      }
    }
  }

  const baseAliases = display_name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const qtyAliases = getLocalQuantityAliases(display_name);
  const aliases = Array.from(new Set([...baseAliases, ...qtyAliases]));

  return {
    display_name,
    category,
    unit,
    quantity,
    retail_price,
    wholesale_price,
    aliases,
    overrides,
    unit_conversions: conversions
  };
}

export async function parseProductCreationVoiceCommand(text: string): Promise<ParsedProductCreation> {
  const localResult = parseProductCreationVoiceCommandLocal(text);

  const geminiKey = db.getSetting('gemini_api_key') || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
  const groqKey = db.getSetting('groq_api_key') || (import.meta as any).env?.VITE_GROQ_API_KEY || '';

  if (!geminiKey && !groqKey) {
    return localResult;
  }

  const promptText = `You are an AI assistant for a Kirana shop billing/inventory system.
Your task is to parse a spoken or written command describing a product registration/creation and convert it into a structured JSON object.
The input command can be in Telugu (native script or transliterated English text), Hindi, or English.
For example, Telugu numbers: "రెండు వందల యాభై" / "rendu vandala yabai" (250), "యాభై" / "yabhai" (50), "నలభై" / "nalabhai" (40), "అరవై" / "aravai" (60).

You must categorize the product into one of these 6 categories:
1. "weight" (for products sold by weight, e.g., grains, dal, sugar, salt, flour, spices, tea/coffee, fruits/vegetables)
2. "volume" (for products sold by volume, e.g., oils, ghee, beverages, liquids)
3. "cartoon" (for products sold in cartons/cases)
4. "bag" (for products sold in large bags/sacks, e.g., 25kg rice bags)
5. "tray" (for products sold in trays, e.g., eggs tray)
7. "sheet" (for products sold in sheets, e.g., shampoo sheet, tablet sheet)

Rules:
1. Detect display name, category, unit, quantity (default 1), retail price, wholesale price, and optional sub-unit overrides or unit conversions.
2. For "weight" products, the default unit is typically "KG" or "Gram" (default quantity: 1). If the user mentions subdivisions, e.g., "250 grams price is 12" when the product is 1 kg, add that to the "overrides" list.
3. For "volume" products, the default unit is typically "Litre" or "ML" (default quantity: 1).
4. If a conversion factor is mentioned (e.g. 1 sheet contains 14 pieces, or 1 tray contains 30 single eggs), add it to "unit_conversions" (e.g., parent_unit: "Sheet", child_unit: "Piece", conversion_factor: 14).
5. Produce a list of search aliases (like Telugu script, Hindi script, and synonyms) for the product. If the product name contains a weight/volume size (e.g., '500g', '125g', '750g', '1.5kg', '10g', '1kg'), every generated voice alias must include that size or its bilingual/regional equivalents (e.g., for 500g, include '500g', 'half kg', 'అర కేజీ'; for 125g, include '125g', 'adda pav', 'అద్దపావు', 'आधा पाव'; for 750g, include '750g', 'thin pav', 'teen pav', 'తీన్ పావు'; for 1.5kg, include '1.5kg', 'dedh kilo', 'డేడ్ కిలో'; for 10g, include '10g', 'stullam', 'thulam', 'tola', 'తులం').
6. CRITICAL CATEGORIZATION RULE: Distinguish between generic loose weight/volume commodities (e.g., loose sugar, kandi pappu) and pre-packaged/branded products sold in packets, packs, bottles, boxes, bags, cartons, trays, or sheets (e.g. "Tata Salt 500g packet", "Freedom Sunflower Oil 1L packet").
- Generic loose items must be categorized as "weight" or "volume" respectively.
- Pre-packaged branded items must be categorized under their packaging category (e.g., "cartoon" for cartons/packets, "bag" for bags) with the unit set to the packaging unit (e.g. "Carton", "Bag", "Pudha") and transaction quantity representing the count of packages (default 1). The display name should retain the weight/volume specification (e.g., "Tata Salt 500g", "Freedom Sunflower Oil 1L").
7. STRICT COLLISION PREVENTION RULE: If there are multiple sizes of the same branded product (e.g. 'Tata Salt 1kg' and 'Tata Salt 500g'), only the standard default size (usually 1kg or 1L) may have the bare brand name alias (e.g. 'tata salt'). Smaller or non-standard sizes MUST include their specific quantity or regional equivalents (e.g. 'tata salt 500g', 'tata salt half kg') in every alias, and must NOT have the bare brand name alias (e.g., do NOT have 'tata salt' or 'టాటా సాల్ట్' as an alias for the 500g version, to prevent voice lookup collision).
8. The JSON response must strictly conform to this schema:
{
  "display_name": "Product name with packaging if applicable, e.g., 'Tata Salt 1kg'",
  "category": "weight" | "volume" | "cartoon" | "bag" | "tray" | "sheet",
  "unit": "e.g., 'KG' or 'Gram' or 'Litre' or 'ML' or 'Piece' or 'Tray' or 'Sheet' or 'Carton' or 'Bag' or 'Pudha'",
  "quantity": number,
  "retail_price": number,
  "wholesale_price": number,
  "aliases": ["alias1", "alias2", ...],
  "overrides": [{"unit_name": "e.g. 500g", "price": number}],
  "unit_conversions": [{"parent_unit": string, "child_unit": string, "conversion_factor": number}]
}

Spoken Command: "${text}"

Respond ONLY with the JSON object. Do not include markdown code block formatting or any other text.`;

  if (groqKey) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'You are a structured parser assistant. Respond only with valid JSON.' },
            { role: 'user', content: promptText }
          ],
          response_format: { type: 'json_object' }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const jsonText = data.choices?.[0]?.message?.content;
        if (jsonText) {
          const parsed = JSON.parse(jsonText);
          return {
            display_name: parsed.display_name || localResult.display_name,
            category: parsed.category || localResult.category,
            unit: parsed.unit || localResult.unit,
            quantity: parsed.quantity !== undefined ? parsed.quantity : localResult.quantity,
            retail_price: parsed.retail_price !== undefined ? parsed.retail_price : localResult.retail_price,
            wholesale_price: parsed.wholesale_price !== undefined ? parsed.wholesale_price : localResult.wholesale_price,
            aliases: parsed.aliases || localResult.aliases,
            overrides: parsed.overrides || localResult.overrides,
            unit_conversions: parsed.unit_conversions || localResult.unit_conversions
          };
        }
      }
    } catch (err) {
      console.error('Groq AI product creation parsing error:', err);
    }
  }

  if (geminiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (jsonText) {
          const parsed = JSON.parse(jsonText);
          return {
            display_name: parsed.display_name || localResult.display_name,
            category: parsed.category || localResult.category,
            unit: parsed.unit || localResult.unit,
            quantity: parsed.quantity !== undefined ? parsed.quantity : localResult.quantity,
            retail_price: parsed.retail_price !== undefined ? parsed.retail_price : localResult.retail_price,
            wholesale_price: parsed.wholesale_price !== undefined ? parsed.wholesale_price : localResult.wholesale_price,
            aliases: parsed.aliases || localResult.aliases,
            overrides: parsed.overrides || localResult.overrides,
            unit_conversions: parsed.unit_conversions || localResult.unit_conversions
          };
        }
      }
    } catch (err) {
      console.error('Gemini AI product creation parsing error:', err);
    }
  }

  return localResult;
}

// ----------------------------------------------------
// KHATA VOICE LEDGER COMMAND SYSTEM
// ----------------------------------------------------

const KHATA_NUMBERS: Record<string, number> = {
  // Telugu
  'వంద': 100, 'రెండు వందలు': 200, 'ఐదు వందలు': 500,
  'వెయ్యి': 1000, 'వేయి': 1000, 'వేలు': 1000, 'రెండు వేలు': 2000, 'ఐదు వేలు': 5000, 'పది వేలు': 10000,
  'veyyi': 1000, 'veyi': 1000, 'velu': 1000, 'rendu velu': 2000, 'aidu velu': 5000, 'padi velu': 10000,
  'vanda': 100,
  // Hindi
  'सौ': 100, 'दो सौ': 200, 'पाँच सौ': 500, 'हजार': 1000, 'हज़ार': 1000, 'दो हजार': 2000, 'पाँच हजार': 5000, 'दस हजार': 10000,
  'sau': 100, 'hazar': 1000, 'hazaar': 1000, 'do hazar': 2000, 'paanch hazar': 5000, 'das hazar': 10000,
  // English
  'hundred': 100, 'thousand': 1000, 'housand': 1000, 'lakh': 100000,
  'one hundred': 100, 'two hundred': 200, 'five hundred': 500, 'one thousand': 1000, 'two thousand': 2000, 'five thousand': 5000, 'ten thousand': 10000
};

export interface ParsedKhataCommand {
  action: 'INQUIRY' | 'CREDIT' | 'PAYMENT' | 'UNKNOWN';
  customerId: number | null;
  customerName: string;
  amount?: number;
  rawText: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export async function parseKhataVoiceCommandLocal(text: string, customers: Customer[]): Promise<ParsedKhataCommand> {
  const cleanText = text.toLowerCase().trim();
  
  // 1. Detect Action/Intent
  let action: ParsedKhataCommand['action'] = 'UNKNOWN';
  
  const inquiryPatterns = [
    'how much', 'what is', 'balance', 'due', 'owe', 'khata', 'summary', 'details', 'inquiry',
    'kitna', 'dena', 'udhaar', 'hisaab', 'hisab', 'ledger', 'dues',
    'entha', 'ivvali', 'dabbulu', 'chellinchali', 'samari', 'చూపించు', 'చెల్లించాలి', 'ఇవ్వాలి', 'ఎంత',
    'कितना', 'देना', 'उधार', 'हिसाब'
  ];
  
  const creditPatterns = [
    'credit', 'add credit', 'increase credit', 'udhaar add', 'udhaari', 'loan',
    'kredit', 'likho', 'likh', 'add', 'karo', 'kredit',
    'appu', 'add cheyi', 'rayi', 'rayu', 'రాసుకో', 'రాయు', 'అప్పు',
    'क्रेडिट', 'लिखो'
  ];
  
  const paymentPatterns = [
    'paid', 'payment', 'received', 'deposit', 'jama', 'settle', 'clear',
    'diya', 'pay kiya', 'jama karo', 'mil gaya', 'miley',
    'ichadu', 'pay chesadu', 'chellinchadu', 'ichindi', 'icharu', 'ఇచ్చాడు', 'చెల్లించాడు', 'జమ',
    'भुगतान', 'जमा'
  ];

  const hasPayment = paymentPatterns.some(p => cleanText.includes(p));
  const hasCredit = creditPatterns.some(p => cleanText.includes(p));
  const hasInquiry = inquiryPatterns.some(p => cleanText.includes(p));

  if (hasPayment) {
    action = 'PAYMENT';
  } else if (hasCredit) {
    action = 'CREDIT';
  } else if (hasInquiry) {
    action = 'INQUIRY';
  }

  // 2. Extract Amount
  let amount: number | undefined;
  let processedText = cleanText;
  
  // Replace written number words
  const allNumbers = {
    ...TELUGU_NUMBERS,
    ...HINDI_NUMBERS,
    ...ENGLISH_NUMBERS,
    ...KHATA_NUMBERS
  };
  const numKeys = Object.keys(allNumbers).sort((a, b) => b.length - a.length);
  for (const key of numKeys) {
    const isWord = /^[a-zA-Z\s]+$/.test(key);
    const regex = isWord ? new RegExp(`\\b${key}\\b`, 'gi') : new RegExp(key, 'g');
    if (regex.test(processedText)) {
      processedText = processedText.replace(regex, ` ${allNumbers[key]} `).trim();
    }
  }

  // Find digits
  const matches = processedText.match(/(\d+(?:\.\d+)?)/g);
  if (matches && matches.length > 0) {
    amount = parseFloat(matches[matches.length - 1]);
    processedText = processedText.replace(matches[matches.length - 1], '').trim();
  }

  // 3. Extract Customer Name
  const wordsToRemove = [
    ...inquiryPatterns,
    ...creditPatterns,
    ...paymentPatterns,
    'rupees', 'rupee', 'rs', 'rupaye', 'rupaya', 'rupai', 'dabbulu', 'amount', 'to', 'for', 'from', 'of',
    'రూపాయలు', 'రూపాయల', 'రూ', 'రూపాయి', 'రూపాయిలు', 'रुपये', 'रुपया', 'की', 'को', 'का', 'से', 'నే', 'నేను',
    'ne', 'se', 'ko', 'ki', 'lo', 'nunchi', 'nundi', 'ku', 'rupeelu', 'rupayalu', 'chupinchu'
  ];

  let nameQuery = processedText;
  wordsToRemove.forEach(w => {
    const reg = /^[a-zA-Z]+$/.test(w) ? new RegExp(`\\b${w}\\b`, 'gi') : new RegExp(w, 'g');
    nameQuery = nameQuery.replace(reg, ' ');
  });
  nameQuery = nameQuery.replace(/\s+/g, ' ').trim();

  let customerId: number | null = null;
  let customerName = nameQuery;
  let confidence: ParsedKhataCommand['confidence'] = 'LOW';

  if (nameQuery) {
    let bestMatch: Customer | null = null;
    bestMatch = customers.find(c => c.name.toLowerCase() === nameQuery) || null;
    
    if (!bestMatch) {
      bestMatch = customers.find(c => c.name.toLowerCase().includes(nameQuery) || nameQuery.includes(c.name.toLowerCase())) || null;
    }

    if (!bestMatch) {
      const queryWords = nameQuery.split(/\s+/).filter(w => w.length > 2);
      if (queryWords.length > 0) {
        bestMatch = customers.find(c => {
          const cWords = c.name.toLowerCase().split(/\s+/);
          return queryWords.some(qw => cWords.some(cw => cw === qw));
        }) || null;
      }
    }

    if (bestMatch) {
      customerId = bestMatch.id;
      customerName = bestMatch.name;
      confidence = 'HIGH';
    }
  }

  if (action !== 'UNKNOWN' && customerId !== null) {
    confidence = 'HIGH';
  } else if (action !== 'UNKNOWN' || customerId !== null) {
    confidence = 'MEDIUM';
  }

  return {
    action,
    customerId,
    customerName: customerName || 'Unknown Customer',
    amount,
    rawText: text,
    confidence
  };
}

export async function parseKhataVoiceCommand(text: string, customers: Customer[]): Promise<ParsedKhataCommand> {
  const localResult = await parseKhataVoiceCommandLocal(text, customers);
  if (localResult.confidence === 'HIGH') {
    return localResult;
  }

  const geminiKey = db.getSetting('gemini_api_key') || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
  const groqKey = db.getSetting('groq_api_key') || (import.meta as any).env?.VITE_GROQ_API_KEY || '';

  if (!geminiKey && !groqKey) {
    return localResult;
  }

  const promptText = `You are an AI assistant for "Sai Ram Kirana" shop's credit ledger (Khata) system.
Your task is to parse a spoken command (which can be in English, Hindi, Hinglish, Telugu, or Telglish) related to customer accounts and return a structured JSON response.

Here is the list of registered customers:
${JSON.stringify(customers.map(c => ({ id: c.id, name: c.name, phone: c.phone || 'NA' })), null, 2)}

User Spoken Command: "${text}"

Rules:
1. Identify the action:
   - "INQUIRY" when the user asks how much a customer needs to pay, owes, or requests their ledger balance/summary.
   - "CREDIT" when the user wants to add credit, record a purchase on credit, or increase their outstanding debt.
   - "PAYMENT" when the user records a payment made by the customer (customer paid/cleared balance).
   - "UNKNOWN" if the command is not related or cannot be parsed.
2. Resolve the customer name against the list of registered customers. If a customer is found, set "customerId" to their id and "customerName" to their exact name. If no match is found, set "customerId" to null and "customerName" to a best guess of the spoken name.
3. Extract the amount as a number. Auto-detect regional numbering (e.g. "veyyi", "hazar", "thousand", "velu") and return it as a raw integer.
4. The JSON response must strictly conform to this schema:
{
  "action": "INQUIRY" | "CREDIT" | "PAYMENT" | "UNKNOWN",
  "customerId": number | null,
  "customerName": "exact name if matched, else best guess",
  "amount": number | null
}
Respond ONLY with the JSON object. Do not include markdown code block formatting or any other text.`;

  if (groqKey) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'You are a structured parser assistant for Khata ledgers. Respond only with valid JSON.' },
            { role: 'user', content: promptText }
          ],
          response_format: { type: 'json_object' }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const jsonText = data.choices?.[0]?.message?.content;
        if (jsonText) {
          const parsed = JSON.parse(jsonText);
          return {
            action: parsed.action || 'UNKNOWN',
            customerId: parsed.customerId,
            customerName: parsed.customerName || localResult.customerName,
            amount: parsed.amount !== null ? parsed.amount : undefined,
            rawText: text,
            confidence: parsed.customerId ? 'HIGH' : 'MEDIUM'
          };
        }
      }
    } catch (err) {
      console.error('Groq Khata voice parsing error:', err);
    }
  }

  if (geminiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (jsonText) {
          const parsed = JSON.parse(jsonText);
          return {
            action: parsed.action || 'UNKNOWN',
            customerId: parsed.customerId,
            customerName: parsed.customerName || localResult.customerName,
            amount: parsed.amount !== null ? parsed.amount : undefined,
            rawText: text,
            confidence: parsed.customerId ? 'HIGH' : 'MEDIUM'
          };
        }
      }
    } catch (err) {
      console.error('Gemini Khata voice parsing error:', err);
    }
  }

  return localResult;
}
