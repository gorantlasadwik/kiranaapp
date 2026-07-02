// Automated unit tests for Sai Ram Kirana POS Voice Intelligence Engine.
// Simulates local database queries and runs parser assertions.

const TELUGU_NUMBERS = {
  'రెండు వందల': 200, 'ఐదు వందల': 500, 'పన్నెండు': 12, 'పద్నాలుగు': 14,
  'ఒకటి': 1, 'ఒక': 1, 'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4, 'ఐదు': 5, 
  'ఆరు': 6, 'ఏడు': 7, 'ఎనిమిది': 8, 'తొమ్మిది': 9, 'పది': 10,
  'ఇరవై': 20, 'ముప్పై': 30, 'నలభై': 40, 'యాభై': 50, 'డెబ్బై': 70, 
  'ఎనభై': 80, 'తొంభై': 90, 'వంద': 100, 'నూరు': 100
};

const HINDI_NUMBERS = {
  'दो सौ': 200, 'पाँच सौ': 500, 'बारह': 12, 'चौदह': 14,
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पाँच': 5, 'छह': 6, 'सात': 7, 
  'आठ': 8, 'नौ': 9, 'दस': 10, 'बीस': 20, 'तीस': 30, 'चालीस': 40, 
  'पचास': 50, 'सौ': 100
};

const ENGLISH_NUMBERS = {
  'two hundred': 200, 'five hundred': 500, 'fourteen': 14, 'thirteen': 13,
  'fifteen': 15, 'sixteen': 16, 'eleven': 11, 'twelve': 12,
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7,
  'eight': 8, 'nine': 9, 'ten': 10, 'twenty': 20, 'thirty': 30,
  'forty': 40, 'fifty': 50, 'hundred': 100
};

const UNIT_MAP = {
  'గ్రాములు': 'Gram', 'గ్రాముల': 'Gram', 'gram': 'Gram', 'grams': 'Gram', 'g': 'Gram', 'ग्राम': 'Gram',
  'కేజీలు': 'KG', 'కేజీ': 'KG', 'kilos': 'KG', 'kilo': 'KG', 'kgs': 'KG', 'kg': 'KG', 'किलोग्राम': 'KG', 'किलो': 'KG',
  'లీటర్లు': 'Litre', 'లీటర్': 'Litre', 'litres': 'Litre', 'litre': 'Litre', 'l': 'Litre', 'लीटर': 'Litre',
  'మిల్లీలీటర్': 'ML', 'ml': 'ML', 'mls': 'ML', 'एमएल': 'ML', 'मिलीलीटर': 'ML',
  'ప్యాకెట్లు': 'Packet', 'ప్యాకెట్': 'Packet', 'packets': 'Packet', 'packet': 'Packet', 'पैकेट': 'Packet',
  'పీసులు': 'Piece', 'పీస్': 'Piece', 'pieces': 'Piece', 'piece': 'Piece', 'पीस': 'Piece', 'नग': 'Piece',
  'షీట్లు': 'Sheet', 'షీట్': 'Sheet', 'sheets': 'Sheet', 'sheet': 'Sheet', 'शीट': 'Sheet',
  'బస్తాలు': 'Bag', 'బస్తా': 'Bag', 'bags': 'Bag', 'bag': 'Bag', 'बोरी': 'Bag', 'बैग': 'Bag',
  'బాక్స్': 'Box', 'boxes': 'Box', 'box': 'Box', 'డిబ్బా': 'Box'
};

// Mock product catalog with multilingual aliases matching actual DB configurations
const MOCK_PRODUCTS = [
  { id: 1, display_name: 'Kandi Pappu', aliases: ['toor dal', 'arhar dal', 'tuvar dal', 'kandi pappu', 'కందిపప్పు'] },
  { id: 2, display_name: 'Freedom Sunflower Oil', aliases: ['freedom', 'freedom oil', 'sunflower oil', 'oil', 'నూనె'] },
  { id: 3, display_name: 'Maggi Noodles', aliases: ['maggi', 'noodles', 'మ్యాగీ', 'మ్యాగి', 'मैगी'] },
  { id: 4, display_name: 'Sugar', aliases: ['sugar', 'chakkera', 'cheeni', 'చక్కెర'] }
];

