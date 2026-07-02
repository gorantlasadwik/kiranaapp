// Standalone unit tests for Sai Ram Kirana POS Product Creation Voice Parser.
// Simulates local product creation parsing offline rules.

const TELUGU_NUMBERS = {
  'ఒకటి': 1, 'ఒక': 1, 'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4, 'ఐదు': 5, 
  'ఆరు': 6, 'ఏడు': 7, 'ఎనిమిది': 8, 'తొమ్మిది': 9, 'పది': 10,
  'పన్నెండు': 12, 'పద్నాలుగు': 14, 'ఇరవై': 20, 'ముప్పై': 30, 
  'నలభై': 40, 'యాభై': 50, 'డెబ్బై': 70, 'ఎనభై': 80, 'తొంభై': 90,
  'రెండు వందల యాభై': 250, 'రెండు వందల': 200, 'వంద': 100, 'నూరు': 100, 'ఐదు వందల': 500,
  'అర': 0.5, 'పావు': 0.25, 'ముప్పావు': 0.75, 'ఒకటిన్నర': 1.5, 'రెండున్నర': 2.5,
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

const HINDI_NUMBERS = {
  'दो सौ': 200, 'पाँच सौ': 500, 'बारह': 12, 'चौदह': 14,
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पाँच': 5, 'छह': 6, 'सात': 7, 
  'आठ': 8, 'नौ': 9, 'दस': 10, 'बीस': 20, 'तीस': 30, 'चालीस': 40, 
  'पचास': 50, 'सौ': 100, 'ढाई सौ': 250, 'आधा': 0.5, 'पाव': 0.25, 'पौना': 0.75, 'डेढ़': 1.5, 'ढाई': 2.5,
  // Transliterated Hindi numbers
  'ek': 1, 'do': 2, 'teen': 3, 'chaar': 4, 'char': 4, 'paanch': 5, 'panch': 5, 'chhah': 6, 'che': 6, 'saat': 7,
  'aath': 8, 'nau': 9, 'das': 10, 'bees': 20, 'tees': 30, 'chalis': 40, 'pachas': 50, 'dhai sau': 250,
  'adha': 0.5, 'aadha': 0.5, 'pav': 0.25, 'paav': 0.25, 'pouna': 0.75, 'dedh': 1.5, 'ded': 1.5, 'dhai': 2.5
};

const ENGLISH_NUMBERS = {
  'two hundred': 200, 'five hundred': 500, 'fourteen': 14, 'thirteen': 13,
  'fifteen': 15, 'sixteen': 16, 'eleven': 11, 'twelve': 12,
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7,
  'eight': 8, 'nine': 9, 'ten': 10, 'twenty': 20, 'thirty': 30,
  'forty': 40, 'fifty': 50, 'hundred': 100, 'two hundred fifty': 250, 'two hundred and fifty': 250,
  'half': 0.5, 'quarter': 0.25
};

const UNIT_MAP = {
  // Grams
  'g': 'Gram', 'gram': 'Gram', 'grams': 'Gram', 'gramullu': 'Gram', 'gramulu': 'Gram', 'gramula': 'Gram', 'గ్రాములు': 'Gram', 'గ్రాముల': 'Gram', 'గ్రామ్': 'Gram', 'గ్రాం': 'Gram', 'ग्राम': 'Gram',
  // KG
  'kg': 'KG', 'kgs': 'KG', 'kilo': 'KG', 'kilos': 'KG', 'కేజీ': 'KG', 'కేజీలు': 'KG', 'కెజి': 'KG', 'కెజీ': 'KG', 'కిలో': 'KG', 'కిలోలు': 'KG', 'కిలోల': 'KG', 'केजी': 'KG', 'किलोग्राम': 'KG', 'किलो': 'KG',
  // Litre
  'l': 'Litre', 'litre': 'Litre', 'litres': 'Litre', 'లీటర్': 'Litre', 'లీటర్లు': 'Litre', 'లీటర్ల': 'Litre', 'లీటరు': 'Litre', 'लीटर': 'Litre',
  // ML
  'ml': 'ML', 'mls': 'ML', 'మిల్లీలీటర్': 'ML', 'एमएल': 'ML', 'मिलीलीटर': 'ML',
  // Packet
  'packet': 'Packet', 'packets': 'Packet', 'ప్యాకెట్': 'Packet', 'ప్యాకెట్లు': 'Packet', 'पैकेट': 'Packet',
  // Pudha
  'pudha': 'Pudha', 'pudhas': 'Pudha', 'puda': 'Pudha', 'pudas': 'Pudha', 'pooda': 'Pudha', 'poodas': 'Pudha', 'పుడ': 'Pudha', 'పుడలు': 'Pudha', 'పుడా': 'Pudha', 'पुड़ा': 'Pudha', 'पुड़े': 'Pudha',
  // Piece
  'piece': 'Piece', 'pieces': 'Piece', 'పీస్': 'Piece', 'పీసులు': 'Piece', 'पीस': 'Piece', 'నగ': 'Piece', 'single': 'Piece', 'singles': 'Piece',
  // Sheet
  'sheet': 'Sheet', 'sheets': 'Sheet', 'షీట్': 'Sheet', 'షీట్లు': 'Sheet', 'शीट': 'Sheet',
  // Bag
  'bag': 'Bag', 'bags': 'Bag', 'బస్తా': 'Bag', 'బస్తాలు': 'Bag', 'बोरी': 'Bag', 'बैग': 'Bag',
  // Box
  'box': 'Box', 'boxes': 'Box', 'బాక్స్': 'Box', 'డిబ్బా': 'Box', 'डिब्बा': 'Box'
};

function parseProductCreationVoiceCommandLocal(text) {
  const cleanText = text.toLowerCase().trim();
  let processedText = cleanText;

  const wordToNumberMap = {
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

  // 1. Detect category
  let category = 'box or pack';
  if (processedText.includes('weight') || processedText.includes('బరువు') || processedText.includes('वजन')) {
    category = 'weight';
  } else if (processedText.includes('volume') || processedText.includes('వోల్యూమ్') || processedText.includes('आयतन') || processedText.includes('litre') || processedText.includes('ml')) {
    category = 'volume';
  } else if (processedText.includes('carton') || processedText.includes('cartoon') || processedText.includes('కార్టూన్') || processedText.includes('कार्टन')) {
    category = 'cartoon';
  } else if (processedText.includes('bag') || processedText.includes('సంచి') || processedText.includes('బస్తా') || processedText.includes('बोरी')) {
    category = 'bag';
  } else if (processedText.includes('tray') || processedText.includes('ట్రే') || processedText.includes('ट्रे')) {
    category = 'tray';
  } else if (processedText.includes('sheet') || processedText.includes('షీట్') || processedText.includes('शीट')) {
    category = 'sheet';
  } else if (processedText.includes('box') || processedText.includes('pack') || processedText.includes('packet') || processedText.includes('పీస్') || processedText.includes('డబ్బా')) {
    category = 'box or pack';
  } else {
    if (processedText.match(/\b(kg|g|gram|grams|gramulu|gramula|gramullu|kilograms|కిలో|గ్రాములు)\b/)) {
      category = 'weight';
    } else if (processedText.match(/\b(l|litre|litres|ml|లీటర్|మిల్లీలీటర్)\b/)) {
      category = 'volume';
    } else if (processedText.match(/\b(tray|ట్రే)\b/)) {
      category = 'tray';
    } else if (processedText.match(/\b(sheet|షీట్)\b/)) {
      category = 'sheet';
    } else if (processedText.match(/\b(bag|బస్తా)\b/)) {
      category = 'bag';
    } else if (processedText.match(/\b(carton|cartoon|కార్టూన్)\b/)) {
      category = 'cartoon';
    }
  }

  // 2. Parse unit conversion factors BEFORE unit / quantity parsing to avoid child unit clashes
  const conversions = [];
  const convRegex = /(?:contains|conversion\s+factor|factor|has|contains\s+about)\s*(\d+)\s*(?:pieces|singles|eggs|units|piece|single|egg)?/i;
  const convMatch = processedText.match(convRegex);
  if (convMatch) {
    const factor = parseInt(convMatch[1]);
    if (factor > 0) {
      let parent_unit = 'Tray';
      let child_unit = 'Piece';
      if (category === 'sheet') { parent_unit = 'Sheet'; child_unit = 'Piece'; }
      else if (category === 'cartoon') { parent_unit = 'Carton'; child_unit = 'Piece'; }
      else if (category === 'box or pack') { parent_unit = 'Box'; child_unit = 'Piece'; }
      else if (category === 'bag') { parent_unit = 'Bag'; child_unit = 'Piece'; }
      else if (category === 'tray') { parent_unit = 'Tray'; child_unit = 'Single'; }
      
      conversions.push({ parent_unit, child_unit, conversion_factor: factor });
    }
    processedText = processedText.replace(convMatch[0], ' ');
  } else {
    // Try fallback regex e.g. "30 pieces"
    const countFallbackRegex = /(\d+)\s*(?:pieces|singles|eggs|units|piece|single|egg)/i;
    const fallbackMatch = processedText.match(countFallbackRegex);
    if (fallbackMatch && (category === 'tray' || category === 'sheet')) {
      const factor = parseInt(fallbackMatch[1]);
      if (factor > 0) {
        let parent_unit = category === 'tray' ? 'Tray' : 'Sheet';
        let child_unit = category === 'tray' ? 'Single' : 'Piece';
        conversions.push({ parent_unit, child_unit, conversion_factor: factor });
      }
      processedText = processedText.replace(fallbackMatch[0], ' ');
    }
  }

  let unit = '';
  let quantity = 1;
  let hasExplicitQuantity = false;
  let hasExplicitUnit = false;

  const qtyMatch = processedText.match(/\b(?:quantity|qty|quantity\s+is|qty\s+is|పరిమాణం|मात्रा)\s*(\d+(?:\.\d+)?)/);
  if (qtyMatch) {
    quantity = parseFloat(qtyMatch[1]);
    hasExplicitQuantity = true;
    processedText = processedText.replace(qtyMatch[0], ' ');
  }

  const unitMatch = processedText.match(/\b(?:unit|measurement|యూనిట్|यूनिट)\s*([a-zA-Z\u0c00-\u0c7f\u0900-\u097f]+)/);
  if (unitMatch) {
    const rawUnit = unitMatch[1].trim().toLowerCase();
    const resolvedUnitName = Object.keys(UNIT_MAP).find(u => rawUnit === u || u.includes(rawUnit));
    if (resolvedUnitName) {
      unit = UNIT_MAP[resolvedUnitName];
      hasExplicitUnit = true;
    } else {
      unit = unitMatch[1].charAt(0).toUpperCase() + unitMatch[1].slice(1).toLowerCase();
      hasExplicitUnit = true;
    }
    processedText = processedText.replace(unitMatch[0], ' ');
  }

  const unitRegexes = [
    { regex: /(\d+(?:\.\d+)?)\s*(?:kilograms|kilos|kilo|kg|కేజీ|కిలో|केजी)/, val: 'KG' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:gramullu|gramula|gramulu|grams|gram|g|గ్రాములు|గ్రామ్|గ్రాం|ग्राम)/, val: 'Gram' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:milliliter|mls|ml|మిల్లీలీటర్|एमएल)/, val: 'ML' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:litres|litre|l|లీటర్|लीटर)/, val: 'Litre' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:packets|packet|ప్యాకెట్|पैकेट)/, val: 'Packet' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:pudhas|pudha|pudas|puda|poodas|pooda|పుడలు|పుడ|పుడా|पुड़ा|पुड़े)/, val: 'Pudha' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:pieces|piece|పీసులు|పీస్|पीस)/, val: 'Piece' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:trays|tray|ట్రే|ट्रे)/, val: 'Tray' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:sheets|sheet|షీట్లు|షీట్|शीट)/, val: 'Sheet' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:bags|bag|బస్తాలు|బస్తా|బోరీ|बैग)/, val: 'Bag' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:cartons|carton|cartoons|cartoon|కార్టూన్|कार्टन)/, val: 'Carton' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:boxes|box|బాక్స్|డిబ్బా|डिब्बा)/, val: 'Box' }
  ];

  let matchedUnitWeight = '';
  if (!hasExplicitUnit || !hasExplicitQuantity) {
    for (const item of unitRegexes) {
      const match = processedText.match(item.regex);
      if (match) {
        if (!hasExplicitQuantity) {
          quantity = parseFloat(match[1]);
        }
        if (!hasExplicitUnit) {
          unit = item.val;
        }
        matchedUnitWeight = match[0];
        processedText = processedText.replace(match[0], ' ');
        break;
      }
    }
  }

  if (!unit) {
    if (category === 'weight') unit = 'KG';
    else if (category === 'volume') unit = 'Litre';
    else if (category === 'cartoon') unit = 'Carton';
    else if (category === 'bag') unit = 'Bag';
    else if (category === 'tray') unit = 'Tray';
    else if (category === 'sheet') unit = 'Sheet';
    else unit = 'Packet';
  }

  let retail_price = 0;
  let wholesale_price = 0;

  const retailMatch = processedText.match(/(?:retail|price|rate|cost|రిటైల్|ధర|రేటు|रिटेल|मूल्य)\s*(\d+(?:\.\d+)?)/);
  if (retailMatch) {
    retail_price = parseFloat(retailMatch[1]);
    processedText = processedText.replace(retailMatch[0], ' ');
  }
  const wholesaleMatch = processedText.match(/(?:wholesale|whole sale|హోల్సేల్|होलसेल)\s*(\d+(?:\.\d+)?)/);
  if (wholesaleMatch) {
    wholesale_price = parseFloat(wholesaleMatch[1]);
    processedText = processedText.replace(wholesaleMatch[0], ' ');
  }

  if (retail_price === 0 || wholesale_price === 0) {
    let textForPrice = processedText;
    if (matchedUnitWeight) {
      textForPrice = textForPrice.replace(matchedUnitWeight, ' ');
    }
    
    const overrideWeightMatch = textForPrice.match(/(\d+(?:\.\d+)?)\s*(?:g|gram|grams|gramulu|gramula|gramullu|ml|kg|l|litre|packet|packets|pudha|pudhas|puda|pudas|pooda|poodas|piece|pieces|tray|trays|sheet|sheets|bag|bags|carton|cartons|box|boxes)/g);
    if (overrideWeightMatch) {
      overrideWeightMatch.forEach(m => {
        textForPrice = textForPrice.replace(m, ' ');
      });
    }

    const numbers = textForPrice.match(/\b\d+(?:\.\d+)?\b/g);
    if (numbers && numbers.length > 0) {
      const parsedNums = numbers.map(n => parseFloat(n));
      if (retail_price === 0 && parsedNums.length > 0) {
        retail_price = parsedNums[0];
      }
      if (wholesale_price === 0 && parsedNums.length > 1) {
        wholesale_price = parsedNums[1];
      } else if (wholesale_price === 0 && retail_price !== 0) {
        wholesale_price = Math.round(retail_price * 0.95);
      }
    }
  }

  if (wholesale_price === 0 && retail_price > 0) {
    wholesale_price = Math.round(retail_price * 0.95);
  }

  const overrides = [];
  const overrideRegex = /(\d+(?:\.\d+)?)\s*(g|gram|grams|gramulu|gramula|gramullu|ml|kg|l|litre|packet|packets|pudha|pudhas|puda|pudas|pooda|poodas|piece|pieces|sheet|sheets|tray|trays|bag|bags|box|boxes|గ్రాములు|కేజీ|పుడ|పుడలు|पुड़ा|पुड़े)\s*[^0-9\n]*\s*(\d+(?:\.\d+)?)/g;
  let match;
  while ((match = overrideRegex.exec(processedText)) !== null) {
    const oQty = parseFloat(match[1]);
    const oUnit = match[2];
    const oPrice = parseFloat(match[3]);
    
    let oUnitName = '';
    if (['g', 'gram', 'grams', 'gramulu', 'gramula', 'gramullu', 'గ్రాములు'].some(u => oUnit.includes(u))) {
      oUnitName = `${oQty}g`;
    } else if (['ml', 'మిల్లీలీటర్'].some(u => oUnit.includes(u))) {
      oUnitName = `${oQty}ml`;
    } else if (['kg', 'kilo', 'కేజీ', 'కిలో'].some(u => oUnit.includes(u))) {
      oUnitName = `${oQty}kg`;
    } else if (['l', 'litre', 'లీటర్'].some(u => oUnit.includes(u))) {
      oUnitName = `${oQty}L`;
    } else if (['pudha', 'pudhas', 'puda', 'pudas', 'pooda', 'poodas', 'పుడ', 'పుడలు', 'पुड़ा', 'पुड़े'].some(u => oUnit.includes(u))) {
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

  // 3. Clean processedText to extract display name
  let nameStr = processedText;

  const filterTerms = [
    'retail', 'wholesale', 'whole sale', 'price', 'rate', 'cost',
    'weight', 'volume', 'carton', 'cartoon', 'bag', 'tray', 'sheet', 'box', 'pack', 'packet', 'pudha', 'puda', 'pooda', 'pudhas', 'pudas', 'poodas', 'format',
    'kg', 'kilo', 'kilograms', 'gram', 'grams', 'gramulu', 'gramula', 'gramullu', 'litre', 'litres', 'ml', 'mls', 'piece', 'pieces',
    'రిటైల్', 'హోల్సేల్', 'ధర', 'రేటు', 'బరువు', 'కార్టూన్', 'సంచి', 'బస్తా', 'ట్రే', 'షీట్', 'బాక్స్', 'ప్యాకెట్', 'పుడ', 'పుడలు', 'పీస్',
    'ఒకటి', 'ఒక', 'రెండు', 'మూడు', 'నాలుగు', 'ఐదు', 'ఆరు', 'ఏడు', 'ఎనిమిది', 'तొమ్మిది', 'పది',
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

  if (category === 'weight' && quantity === 1 && unit === 'KG' && !display_name.toLowerCase().includes('1kg') && !display_name.toLowerCase().includes('1 kg')) {
    display_name = display_name + ' 1kg';
  } else if (category === 'volume' && quantity === 1 && unit === 'Litre' && !display_name.toLowerCase().includes('1l') && !display_name.toLowerCase().includes('1 l')) {
    display_name = display_name + ' 1L';
  }

  const words = display_name.toLowerCase().split(/\s+/);
  const aliases = words.filter(w => w.length > 2);

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

// Test cases
const TEST_CASES = [
  {
    input: "Tata Salt 1 kg box or pack unit packet retail 30 wholesale 28",
    expected: {
      display_name: "Tata Salt",
      category: "box or pack",
      unit: "Packet",
      quantity: 1,
      retail_price: 30,
      wholesale_price: 28
    }
  },
  {
    input: "Sugar weight 1 kg retail 40 wholesale 38 250 grams price is 12",
    expected: {
      display_name: "Sugar 1kg",
      category: "weight",
      unit: "KG",
      quantity: 1,
      retail_price: 40,
      wholesale_price: 38,
      override: { unit_name: "250g", price: 12 }
    }
  },
  {
    input: "rendu vandala yabai gramullu sugar weight retail 40 wholesale 38",
    expected: {
      display_name: "Sugar",
      category: "weight",
      unit: "Gram",
      quantity: 250,
      retail_price: 40,
      wholesale_price: 38
    }
  },
  {
    input: "Egg tray contains 30 pieces retail 180 wholesale 170",
    expected: {
      display_name: "Egg",
      category: "tray",
      unit: "Tray",
      quantity: 1,
      retail_price: 180,
      wholesale_price: 170,
      conversion: { parent_unit: "Tray", child_unit: "Single", conversion_factor: 30 }
    }
  },
  {
    input: "Tata Salt 1 pudha box or pack retail 30 wholesale 28",
    expected: {
      display_name: "Tata Salt",
      category: "box or pack",
      unit: "Pudha",
      quantity: 1,
      retail_price: 30,
      wholesale_price: 28
    }
  }
];

let failed = 0;
console.log("=== Running Product Creation Voice Intelligence Parser Test Suite ===\n");

TEST_CASES.forEach((tc, idx) => {
  const result = parseProductCreationVoiceCommandLocal(tc.input);
  
  let ok = true;
  if (result.category !== tc.expected.category) ok = false;
  if (result.unit !== tc.expected.unit) ok = false;
  if (result.quantity !== tc.expected.quantity) ok = false;
  if (result.retail_price !== tc.expected.retail_price) ok = false;
  if (result.wholesale_price !== tc.expected.wholesale_price) ok = false;
  if (result.display_name.toLowerCase() !== tc.expected.display_name.toLowerCase()) ok = false;

  if (tc.expected.override) {
    const oMatch = result.overrides.find(o => o.unit_name === tc.expected.override.unit_name && o.price === tc.expected.override.price);
    if (!oMatch) ok = false;
  }
  
  if (tc.expected.conversion) {
    const cMatch = result.unit_conversions.find(c => c.parent_unit === tc.expected.conversion.parent_unit && c.child_unit === tc.expected.conversion.child_unit && c.conversion_factor === tc.expected.conversion.conversion_factor);
    if (!cMatch) ok = false;
  }

  if (ok) {
    console.log(`✓ [Test #${idx + 1}] PASS: "${tc.input}"`);
    console.log(`    -> Display Name: "${result.display_name}", Category: ${result.category}, Unit: ${result.unit}, Qty: ${result.quantity}, Retail: ₹${result.retail_price}, Wholesale: ₹${result.wholesale_price}`);
    if (result.overrides.length > 0) {
      console.log(`       Overrides:`, result.overrides);
    }
    if (result.unit_conversions.length > 0) {
      console.log(`       Conversions:`, result.unit_conversions);
    }
  } else {
    console.log(`❌ [Test #${idx + 1}] FAIL: "${tc.input}"`);
    console.log(`    Expected:`, tc.expected);
    console.log(`    Received:`, result);
    failed++;
  }
  console.log("--------------------------------------------------");
});

if (failed === 0) {
  console.log("\n🎉 ALL PRODUCT CREATION TESTS COMPLETED SUCCESSFULLY! (5/5 cases passed)");
  process.exit(0);
} else {
  console.log(`\n⚠️ TESTING FAILED. ${failed} cases failed validation.`);
  process.exit(1);
}
