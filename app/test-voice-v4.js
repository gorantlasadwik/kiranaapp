// Test suite for Voice Engine V4 in Sai Ram Kirana
// Run via: npx tsx test-voice-v4.js

global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {}
};

async function run() {
  const { db } = await import('./src/db.ts');

  // Override db methods with mock data representing real store schema
  const MOCK_PRODUCTS = [
    { 
      id: 1, 
      display_name: 'Kandi Pappu', 
      product_type: 'WEIGHT',
      default_quantity: '1kg',
      category_id: 1, // Loose item category
      aliases: ['toor dal', 'arhar dal', 'tuvar dal', 'kandi pappu', 'కందిపప్పు'],
      units: [{ unit_name: 'Gram' }, { unit_name: 'KG' }],
      retail_price: 140,
      wholesale_price: 135
    },
    { 
      id: 21, 
      display_name: 'Freedom 1L', 
      product_type: 'PACKAGED',
      variant_group: 'freedom',
      category_id: 3, // Packaged category
      aliases: ['freedom', 'freedom oil', 'sunflower oil', 'oil', 'నూనె', 'freedom 1l', 'freedom 1 litre'],
      units: [{ unit_name: 'Piece' }],
      retail_price: 210,
      wholesale_price: 205
    },
    { 
      id: 22, 
      display_name: 'Freedom 500ml', 
      product_type: 'PACKAGED',
      variant_group: 'freedom',
      category_id: 3, // Packaged category
      aliases: ['freedom', 'freedom oil', 'sunflower oil', 'oil', 'నూనె', 'freedom 500ml', 'freedom half litre'],
      units: [{ unit_name: 'Piece' }],
      retail_price: 110,
      wholesale_price: 105
    },
    { 
      id: 23, 
      display_name: 'Freedom 200ml', 
      product_type: 'PACKAGED',
      variant_group: 'freedom',
      category_id: 3, // Packaged category
      aliases: ['freedom', 'freedom oil', 'sunflower oil', 'oil', 'నూనె', 'freedom 200ml'],
      units: [{ unit_name: 'Piece' }],
      retail_price: 50,
      wholesale_price: 45
    },
    { 
      id: 31, 
      display_name: 'Maggi Small', 
      product_type: 'PACKAGED',
      variant_group: 'maggi',
      category_id: 3, // Packaged category
      aliases: ['maggi', 'noodles', 'మ్యాగీ', 'మ్యాగి', 'मैगी', 'maggi small'],
      units: [{ unit_name: 'Piece' }],
      retail_price: 14,
      wholesale_price: 13
    },
    { 
      id: 32, 
      display_name: 'Maggi Large', 
      product_type: 'PACKAGED',
      variant_group: 'maggi',
      category_id: 3, // Packaged category
      aliases: ['maggi', 'noodles', 'మ్యాగీ', 'మ్యాగి', 'मैगी', 'maggi large'],
      units: [{ unit_name: 'Piece' }],
      retail_price: 28,
      wholesale_price: 26
    },
    { 
      id: 4, 
      display_name: 'Sugar', 
      product_type: 'WEIGHT',
      default_quantity: '1kg',
      category_id: 1, // Loose item category
      aliases: ['sugar', 'chakkera', 'cheeni', 'చక్కెర'],
      units: [{ unit_name: 'Gram' }, { unit_name: 'KG' }],
      retail_price: 40,
      wholesale_price: 38
    },
    { 
      id: 5, 
      display_name: 'Chakra Tea', 
      product_type: 'PACKAGED',
      category_id: 3, // Packaged category
      aliases: ['chakra', 'tea', 'చక్ర'],
      units: [{ unit_name: 'Gram' }, { unit_name: 'Piece' }],
      retail_price: 30,
      wholesale_price: 28
    }
  ];

  db.getProducts = async () => MOCK_PRODUCTS;
  db.findVoiceCacheEntry = async () => null;
  db.getVoiceMemory = async () => [];
  db.getVoiceCorrections = async () => [];
  db.getSetting = () => '';
  db.saveVoiceCacheEntry = async () => {};
  db.saveVoiceMemory = async () => {};
  db.saveVoiceCorrection = async () => {};
  db.saveVoiceLog = async () => {};

  // Import the resolved Voice Command parser
  const { resolveVoiceCommand } = await import('./src/utils/voiceEngineV4.ts');

  // Define V4 Test Cases matching PRD specifications
  const TEST_CASES = [
    { 
      input: "2 Maggi", 
      expected: { action: "ADD_ITEM", quantity: 2, variantAction: "SHOW_VARIANTS", variantGroup: "maggi" } 
    },
    { 
      input: "2 maggi", 
      expected: { action: "ADD_ITEM", quantity: 2, variantAction: "SHOW_VARIANTS", variantGroup: "maggi" } 
    },
    { 
      input: "50 gram chakra", 
      expected: { action: "ADD_ITEM", quantity: 50, unit: "Gram", productName: "Chakra Tea" } 
    },
    { 
      input: "చక్ర", 
      expected: { action: "ADD_ITEM", quantity: 1, productName: "Chakra Tea" } 
    },
    { 
      input: "రెండు freedom half litre", 
      expected: { action: "ADD_ITEM", quantity: 2, productName: "Freedom 500ml", unit: "Piece" } 
    },
    { 
      input: "दो freedom आधा लीटर", 
      expected: { action: "ADD_ITEM", quantity: 2, productName: "Freedom 500ml", unit: "Piece" } 
    },
    { 
      input: "అర కేజీ షుగర్", 
      expected: { action: "ADD_ITEM", quantity: 500, unit: "Gram", productName: "Sugar" } 
    },
    { 
      input: "Delete sugar", 
      expected: { action: "REMOVE_ITEM", productName: "Sugar" } 
    },
    { 
      input: "Change toor dal to 500 grams", 
      expected: { action: "UPDATE_ITEM", quantity: 500, unit: "Gram", productName: "Kandi Pappu" } 
    },
    { 
      input: "print bill", 
      expected: { action: "PRINT_BILL" } 
    },
    {
      input: "sugar",
      expected: { action: "ADD_ITEM", quantity: 1, unit: "KG", productName: "Sugar" }
    },
    {
      input: "freedom",
      expected: { action: "ADD_ITEM", quantity: 1, variantAction: "SHOW_VARIANTS", variantGroup: "freedom" }
    },
    {
      input: "freedom 1 litre",
      expected: { action: "ADD_ITEM", quantity: 1, productName: "Freedom 1L", unit: "Piece" }
    }
  ];

  let failed = 0;
  console.log("=== Running Voice Intelligence V4 Redesign Test Suite ===\n");

  for (let idx = 0; idx < TEST_CASES.length; idx++) {
    const tc = TEST_CASES[idx];
    const result = await resolveVoiceCommand(tc.input);

    let ok = true;
    if (result.action !== tc.expected.action) ok = false;
    if (tc.expected.quantity !== undefined && result.quantity !== tc.expected.quantity) ok = false;
    if (tc.expected.unit !== undefined && result.unit !== tc.expected.unit) ok = false;
    if (tc.expected.productName !== undefined && result.resolvedProduct?.display_name !== tc.expected.productName) ok = false;
    if (tc.expected.variantAction !== undefined && result.variantAction !== tc.expected.variantAction) ok = false;
    if (tc.expected.variantGroup !== undefined && result.variantGroup !== tc.expected.variantGroup) ok = false;

    if (ok) {
      console.log(`✓ [Test #${idx + 1}] PASS: "${tc.input}"`);
      if (result.variantAction === 'SHOW_VARIANTS') {
        console.log(`    -> Action: ${result.action}, Variant Group: ${result.variantGroup}, Qty: ${result.quantity}, SHOW POPUP: true`);
      } else {
        console.log(`    -> Action: ${result.action}, Product: ${result.resolvedProduct?.display_name || 'NA'}, Qty: ${result.quantity}, Unit: ${result.unit}`);
      }
    } else {
      console.log(`❌ [Test #${idx + 1}] FAIL: "${tc.input}"`);
      console.log(`    Expected:`, tc.expected);
      console.log(`    Received:`, { 
        action: result.action, 
        quantity: result.quantity, 
        unit: result.unit, 
        productName: result.resolvedProduct?.display_name,
        variantAction: result.variantAction,
        variantGroup: result.variantGroup
      });
      failed++;
    }
    console.log("--------------------------------------------------");
  }

  if (failed === 0) {
    console.log(`\n🎉 ALL Voice V4 TESTS COMPLETED SUCCESSFULLY! (${TEST_CASES.length}/${TEST_CASES.length} cases passed)`);
    process.exit(0);
  } else {
    console.log(`\n⚠️ Voice V4 TESTING FAILED. ${failed} cases failed validation.`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