// Local parser implementing sorted checks
function testParseLocal(text) {
  const cleanText = text.toLowerCase().trim();

  if (
    cleanText.includes('print bill') || 
    cleanText.includes('బిల్ ప్రింట్') || 
    cleanText.includes('ప్రింట్ బిల్') || 
    cleanText.includes('बिल प्रिंट')
  ) {
    return { action: 'PRINT_BILL', rawText: text, confidence: 'HIGH' };
  }

  let action = 'ADD_ITEM';
  let processedText = cleanText;

  const removePatterns = ['remove', 'delete', 'cancel', 'తీసేయ్', 'తొలగించు', 'हटाओ', 'काट दो'];
  const editPatterns = ['change', 'update', 'edit', 'మార్చు', 'చేయి', 'బదలో', 'कर दो'];

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

  let quantity;
  let unit;

  const mixedSizePhrases = [
    'half litre', 'half liter', 'half l',
    'అర లీటర్', 'అర లీటరు',
    'आधा लीटर', 'अधा लीटर'
  ];
  for (const phrase of mixedSizePhrases) {
    if (processedText.includes(phrase)) {
      processedText = processedText.replace(phrase, ' ').trim();
      break;
    }
  }

  // Match actual digits
  const digitMatch = processedText.match(/(\d+(\.\d+)?)/);
  if (digitMatch) {
    quantity = parseFloat(digitMatch[1]);
    processedText = processedText.replace(digitMatch[1], '').trim();
  } else {
    // Sort keys by length descending to match longer strings first
    const teluguKeys = Object.keys(TELUGU_NUMBERS).sort((a,b) => b.length - a.length);
    const hindiKeys = Object.keys(HINDI_NUMBERS).sort((a,b) => b.length - a.length);
    const englishKeys = Object.keys(ENGLISH_NUMBERS).sort((a,b) => b.length - a.length);

    let accumulatedQuantity = 0;
    let matchedNumber = false;

    // check Telugu numbers
    for (const word of teluguKeys) {
      if (processedText.includes(word)) {
        accumulatedQuantity += TELUGU_NUMBERS[word];
        processedText = processedText.replace(word, '').trim();
        matchedNumber = true;
      }
    }
    
    // check Hindi numbers if not matched telugu
    if (!matchedNumber) {
      for (const word of hindiKeys) {
        if (processedText.includes(word)) {
          accumulatedQuantity += HINDI_NUMBERS[word];
          processedText = processedText.replace(word, '').trim();
          matchedNumber = true;
        }
      }
    }

    // check English numbers if not matched others
    if (!matchedNumber) {
      for (const word of englishKeys) {
        const regex = new RegExp(`\\b${word}\\b`, 'g');
        if (regex.test(processedText)) {
          accumulatedQuantity += ENGLISH_NUMBERS[word];
          processedText = processedText.replace(regex, '').trim();
          matchedNumber = true;
        }
      }
    }

    if (matchedNumber) {
      quantity = accumulatedQuantity;
    }
  }

  // Extract unit
  const unitKeys = Object.keys(UNIT_MAP).sort((a,b) => b.length - a.length);
  for (const unitText of unitKeys) {
    const isEnglishUnit = /^[a-zA-Z]+$/.test(unitText);
    const regex = isEnglishUnit ? new RegExp(`\\b${unitText}\\b`, 'g') : new RegExp(unitText, 'g');

    if (regex.test(processedText)) {
      unit = UNIT_MAP[unitText];
      processedText = processedText.replace(regex, '').trim();
      break;
    }
  }

  // Resolve product
  const fillers = ['of', 'to', 'for', 'changed', 'from', 'యొక్క', 'ను', 'నుండి', 'ధర', 'రేటు', 'का', 'को', 'की'];
  fillers.forEach(f => {
    const reg = new RegExp(`\\b${f}\\b`, 'g');
    processedText = processedText.replace(reg, '').trim();
  });

  const queryProduct = processedText.trim();
  let resolvedProduct = MOCK_PRODUCTS.find(p => p.display_name.toLowerCase() === queryProduct);
  if (!resolvedProduct) {
    resolvedProduct = MOCK_PRODUCTS.find(p => p.aliases.some(a => a.toLowerCase() === queryProduct));
  }
  if (!resolvedProduct) {
    resolvedProduct = MOCK_PRODUCTS.find(p => p.display_name.toLowerCase().includes(queryProduct) || p.aliases.some(a => a.toLowerCase().includes(queryProduct)));
  }

  if (quantity === undefined) quantity = 1;

  return {
    action,
    productName: resolvedProduct ? resolvedProduct.display_name : queryProduct,
    quantity,
    unit,
    rawText: text,
    resolvedProduct
  };
}

