// Debug: test getBaseBrandName logic for Aashirvaad salt
// Run with: node debug_salt.js

function getBaseBrandName(nameStr) {
  const lower = nameStr.toLowerCase();
  const qtyPattern = /\b\d+(?:\.\d+)?\s*(g|gram|grams|grm|grms|gm|gms|kg|kilo|kilograms|kilos|l|litre|litres|ml|milliliter|milliliters|packet|packets|pc|pcs|piece|pieces|bag|bags|box|boxes|carton|cartons|cartoon|cartoons|tray|trays|sheet|sheets|single|singles)\b/gi;
  const standalonePackaging = /\b(bag|bags|carton|cartons|cartoon|cartoons|tray|trays|sheet|sheets|box|boxes|packet|packets|piece|pieces|single|singles|pudha|pudhas|puda|pudas)\b/gi;
  const fractionsPattern = /\b(1\/2|half|ara|pav|paavu|sagam|aadha|adha|pao|pavu)\b/gi;
  
  let base = lower.replace(qtyPattern, '').replace(standalonePackaging, '').replace(fractionsPattern, '');
  return base.replace(/\s+/g, ' ').trim();
}

const names = [
  'Aashirvaad Iodised Salt 1 kg',
  'Aashirvaad Iodised Salt 1 kg Bag',
  'Aashirvaad Salt 1 kg',
  'Aashirvaad Salt 1 kg Bag',
  'Ashirwad Salt 1kg',
  'Ashirwad Salt 1kg Bag',
];

console.log('Base name matching results:');
names.forEach(name => {
  console.log(`  "${name}" → "${getBaseBrandName(name)}"`);
});

console.log('\nPairs that would match (same base name):');
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    if (getBaseBrandName(names[i]) === getBaseBrandName(names[j])) {
      console.log(`  ✓ "${names[i]}" == "${names[j]}" → "${getBaseBrandName(names[i])}"`);
    }
  }
}