// Assert Test cases list
const TEST_CASES = [
  { input: "2 Maggi", expected: { action: "ADD_ITEM", quantity: 2, productName: "Maggi Noodles" } },
  { input: "2 maggi", expected: { action: "ADD_ITEM", quantity: 2, productName: "Maggi Noodles" } },
  { input: "250 grams sugar", expected: { action: "ADD_ITEM", quantity: 250, unit: "Gram", productName: "Sugar" } },
  { input: "రెండు వందల యాభై గ్రాముల చక్కెర", expected: { action: "ADD_ITEM", quantity: 250, unit: "Gram", productName: "Sugar" } },
  { input: "రెండు మ్యాగీ", expected: { action: "ADD_ITEM", quantity: 2, productName: "Maggi Noodles" } },
  { input: "दो मैगी", expected: { action: "ADD_ITEM", quantity: 2, productName: "Maggi Noodles" } },
  { input: "రెండు freedom half litre", expected: { action: "ADD_ITEM", quantity: 2, productName: "Freedom Sunflower Oil" } },
  { input: "दो freedom आधा लीटर", expected: { action: "ADD_ITEM", quantity: 2, productName: "Freedom Sunflower Oil" } },
  { input: "Delete sugar", expected: { action: "REMOVE_ITEM", productName: "Sugar" } },
  { input: "Change toor dal to 500 grams", expected: { action: "UPDATE_ITEM", quantity: 500, unit: "Gram", productName: "Kandi Pappu" } },
  { input: "బిల్ ప్రింట్ చేయి", expected: { action: "PRINT_BILL" } }
];

let failed = 0;
console.log("=== Running Voice Intelligence Local Parser Test Suite ===\n");

TEST_CASES.forEach((tc, idx) => {
  const result = testParseLocal(tc.input);
  
  let ok = true;
  if (result.action !== tc.expected.action) ok = false;
  if (tc.expected.quantity !== undefined && result.quantity !== tc.expected.quantity) ok = false;
  if (tc.expected.unit !== undefined && result.unit !== tc.expected.unit) ok = false;
  if (tc.expected.productName !== undefined && result.productName !== tc.expected.productName) ok = false;

  if (ok) {
    console.log(`✓ [Test #${idx + 1}] PASS: "${tc.input}"`);
    console.log(`    -> Action: ${result.action}, Product: ${result.productName || 'NA'}, Qty: ${result.quantity}, Unit: ${result.unit || 'NA'}`);
  } else {
    console.log(`❌ [Test #${idx + 1}] FAIL: "${tc.input}"`);
    console.log(`    Expected:`, tc.expected);
    console.log(`    Received:`, { action: result.action, quantity: result.quantity, unit: result.unit, productName: result.productName });
    failed++;
  }
  console.log("--------------------------------------------------");
});

if (failed === 0) {
  console.log(`\n🎉 ALL TESTS COMPLETED SUCCESSFULLY! (${TEST_CASES.length}/${TEST_CASES.length} cases passed)`);
  process.exit(0);
} else {
  console.log(`\n⚠️ TESTING FAILED. ${failed} cases failed validation.`);
  process.exit(1);
}
