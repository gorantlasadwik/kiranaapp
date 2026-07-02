import { create } from 'zustand';
import { db } from './db';
import type { Product, Customer, Bill, BillItem, KhataRecord, VoiceCacheEntry, PrintJobStatus } from './db';
import { printReceipt, bluetoothPrinter, DEFAULT_UPI_QR_PAYLOAD } from './utils/printerService';
import type { PrinterConfig } from './utils/printerService';
import { syncEngine } from './syncEngine';
import {
  claimPrinterHost, releasePrinterHost, getMyDeviceId,
  isThisDeviceHost, submitPrintJob, printDirectAsHost,
  getPrinterHostAvailability, PRINT_JOB_ACK_TIMEOUT_MS, PRINT_JOB_TOTAL_TIMEOUT_MS
} from './utils/printerHostManager';

const LEGACY_DEFAULT_UPI_ID = 'sairamkirana@sbi';

function playAddProductBeep() {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = 'sine';
    oscillator.frequency.value = 1200; // 1.2kHz clean beep
    gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime); // 8% volume to be pleasant
    gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.12); // fade out over 120ms

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.12);
  } catch (e) {
    console.error('Failed to play beep sound:', e);
  }
}

export type ScreenType = 'launch' | 'approval' | 'home' | 'new_bill' | 'products' | 'barcode' | 'history' | 'khata' | 'settings' | 'reports' | 'system_barcodes' | 'categories';

interface POSState {
  // Screens & Navigation
  currentScreen: ScreenType;
  deviceStatus: 'unregistered' | 'pending' | 'approved' | 'rejected' | 'revoked';
  trustedToken: string;
  storeName: string;
  upiId: string;
  syncQueueCount: number;
  isSyncing: boolean;
  isOnline: boolean;
  isDatabaseInitialized: boolean;
  showSyncPopup: boolean;
  syncProgressText: string;
  syncCurrentCount: number;
  syncTotalCount: number;

  // Products & Customers lists
  products: Product[];
  customers: Customer[];
  khataRecords: KhataRecord[];

  // Active Billing Session
  activeBill: {
    customer_id?: number;
    customer_name: string;
    customer_phone: string;
    items: BillItem[];
    subtotal: number;
    discount: number;
    grand_total: number;
    payment_mode: 'Cash' | 'UPI' | 'Credit';
  };
  draftRecoverable: boolean;
  pendingVoiceCache: Omit<VoiceCacheEntry, 'id'>[];
  pendingCheckoutBill: Bill | null;

  // Printer status
  printerConnected: boolean;
  printerStatus: 'Connected' | 'Disconnected' | 'Connecting';
  pairedPrinters: { name: string; mac: string }[];
  isScanning: boolean;
  autoConnect: boolean;
  printerConfig: PrinterConfig;

  // Print job tracking (multi-device host architecture)
  printJobStatus: PrintJobStatus | null;
  printJobId: number | null;
  showPrintingProgressModal: boolean;
  printingStatusText: 'Connecting...' | 'Printing...' | 'Success';

  // UI helpers
  voiceContext: 'new_bill' | 'products' | 'history' | 'khata' | 'default';
  isListening: boolean;
  voiceTranscript: string;

  // Actions
  initApp: () => Promise<void>;
  initialDeviceSetup: (onProgress: (table: string, current: number, total: number) => void) => Promise<void>;
  setScreen: (screen: ScreenType) => void;
  registerDevice: (deviceName: string, pass: string) => Promise<boolean>;
  checkDeviceStatus: () => Promise<void>;
  loadStoreData: () => Promise<void>;

  // Billing Actions
  startNewBill: (name?: string, phone?: string) => void;
  setCustomer: (id?: number, name?: string, phone?: string) => void;
  addItem: (product: Product, quantity: number, unitName?: string) => void;
  removeItem: (productId: number) => void;
  editItem: (productId: number, quantity: number, unitName?: string, priceOverride?: number, nameOverride?: string, originalUnit?: string) => void;
  addPendingVoiceMapping: (phrase: string, productId: number, quantity: number, unit: string, action: 'ADD_ITEM' | 'REMOVE_ITEM' | 'UPDATE_ITEM') => void;
  setDiscount: (discount: number) => void;
  setPaymentMode: (mode: 'Cash' | 'UPI' | 'Credit') => void;
  saveDraftBill: () => void;
  recoverDraftBill: () => void;
  discardDraftBill: () => void;
  checkoutAndPrint: () => Promise<Bill | null>;
  saveAndSkipPrint: () => Promise<Bill | null>;
  cancelBill: (billId: number) => Promise<void>;
  updateBill: (updatedBill: Bill) => Promise<void>;

  // Settings Actions
  saveSettings: (settings: { store_name: string; upi_id: string; printer_name: string; printer_mac: string; upi_qr_image?: string; qr_size?: number }) => void;
  testPrint: () => Promise<boolean>;
  triggerSync: (isManual?: boolean) => Promise<void>;
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  forceFullSync: () => Promise<void>;
  manualSync: () => Promise<void>;

  scanBluetoothDevices: () => Promise<void>;
  connectPrinter: (mac: string, name?: string) => Promise<boolean>;
  disconnectPrinter: () => Promise<void>;
  reconnectPrinter: () => Promise<boolean>;
  toggleAutoConnect: () => void;
  saveBillAfterPrintSuccess: (billData: Omit<Bill, 'id' | 'bill_number' | 'created_at'>) => Promise<Bill>;
  retryCheckoutPrint: () => Promise<Bill | null>;
}

export function getBaseBrandName(nameStr: string): string {
  const lower = nameStr.toLowerCase();
  // Strip patterns like "1 kg", "500g", "2 bags" (number + unit)
  const qtyPattern = /\b\d+(?:\.\d+)?\s*(g|gram|grams|grm|grms|gm|gms|kg|kilo|kilograms|kilos|l|litre|litres|ml|milliliter|milliliters|pc|pcs|piece|pieces|bag|bags|carton|cartons|cartoon|cartoons|tray|trays|sheet|sheets)\b/gi;
  // Also strip standalone packaging/unit words without a preceding number
  // e.g. "Aashirvaad Salt 1 kg Bag" → removes "bag" → "aashirvaad salt" (same base as "Aashirvaad Salt 1 kg")
  const standalonePackaging = /\b(bag|bags|carton|cartons|cartoon|cartoons|tray|trays|sheet|sheets|pudha|pudhas|puda|pudas|piece|pieces|pc|pcs)\b/gi;
  const fractionsPattern = /\b(1\/2|half|ara|pav|paavu|sagam|aadha|adha|pao|pavu)\b/gi;
  const traditionalTerms = ['cheytak', 'chhatak', 'chatak', 'cheetak', 'adda pav', 'adha pav', 'thin pav', 'teen pav', 'dedh kilo', 'stullam', 'thulam', 'tola', 'sawa kilo', 'dhai kilo', 'paune do kilo'];
  
  let base = lower.replace(qtyPattern, '').replace(standalonePackaging, '').replace(fractionsPattern, '');
  traditionalTerms.forEach(t => {
    base = base.replace(new RegExp(`\\b${t}\\b`, 'gi'), '');
  });
  return base.replace(/\s+/g, ' ').trim();
}

export function getUnitBaseQuantity(unitName: string, product: Product): number {
  const norm = unitName.toLowerCase().trim();
  
  // Standard base units
  if (['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'].includes(norm)) {
    return 1.0;
  }
  if (['gram', 'grams', 'g', 'gm', 'gms', 'grm', 'grms'].includes(norm)) {
    return 0.001;
  }
  if (['litre', 'litres', 'l', 'liter', 'liters'].includes(norm)) {
    return 1.0;
  }
  if (['ml', 'mls', 'milliliter', 'milliliters'].includes(norm)) {
    return 0.001;
  }
  
  // Check custom product units
  const custom = product.units?.find(u => u.unit_name && u.unit_name.toLowerCase().trim() === norm);
  if (custom) {
    return custom.quantity;
  }
  
  // Parse numeric prefix/suffix from unit name (e.g., '500g' -> 0.5, '250g' -> 0.25)
  const matchWeight = norm.match(/^(\d+(?:\.\d+)?)\s*(g|gram|grams|grm|grms|gm|gms)$/i);
  if (matchWeight) {
    return parseFloat(matchWeight[1]) * 0.001;
  }
  const matchWeightKg = norm.match(/^(\d+(?:\.\d+)?)\s*(kg|kgs|kilo|kilos|kilogram|kilograms)$/i);
  if (matchWeightKg) {
    return parseFloat(matchWeightKg[1]);
  }
  const matchVolumeMl = norm.match(/^(\d+(?:\.\d+)?)\s*(ml|mls|milliliter|milliliters)$/i);
  if (matchVolumeMl) {
    return parseFloat(matchVolumeMl[1]) * 0.001;
  }
  const matchVolumeL = norm.match(/^(\d+(?:\.\d+)?)\s*(litre|litres|l|liter|liters)$/i);
  if (matchVolumeL) {
    return parseFloat(matchVolumeL[1]);
  }
  
  return 1.0;
}

// Helper to find the correct product in a family (e.g. Aashirvaad Salt vs Aashirvaad Salt Bag) for a requested unit
export function findProductInFamilyForUnit(
  familyProducts: Product[],
  requestedUnit: string
): Product | undefined {
  const normUnit = requestedUnit.toLowerCase();

  // 1. First priority: If requested unit is a packaging unit (e.g., 'bag', 'carton', 'tray')
  const PACKAGING_UNITS = ['bag', 'carton', 'cartoon', 'tray', 'pudha', 'puda', 'sheet'];
  const isPackaging = PACKAGING_UNITS.includes(normUnit);

  if (isPackaging) {
    // Look for a product whose name contains this specific unit word (e.g. "bag" in "Aashirvaad Salt 1kg Bag")
    const nameMatch = familyProducts.find(p => {
      const nameLower = p.display_name.toLowerCase();
      // Ensure it matches as a word boundary, e.g. \bbag\b
      const regex = new RegExp(`\\b${normUnit}s?\\b`, 'i');
      return regex.test(nameLower);
    });
    if (nameMatch) return nameMatch;

    // Or look by category mapping
    const catMatch = familyProducts.find(p => {
      if (!p.category_id) return false;
      return (
        (p.category_id === 3 && normUnit === 'carton') ||
        (p.category_id === 3 && (normUnit === 'pudha' || normUnit === 'puda')) ||
        (p.category_id === 4 && normUnit === 'bag') ||
        (p.category_id === 5 && normUnit === 'tray') ||
        (p.category_id === 7 && normUnit === 'sheet')
      );
    });
    if (catMatch) return catMatch;
  }

  // 2. Second priority: If requested unit is 'piece' or similar base unit, find the product that does NOT contain other bulk packaging words in its name
  if (normUnit === 'piece' || normUnit === 'pieces') {
    const bulkUnits = ['bag', 'bags', 'carton', 'cartons', 'cartoon', 'cartoons', 'tray', 'trays'];
    const nonBulkMatch = familyProducts.find(p => {
      const nameLower = p.display_name.toLowerCase();
      return !bulkUnits.some(bulk => {
        const regex = new RegExp(`\\b${bulk}\\b`, 'i');
        return regex.test(nameLower);
      });
    });
    if (nonBulkMatch) return nonBulkMatch;
  }

  // 3. Third priority: Exact match in product.units list
  const exactUnitMatch = familyProducts.find(p =>
    p.units?.some(u => u.unit_name && u.unit_name.toLowerCase() === normUnit)
  );
  if (exactUnitMatch) return exactUnitMatch;

  // 4. Fourth priority: Fallback to the product with the lowest retail price
  if (familyProducts.length > 0) {
    return [...familyProducts].sort((a, b) => a.retail_price - b.retail_price)[0];
  }

  return undefined;
}



// Helper to resolve quantity, pricing, and packaging unit based on spoken/requested units
export function resolveUnitAndPrice(
  product: Product,
  quantity: number,
  unitName?: string
): { resolvedUnit: string; resolvedQuantity: number; resolvedPrice: number; resolvedWholesalePrice: number } {
  // Helper to get fallback ratio wholesale price
  const getWholesaleFallback = (retail: number) => {
    const ratio = product.retail_price > 0 ? product.wholesale_price / product.retail_price : 1;
    return retail * ratio;
  };

  // ── WEIGHT (category_id=1) or VOLUME (category_id=2) ────────────────────────────
  // PRD Formula: price = (requested_qty_in_base ÷ reference_qty_in_base) × reference_price
  // Base units: GRAM (for weight), ML (for volume).
  // Examples:
  //   Stored: 500g = ₹20 → reference_qty_in_grams=500, reference_price=20
  //   Ask 20g:   (20 / 500) × 20 = ₹0.80   → resolvedPrice=0.04/g, qty=20, total=0.80
  //   Ask 1 KG:  (1000 / 500) × 20 = ₹40   → resolvedPrice=40/KG, qty=1, total=40
  //   Ask 2 KG:  (2000 / 500) × 20 = ₹80   → resolvedPrice=40/KG, qty=2, total=80
  if (product.category_id === 1 || product.category_id === 2) {
    const isWeight = product.category_id === 1;

    // ── Convert any stored unit entry to its base quantity in GRAM or ML ─────────
    const toBaseQty = (storedQty: number, storedUnitName: string): number => {
      const un = (storedUnitName || '').toLowerCase().trim();
      // If stored as KG → multiply by 1000 to get grams
      if (un === 'kg' || un === 'kgs' || un === 'kilo' || un === 'kilos' || un === 'kilogram' || un === 'kilograms') {
        return storedQty * 1000;
      }
      // If stored as Litre → multiply by 1000 to get ML
      if (un === 'litre' || un === 'litres' || un === 'l' || un === 'liter' || un === 'liters') {
        return storedQty * 1000;
      }
      // Gram or ML — stored quantity IS already in base unit
      if (un === 'gram' || un === 'grams' || un === 'g' || un === 'gm' || un === 'gms' || un === 'grm' || un === 'grms') {
        return storedQty;
      }
      if (un === 'ml' || un === 'mls' || un === 'milliliter' || un === 'milliliters') {
        return storedQty;
      }
      // Unknown unit — treat stored quantity as grams/ML (base unit fallback)
      return storedQty;
    };


    // ── Find reference entry (the unit row that has the base price) ───────────────
    // Use the first unit entry in the product's units array as the price reference.
    const getReferenceEntry = (): { refQtyInBase: number; refPrice: number; refWholesale: number } => {
      const units = product.units;
      if (!units || units.length === 0) {
        // Legacy product: retail_price is assumed to be price per KG or per Litre
        return {
          refQtyInBase: 1000, // treat as 1 KG = 1000g (or 1 Litre = 1000ml)
          refPrice: product.retail_price,
          refWholesale: product.wholesale_price
        };
      }
      // Pick the first unit entry as the reference
      const ref = units[0];
      const refQtyInBase = toBaseQty(ref.quantity, ref.unit_name);
      return {
        refQtyInBase: refQtyInBase > 0 ? refQtyInBase : 1,
        refPrice: ref.price,
        refWholesale: ref.wholesale_price ?? getWholesaleFallback(ref.price)
      };
    };

    const { refQtyInBase, refPrice, refWholesale } = getReferenceEntry();
    const normalizedUnit = unitName ? unitName.toLowerCase().trim() : '';

    // ── Compute price for requested qty/unit using ratio formula ─────────────────
    // resolvedPrice = price per ONE of the resolved unit
    //   e.g. if resolvedUnit='Gram', resolvedPrice = price per 1 gram
    //        if resolvedUnit='KG',   resolvedPrice = price per 1 KG
    // total (in cart) = resolvedQuantity × resolvedPrice

    const isGramRequest = ['gram','grams','g','gm','gms','grm','grms'].includes(normalizedUnit);
    const isMLRequest = ['ml','mls','milliliter','milliliters'].includes(normalizedUnit);
    const isKGRequest = ['kg','kgs','kilo','kilos','kilogram','kilograms'].includes(normalizedUnit);
    const isLitreRequest = ['litre','litres','l','liter','liters'].includes(normalizedUnit);

    if (isGramRequest) {
      // price per 1 gram = (1 / refQtyInBase) × refPrice
      const pricePerGram = refPrice / refQtyInBase;
      const wsPerGram = refWholesale / refQtyInBase;
      return { resolvedUnit: 'Gram', resolvedQuantity: quantity, resolvedPrice: pricePerGram, resolvedWholesalePrice: wsPerGram };
    }

    if (isMLRequest) {
      // price per 1 ML = (1 / refQtyInBase) × refPrice
      const pricePerML = refPrice / refQtyInBase;
      const wsPerML = refWholesale / refQtyInBase;
      return { resolvedUnit: 'ML', resolvedQuantity: quantity, resolvedPrice: pricePerML, resolvedWholesalePrice: wsPerML };
    }

    if (isKGRequest) {
      // price per 1 KG = (1000 / refQtyInBase) × refPrice
      const pricePerKG = (refPrice / refQtyInBase) * 1000;
      const wsPerKG = (refWholesale / refQtyInBase) * 1000;
      return { resolvedUnit: 'KG', resolvedQuantity: quantity, resolvedPrice: pricePerKG, resolvedWholesalePrice: wsPerKG };
    }

    if (isLitreRequest) {
      // price per 1 Litre = (1000 / refQtyInBase) × refPrice
      const pricePerLitre = (refPrice / refQtyInBase) * 1000;
      const wsPerLitre = (refWholesale / refQtyInBase) * 1000;
      return { resolvedUnit: 'Litre', resolvedQuantity: quantity, resolvedPrice: pricePerLitre, resolvedWholesalePrice: wsPerLitre };
    }

    // No unit specified or unknown unit → use the product's registered unit
    if (!normalizedUnit) {
      const regUnit = product.units?.[0];
      if (regUnit) {
        const un = (regUnit.unit_name || '').toLowerCase();
        const isKG = un === 'kg' || un === 'kgs' || un === 'kilo';
        const isLitre = un === 'litre' || un === 'litres' || un === 'l' || un === 'liter';
        if (isKG) {
          const pricePerKG = (refPrice / refQtyInBase) * 1000;
          return { resolvedUnit: 'KG', resolvedQuantity: quantity, resolvedPrice: pricePerKG, resolvedWholesalePrice: (refWholesale / refQtyInBase) * 1000 };
        }
        if (isLitre) {
          const pricePerLitre = (refPrice / refQtyInBase) * 1000;
          return { resolvedUnit: 'Litre', resolvedQuantity: quantity, resolvedPrice: pricePerLitre, resolvedWholesalePrice: (refWholesale / refQtyInBase) * 1000 };
        }
        // Gram or ML default
        const defaultUnit = isWeight ? 'KG' : 'Litre';
        const pricePerDefault = (refPrice / refQtyInBase) * 1000;
        return { resolvedUnit: defaultUnit, resolvedQuantity: quantity, resolvedPrice: pricePerDefault, resolvedWholesalePrice: (refWholesale / refQtyInBase) * 1000 };
      }
      const defaultUnit = isWeight ? 'KG' : 'Litre';
      const pricePerDefault = (refPrice / refQtyInBase) * 1000;
      return { resolvedUnit: defaultUnit, resolvedQuantity: quantity, resolvedPrice: pricePerDefault, resolvedWholesalePrice: (refWholesale / refQtyInBase) * 1000 };
    }

    // Unknown unit string — fallback to base unit
    const defaultUnit = isWeight ? 'KG' : 'Litre';
    const pricePerDefault = (refPrice / refQtyInBase) * 1000;
    return { resolvedUnit: defaultUnit, resolvedQuantity: quantity, resolvedPrice: pricePerDefault, resolvedWholesalePrice: (refWholesale / refQtyInBase) * 1000 };
  }



  // If no unitName is provided, default to the first unit pricing package or standard category unit
  if (!unitName) {
    if (product.units && product.units.length > 0) {
      const defUnit = product.units[0];
      return {
        resolvedUnit: defUnit.unit_name,
        resolvedQuantity: quantity,
        resolvedPrice: defUnit.price,
        resolvedWholesalePrice: defUnit.wholesale_price ?? getWholesaleFallback(defUnit.price)
      };
    }
    const isWeight = product.category_id === 1;
    const isVolume = product.category_id === 2;
    
    let resolvedUnit = 'Piece';
    if (isWeight) {
      resolvedUnit = 'KG';
    } else if (isVolume) {
      resolvedUnit = 'Litre';
    } else {
      const nameLower = product.display_name.toLowerCase();
      if (nameLower.includes('bag')) resolvedUnit = 'Bag';
      else if (nameLower.includes('carton') || nameLower.includes('cartoon')) resolvedUnit = 'Carton';
      else if (nameLower.includes('pudha') || nameLower.includes('puda')) resolvedUnit = 'Pudha';
      else if (nameLower.includes('tray')) resolvedUnit = 'Tray';
      else if (nameLower.includes('sheet')) resolvedUnit = 'Sheet';
    }

    return {
      resolvedUnit,
      resolvedQuantity: quantity,
      resolvedPrice: product.retail_price,
      resolvedWholesalePrice: product.wholesale_price
    };
  }

  const normalizedUnit = unitName.toLowerCase();

  // Packaging unit names that should ONLY be matched by name, never by quantity.
  // This prevents e.g. "Piece" (qty=1) being returned when "Bag" (qty=1) is requested.
  const PACKAGING_UNIT_NAMES = new Set([
    'piece', 'pieces', 'bag', 'bags', 'carton', 'cartons', 'cartoon', 'cartoons',
    'tray', 'trays', 'sheet', 'sheets',
    'pudha', 'pudhas', 'puda', 'pudas', 'pooda', 'poodas'
  ]);
  const isPackagingUnit = PACKAGING_UNIT_NAMES.has(normalizedUnit);

  // 1. If unitName matches one of the product's custom packaging units exactly, use it directly
  const exactNameMatch = product.units?.find(u => u.unit_name && u.unit_name.toLowerCase() === normalizedUnit);
  if (exactNameMatch) {
    return {
      resolvedUnit: exactNameMatch.unit_name,
      resolvedQuantity: quantity,
      resolvedPrice: exactNameMatch.price,
      resolvedWholesalePrice: exactNameMatch.wholesale_price ?? getWholesaleFallback(exactNameMatch.price)
    };
  }

  // For explicitly named packaging units that were NOT found by name-match above,
  // do NOT fall through to quantity-based matching (which could incorrectly return
  // a different unit type, e.g. returning "Piece" when "Bag" was requested, just
  // because both have quantity=1). Return retail price with the requested unit name.
  if (isPackagingUnit && product.units && product.units.length > 0) {
    const capitalised = unitName.charAt(0).toUpperCase() + unitName.slice(1);
    return {
      resolvedUnit: capitalised,
      resolvedQuantity: quantity,
      resolvedPrice: product.retail_price,
      resolvedWholesalePrice: product.wholesale_price
    };
  }

  let resolvedUnit = unitName;
  let resolvedQuantity = quantity;
  let resolvedPrice = product.retail_price;
  let resolvedWholesalePrice = product.wholesale_price;

  if (product.units && product.units.length > 0) {
    // Calculate equivalent quantity in base unit
    let quantityInBase = quantity;
    if (normalizedUnit === 'gram' || normalizedUnit === 'g' || normalizedUnit === 'grams') {
      quantityInBase = quantity / 1000;
    } else if (normalizedUnit === 'ml' || normalizedUnit === 'mls') {
      quantityInBase = quantity / 1000;
    }

    // 2. Try exact quantity match — only for weight/volume units, not packaging names
    //    (packaging units are already handled above by name matching only)
    const exactUnit = !isPackagingUnit
      ? product.units.find(u => Math.abs(u.quantity - quantityInBase) < 0.0001)
      : undefined;
    if (exactUnit) {
      resolvedUnit = exactUnit.unit_name;
      resolvedQuantity = 1;
      resolvedPrice = exactUnit.price;
      resolvedWholesalePrice = exactUnit.wholesale_price ?? getWholesaleFallback(exactUnit.price);
    } else {
      // 3. Try base unit (quantity 1.0) scaling
      const baseUnit = product.units.find(u => u.quantity === 1.0);
      if (baseUnit && (normalizedUnit === 'kg' || normalizedUnit === 'kgs' || normalizedUnit === 'litre' || normalizedUnit === 'litres' || normalizedUnit === 'l')) {
        resolvedUnit = baseUnit.unit_name;
        resolvedQuantity = quantityInBase;
        resolvedPrice = baseUnit.price;
        resolvedWholesalePrice = baseUnit.wholesale_price ?? getWholesaleFallback(baseUnit.price);
      } else {
        // 4. Try multiples of packages
        const sortedUnits = [...product.units].sort((a, b) => b.quantity - a.quantity);
        let matched = false;
        for (const u of sortedUnits) {
          if (quantityInBase >= u.quantity && Math.abs((quantityInBase % u.quantity)) < 0.0001) {
            resolvedUnit = u.unit_name;
            resolvedQuantity = quantityInBase / u.quantity;
            resolvedPrice = u.price;
            resolvedWholesalePrice = u.wholesale_price ?? getWholesaleFallback(u.price);
            matched = true;
            break;
          }
        }

        // 5. Fallback to base unit if present, else scale base retail price
        if (!matched) {
          if (baseUnit) {
            resolvedUnit = baseUnit.unit_name;
            resolvedQuantity = quantityInBase;
            resolvedPrice = baseUnit.price;
            resolvedWholesalePrice = baseUnit.wholesale_price ?? getWholesaleFallback(baseUnit.price);
          } else {
            resolvedQuantity = quantityInBase;
            resolvedPrice = product.retail_price;
            resolvedWholesalePrice = product.wholesale_price;
          }
        }
      }
    }
  } else {
    // Check for unit conversions
    const conversion = product.unit_conversions?.find(c => c.child_unit.toLowerCase() === normalizedUnit);
    if (conversion) {
      resolvedPrice = product.retail_price / conversion.conversion_factor;
      resolvedWholesalePrice = product.wholesale_price / conversion.conversion_factor;
      resolvedUnit = unitName;
    } else if (normalizedUnit === 'gram' || normalizedUnit === 'g' || normalizedUnit === 'grams') {
      resolvedPrice = product.retail_price / 1000;
      resolvedWholesalePrice = product.wholesale_price / 1000;
      resolvedUnit = 'Gram';
    } else if (normalizedUnit === 'ml' || normalizedUnit === 'mls') {
      resolvedPrice = product.retail_price / 1000;
      resolvedWholesalePrice = product.wholesale_price / 1000;
      resolvedUnit = 'ML';
    }
  }

  const finalUnit = resolvedUnit ? (
    resolvedUnit.toLowerCase() === 'kg' || resolvedUnit.toLowerCase() === 'kgs' ? 'KG' : 
    resolvedUnit.toLowerCase() === 'g' || resolvedUnit.toLowerCase() === 'gram' || resolvedUnit.toLowerCase() === 'grams' ? 'Gram' : 
    resolvedUnit.toLowerCase() === 'litre' || resolvedUnit.toLowerCase() === 'litres' || resolvedUnit.toLowerCase() === 'l' ? 'Litre' : 
    resolvedUnit.toLowerCase() === 'ml' || resolvedUnit.toLowerCase() === 'mls' ? 'ML' : 
    resolvedUnit.charAt(0).toUpperCase() + resolvedUnit.slice(1)
  ) : 'Piece';

  return {
    resolvedUnit: finalUnit,
    resolvedQuantity,
    resolvedPrice,
    resolvedWholesalePrice
  };
}

export const useStore = create<POSState>((set, get) => ({
  currentScreen: 'home',
  deviceStatus: 'approved',
  trustedToken: '',
  storeName: 'Sai Ram Kirana',
  upiId: DEFAULT_UPI_QR_PAYLOAD,
  syncQueueCount: 0,
  isSyncing: false,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isDatabaseInitialized: false,
  showSyncPopup: false,
  syncProgressText: '',
  syncCurrentCount: 0,
  syncTotalCount: 0,
  products: [],
  customers: [],
  khataRecords: [],
  activeBill: {
    customer_name: 'Customer',
    customer_phone: 'NA',
    items: [],
    subtotal: 0,
    discount: 0,
    grand_total: 0,
    payment_mode: 'Cash'
  },
  draftRecoverable: false,
  pendingVoiceCache: [],
  pendingCheckoutBill: null,
  printerConnected: false,
  printerStatus: 'Disconnected',
  pairedPrinters: [],
  isScanning: false,
  autoConnect: true,
  printJobStatus: null as PrintJobStatus | null,
  printJobId: null as number | null,
  showPrintingProgressModal: false,
  printingStatusText: 'Connecting...' as 'Connecting...' | 'Printing...' | 'Success',
  printerConfig: {
    printer_name: 'BlueTooth Printer',
    printer_mac: 'DC:0D:30:06:49:9C',
    upi_id: DEFAULT_UPI_QR_PAYLOAD,
    merchant_name: 'Sai Ram Kirana'
  },
  voiceContext: 'default',
  isListening: false,
  voiceTranscript: '',

  initApp: async () => {
    await db.init();
    
    // Default to 'approved' so the app never gets stuck on the launch/registration
    // screen if the local DB was cleared. This is a standalone shop POS — no remote
    // admin approval step is needed.
    const rawStatus = db.getSetting('device_status') as POSState['deviceStatus'];

    // If was unregistered, store approved immediately so it persists
    if (!rawStatus) {
      db.setSetting('device_status', 'approved');
    }
    const token = db.getSetting('trusted_token');
    const store_name = db.getSetting('store_name', 'Sai Ram Kirana');
    let upi_id = db.getSetting('upi_id', DEFAULT_UPI_QR_PAYLOAD);
    if (!upi_id || upi_id === LEGACY_DEFAULT_UPI_ID) {
      upi_id = DEFAULT_UPI_QR_PAYLOAD;
      db.setSetting('upi_id', upi_id);
    }

    const printer_name = db.getSetting('printer_name') || 'BlueTooth Printer';
    const printer_mac = db.getSetting('printer_mac') || 'DC:0D:30:06:49:9C';
    const auto_connect_raw = db.getSetting('auto_connect', 'true');
    const auto_connect = auto_connect_raw === 'true';

    // Check draft - only recover if it has items
    const draft = db.getDraft();
    const hasDraftItems = draft && draft.items && draft.items.length > 0;

    const upi_qr_image = db.getSetting('upi_qr_image', '');
    const qr_size = parseInt(db.getSetting('qr_size', '10'), 10) || 10;
    
    const isInitialized = db.getSetting('local_database_initialized') === 'true';

    set({
      deviceStatus: 'approved',
      trustedToken: token,
      storeName: store_name,
      upiId: upi_id,
      draftRecoverable: !!hasDraftItems,
      printerConnected: !!printer_mac,
      autoConnect: auto_connect,
      printerStatus: 'Disconnected',
      printerConfig: {
        printer_name,
        printer_mac,
        upi_id,
        merchant_name: store_name,
        upi_qr_image: upi_qr_image || undefined,
        qr_size: qr_size
      },
      currentScreen: 'home',
      isDatabaseInitialized: isInitialized
    });

    syncEngine.registerOnSyncComplete(() => {
      if (db.getSetting('local_database_initialized') === 'true') {
        get().loadStoreData().catch(() => {});
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('printer-disconnected', () => {
        set({ printerStatus: 'Disconnected', printerConnected: false });
        releasePrinterHost(getMyDeviceId()).catch(err => console.error('[PrinterHost] Failed to release host after disconnect:', err));
      });
      window.addEventListener('printer-connected', () => {
        set({ printerStatus: 'Connected', printerConnected: true });
        const mac = get().printerConfig.printer_mac;
        if (mac) {
          claimPrinterHost(getMyDeviceId(), mac).catch(err => console.error('[PrinterHost] Failed to claim host after reconnect:', err));
        }
      });
    }

    if (isInitialized) {
      await get().loadStoreData();
    }

    if (auto_connect && printer_mac) {
      get().connectPrinter(printer_mac, printer_name);
    }
  },

  initialDeviceSetup: async (onProgress) => {
    if (!db.supabase) {
      throw new Error('Supabase client is not configured.');
    }
    
    set({ isSyncing: true });
    try {
      const tables = [
        { name: 'categories', localKey: 'sr_categories' },
        { name: 'catalog_categories', localKey: 'sr_catalog_categories' },
        { name: 'product_categories', localKey: 'sr_product_categories' },
        { name: 'products', localKey: 'sr_products' },
        { name: 'barcodes', localKey: 'sr_barcodes' },
        { name: 'product_aliases', localKey: 'sr_product_aliases' },
        { name: 'units', localKey: 'sr_units' },
        { name: 'voice_phrase_cache', localKey: 'sr_voice_cache' },
        { name: 'voice_memory', localKey: 'sr_voice_memory' },
        { name: 'voice_corrections', localKey: 'sr_voice_corrections' }
      ];

      // Download all setup tables in parallel (Promise.all)
      // This is much faster and shows live progress on all items at once.
      const downloadTable = async (table: typeof tables[0]) => {
        onProgress(table.name, 0, 100);

        let total = 0;
        let allData: any[] = [];
        let offset = 0;
        const limit = 1000;
        let finished = false;

        while (!finished) {
          // Fetch page by page, asking for exact count in response headers
          const { data, count, error: fetchErr } = await db.supabase!
            .from(table.name)
            .select('*', { count: 'exact' })
            .range(offset, offset + limit - 1);

          if (fetchErr) {
            throw new Error(`Failed to download ${table.name}: ${fetchErr.message}`);
          }

          if (count !== null) {
            total = count;
          }

          if (!data || data.length === 0) {
            finished = true;
          } else {
            allData = [...allData, ...data];
            offset += data.length;
            onProgress(table.name, allData.length, Math.max(total, allData.length));
            if (data.length < limit) {
              finished = true;
            }
          }
        }

        // Save table locally
        db.saveList(table.localKey, allData);
      };

      for (const t of tables) {
        await downloadTable(t);
        await new Promise(resolve => setTimeout(resolve, 30));
      }


      // Mark database initialized
      db.setSetting('local_database_initialized', 'true');
      
      // Rebuild indexes
      await db.rebuildProductsCache();
      
      set({ isDatabaseInitialized: true });
      await get().loadStoreData();
    } catch (err) {
      console.error('[SetupWizard] Initial setup failed:', err);
      throw err;
    } finally {
      set({ isSyncing: false });
    }
  },

  setScreen: (screen) => {
    // Set voice context dynamically based on screen name
    let voiceCtx: POSState['voiceContext'] = 'default';
    if (screen === 'new_bill') voiceCtx = 'new_bill';
    else if (screen === 'products') voiceCtx = 'products';
    else if (screen === 'history') voiceCtx = 'history';
    else if (screen === 'khata') voiceCtx = 'khata';

    // Update browser URL hash to build navigation sessions for hardware back button support
    if (typeof window !== 'undefined') {
      const validScreens = ['home', 'new_bill', 'products', 'barcode', 'history', 'khata', 'settings', 'reports', 'system_barcodes'];
      if (validScreens.includes(screen)) {
        window.location.hash = `#/${screen}`;
      } else {
        window.location.hash = '';
      }
    }

    set({ currentScreen: screen, voiceContext: voiceCtx });
    get().loadStoreData();
  },

  checkDeviceStatus: async () => {
    const devId = db.getSetting('device_id');
    if (!devId) return;

    try {
      const res = await fetch('/api/devices');
      const devicesList = await res.json();
      const remoteDevice = devicesList.find((d: any) => d.device_id === devId);

      if (remoteDevice) {
        const status = remoteDevice.status;
        if (status === 'approved') {
          const token = 'TOKEN-' + Math.floor(Math.random() * 900000 + 100000);
          db.setSetting('device_status', 'approved');
          db.setSetting('trusted_token', token);

          set({ 
            deviceStatus: 'approved', 
            trustedToken: token,
            currentScreen: 'home' 
          });
          await get().loadStoreData();
        } else if (status === 'rejected') {
          db.setSetting('device_status', 'rejected');
          set({ deviceStatus: 'rejected' });
        } else if (status === 'revoked') {
          db.setSetting('device_status', 'revoked');
          db.setSetting('trusted_token', '');
          set({ deviceStatus: 'revoked', trustedToken: '' });
        }
      }
    } catch (err) {
      console.error("Error checking device status", err);
    }
  },

  registerDevice: async (deviceName, password) => {
    // Check initial password from seed/settings
    const adminPass = db.getSetting('admin_password', 'Sairam@123');
    if (password !== adminPass) {
      return false;
    }

    // Set mock local registration details
    const devId = 'DEV-' + Math.floor(Math.random() * 900000 + 100000);
    db.setSetting('device_id', devId);
    db.setSetting('device_name', deviceName);
    db.setSetting('device_status', 'pending');

    // Mock a stable MAC address based on device ID or default mock mac
    const mockMac = '00:1A:2B:3C:4D:' + devId.slice(4).padStart(2, '0');

    const newDevice = {
      id: devId,
      device_id: devId,
      device_name: deviceName,
      android_version: '15',
      app_version: '1.0.0',
      manufacturer: 'Samsung',
      status: 'pending',
      mac_address: mockMac,
      requested_at: new Date().toISOString()
    };

    // Push to client localStorage for fallback
    const devicesList = JSON.parse(localStorage.getItem('admin_devices') || '[]');
    const existingIdx = devicesList.findIndex((d: any) => d.device_id === devId || d.mac_address === mockMac);
    if (existingIdx !== -1) {
      devicesList[existingIdx] = {
        ...devicesList[existingIdx],
        device_name: deviceName,
        requested_at: new Date().toISOString()
      };
    } else {
      devicesList.push(newDevice);
    }
    localStorage.setItem('admin_devices', JSON.stringify(devicesList));

    // Register on the shared server API
    try {
      await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          device: newDevice
        })
      });
    } catch (err) {
      console.error("Error registering device on server", err);
    }

    set({ deviceStatus: 'pending', currentScreen: 'approval' });
    return true;
  },

  loadStoreData: async () => {
    const products = await db.getProducts();
    const customers = await db.getCustomers();
    const khataRecords = await db.getKhataBalances();
    const queue = db.getSyncQueue();

    set({
      products,
      customers,
      khataRecords,
      syncQueueCount: queue.filter(q => q.status === 'pending' || q.status === 'failed').length
    });
  },

  // ----------------------------------------------------
  // BILLING OPERATIONS
  // ----------------------------------------------------
  startNewBill: (name = 'Customer', phone = 'NA') => {
    set({
      activeBill: {
        customer_name: name,
        customer_phone: phone,
        items: [],
        subtotal: 0,
        discount: 0,
        grand_total: 0,
        payment_mode: 'Cash'
      },
      pendingVoiceCache: []
    });
    db.clearDraft();
  },

  setCustomer: (id, name = 'Customer', phone = 'NA') => {
    set(state => {
      const updated = {
        ...state.activeBill,
        customer_id: id,
        customer_name: name,
        customer_phone: phone
      };
      return { activeBill: updated };
    });
    get().saveDraftBill();
  },

  addItem: (product, quantity, unitName) => {
    const active = get().activeBill;
    const items = [...active.items];

    // Resolve unit details using PRD formula
    const { resolvedUnit, resolvedQuantity, resolvedPrice } = resolveUnitAndPrice(product, quantity, unitName);

    // ── Smart merge for Weight (cat=1) and Volume (cat=2) products ──────────────
    // Regardless of unit (KG vs Gram, Litre vs ML), we merge the same product
    // by converting everything to base units (Gram/ML), summing, then choosing
    // the best display unit automatically.
    if (product.category_id === 1 || product.category_id === 2) {
      const isWeight = product.category_id === 1;

      // Convert a qty+unit pair to base units (Gram or ML)
      const toBase = (qty: number, unit: string): number => {
        const un = (unit || '').toLowerCase().trim();
        if (un === 'kg' || un === 'kgs' || un === 'kilo' || un === 'kilos') return qty * 1000;
        if (un === 'litre' || un === 'litres' || un === 'l' || un === 'liter' || un === 'liters') return qty * 1000;
        return qty; // Gram or ML — already in base
      };

      const existingIdx = items.findIndex(i => i.product_id === product.id);

      if (existingIdx !== -1) {
        // Existing item found — merge in base units
        const existingItem = items[existingIdx];
        const existingBase = toBase(existingItem.quantity, existingItem.unit);
        const newBase = toBase(resolvedQuantity, resolvedUnit);
        const totalBase = existingBase + newBase;

        // Choose display unit: KG/Litre if ≥ 1000, else Gram/ML
        let displayUnit: string;
        let displayQty: number;
        let displayPrice: number;

        if (totalBase >= 1000) {
          displayUnit = isWeight ? 'KG' : 'Litre';
          displayQty = parseFloat((totalBase / 1000).toFixed(4));
          const { resolvedPrice: p } = resolveUnitAndPrice(product, 1, displayUnit);
          displayPrice = p;
        } else {
          displayUnit = isWeight ? 'Gram' : 'ML';
          displayQty = parseFloat(totalBase.toFixed(2));
          const { resolvedPrice: p } = resolveUnitAndPrice(product, 1, displayUnit);
          displayPrice = p;
        }

        items[existingIdx] = {
          ...existingItem,
          quantity: displayQty,
          unit: displayUnit,
          price: displayPrice,
          total: parseFloat((displayQty * displayPrice).toFixed(2))
        };
      } else {
        // First time this product is added
        const itemTotal = parseFloat((resolvedPrice * resolvedQuantity).toFixed(2));
        items.push({
          product_id: product.id,
          product_name: product.display_name,
          quantity: resolvedQuantity,
          unit: resolvedUnit,
          price: resolvedPrice,
          total: itemTotal
        });
      }
    } else {
      // ── Non-weight/volume: standard unit-exact merge ─────────────────────────
      const itemTotal = resolvedPrice * resolvedQuantity;
      const existingIdx = items.findIndex(i => i.product_id === product.id && i.unit.toLowerCase() === resolvedUnit.toLowerCase());
      if (existingIdx !== -1) {
        items[existingIdx].quantity += resolvedQuantity;
        items[existingIdx].total = items[existingIdx].quantity * items[existingIdx].price;
      } else {
        items.push({
          product_id: product.id,
          product_name: product.display_name,
          quantity: resolvedQuantity,
          unit: resolvedUnit,
          price: resolvedPrice,
          total: itemTotal
        });
      }
    }


    // Calculate subtotal
    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const grand_total = Math.max(0, subtotal - active.discount);

    set({
      activeBill: {
        ...active,
        items,
        subtotal,
        grand_total
      }
    });

    get().saveDraftBill();
    playAddProductBeep();
  },

  removeItem: (productId) => {
    const active = get().activeBill;
    const items = active.items.filter(i => i.product_id !== productId);
    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const grand_total = Math.max(0, subtotal - active.discount);

    set({
      activeBill: {
        ...active,
        items,
        subtotal,
        grand_total
      }
    });
    get().saveDraftBill();
  },

  editItem: (productId, quantity, unitName, priceOverride, nameOverride, originalUnit) => {
    const active = get().activeBill;
    const product = get().products.find(p => p.id === productId);
    const allProducts = get().products;

    // Reuses the exported getBaseBrandName function

    const items = active.items.map(item => {
      const isMatch = originalUnit 
        ? (item.product_id === productId && item.unit.toLowerCase() === originalUnit.toLowerCase())
        : (item.product_id === productId);

      if (isMatch) {
        const unit = unitName || item.unit;
        const unitChanged = unit.toLowerCase() !== item.unit.toLowerCase();
        
        let price = item.price;
        let qty = quantity;
        let resolvedProductId = productId;
        let resolvedProductName = nameOverride || item.product_name;
        let finalResolvedUnit = unit;

        if (product) {
          if (unitChanged) {
            const currentBase = getBaseBrandName(product.display_name);
            const familyProducts = allProducts.filter(p => getBaseBrandName(p.display_name) === currentBase);
            const targetProduct = findProductInFamilyForUnit(familyProducts, unit);

            if (targetProduct) {
              resolvedProductId = targetProduct.id;
              resolvedProductName = targetProduct.display_name;
              const resolved = resolveUnitAndPrice(targetProduct, quantity, unit);
              finalResolvedUnit = resolved.resolvedUnit;
              if (priceOverride === undefined) {
                price = resolved.resolvedPrice;
                qty = resolved.resolvedQuantity;
              } else {
                price = priceOverride;
                qty = quantity;
              }
            } else {
              // Fallback (resolve within current product)
              const resolved = resolveUnitAndPrice(product, quantity, unit);
              finalResolvedUnit = resolved.resolvedUnit;
              if (priceOverride === undefined) {
                price = resolved.resolvedPrice;
                qty = resolved.resolvedQuantity;
              } else {
                price = priceOverride;
                qty = quantity;
              }

              // Adjust name based on unit if not already present
              const baseProdName = product.display_name;
              const unitLower = unit.toLowerCase();
              if (!baseProdName.toLowerCase().includes(unitLower)) {
                const cleanName = baseProdName
                  .replace(/\s*\((?:piece|pcs)\)/gi, '')
                  .replace(/\s+\b(?:piece|pieces)\b/gi, '');
                resolvedProductName = `${cleanName} ${unitLower}`;
              } else {
                resolvedProductName = baseProdName;
              }
            }
          } else {
            // If unit didn't change, we still resolve/normalize it
            const resolved = resolveUnitAndPrice(product, quantity, unit);
            finalResolvedUnit = resolved.resolvedUnit;
            if (priceOverride !== undefined) {
              price = priceOverride;
            } else {
              price = item.price;
            }
          }
        } else {
          if (priceOverride !== undefined) {
            price = priceOverride;
          }
        }

        const name = resolvedProductName;
        const total = price * qty;
        return { ...item, product_id: resolvedProductId, product_name: name, quantity: qty, unit: finalResolvedUnit, price, total };
      }
      return item;
    });

    // Merge duplicates if any resolvedProductId clashes
    const mergedItems: typeof items = [];
    items.forEach(itm => {
      const match = mergedItems.find(mi => mi.product_id === itm.product_id && mi.unit.toLowerCase() === itm.unit.toLowerCase());
      if (match) {
        match.quantity += itm.quantity;
        match.total = match.quantity * match.price;
      } else {
        mergedItems.push(itm);
      }
    });

    const subtotal = mergedItems.reduce((sum, item) => sum + item.total, 0);
    const grand_total = Math.max(0, subtotal - active.discount);

    set({
      activeBill: {
        ...active,
        items: mergedItems,
        subtotal,
        grand_total
      }
    });
    get().saveDraftBill();
  },

  addPendingVoiceMapping: (phrase, productId, quantity, unit, action) => {
    const pending = get().pendingVoiceCache;
    const cleanPhrase = phrase.toLowerCase().trim();
    const filtered = pending.filter(p => p.phrase.toLowerCase().trim() !== cleanPhrase);
    filtered.push({ phrase, product_id: productId, quantity, unit, action });
    set({ pendingVoiceCache: filtered });
  },

  setDiscount: (discount) => {
    set(state => {
      const subtotal = state.activeBill.subtotal;
      const grand_total = Math.max(0, subtotal - discount);
      return {
        activeBill: {
          ...state.activeBill,
          discount,
          grand_total
        }
      };
    });
    get().saveDraftBill();
  },

  setPaymentMode: (mode) => {
    set(state => ({
      activeBill: { ...state.activeBill, payment_mode: mode }
    }));
    get().saveDraftBill();
  },

  saveDraftBill: () => {
    const active = get().activeBill;
    db.saveDraft(active);
    const hasItems = active.items && active.items.length > 0;
    set({ draftRecoverable: hasItems });
  },

  recoverDraftBill: () => {
    const draft = db.getDraft();
    if (draft) {
      set({ activeBill: draft, draftRecoverable: false });
    }
  },

  discardDraftBill: () => {
    db.clearDraft();
    set({ draftRecoverable: false, pendingVoiceCache: [] });
    get().startNewBill();
  },

  checkoutAndPrint: async () => {
    const active = get().activeBill;
    if (active.items.length === 0) return null;

    // Check credit validation
    if (active.payment_mode === 'Credit') {
      const hasName = active.customer_name && active.customer_name.trim() !== 'Customer' && active.customer_name.trim() !== '';
      const hasPhone = active.customer_phone && active.customer_phone.trim() !== 'NA' && active.customer_phone.trim() !== '';
      if (!hasName && !hasPhone) {
        throw new Error('Please enter either a Customer Name or Phone Number to save this bill under Khata.');
      }
    }

    // Save customer if doesn't exist
    const hasName = active.customer_name && active.customer_name.trim() !== 'Customer' && active.customer_name.trim() !== '';
    const hasPhone = active.customer_phone && active.customer_phone.trim() !== 'NA' && active.customer_phone.trim() !== '';
    let resolvedCustomerId: number | undefined = active.customer_id;
    let resolvedCustomerName: string = active.customer_name;
    let resolvedCustomerPhone: string = active.customer_phone;

    if (hasName || hasPhone) {
      let match = null;
      if (hasPhone) {
        match = await db.findCustomerByPhone(active.customer_phone);
      }
      if (!match && hasName) {
        const allCusts = await db.getCustomers();
        match = allCusts.find(c => c.name.toLowerCase() === active.customer_name.toLowerCase()) || null;
      }

      if (!match) {
        const finalName = hasName ? active.customer_name.trim() : `Customer-${active.customer_phone}`;
        const finalPhone = hasPhone ? active.customer_phone.trim() : undefined;
        
        const newCust = await db.saveCustomer({
          name: finalName,
          phone: finalPhone,
          total_bills: 0,
          total_purchases: 0
        });
        resolvedCustomerId = newCust.id;
        resolvedCustomerName = finalName;
        resolvedCustomerPhone = finalPhone || 'NA';
      } else {
        resolvedCustomerId = match.id;
        resolvedCustomerName = match.name;
        resolvedCustomerPhone = match.phone || 'NA';
      }
    }

    // ── RULE 1: SAVE BILL FIRST ───────────────────────────────────────────
    // Bills are never lost. Save to DB before any print attempt.
    const bills = await db.getBills();
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const todayISO = new Date().toISOString().slice(0, 10);
    const billsToday = bills.filter(b => b.created_at?.slice(0, 10) === todayISO);
    let seq = billsToday.length + 1;
    let preparedBillId = `BILL_${todayStr}_${String(seq).padStart(4, '0')}`;
    while (bills.some(b => b.bill_id === preparedBillId)) {
      seq++;
      preparedBillId = `BILL_${todayStr}_${String(seq).padStart(4, '0')}`;
    }

    const createdBill = await db.saveBill({
      bill_id: preparedBillId,
      customer_id: resolvedCustomerId,
      customer_name: resolvedCustomerName,
      customer_phone: resolvedCustomerPhone,
      subtotal: active.subtotal,
      discount: active.discount,
      grand_total: active.grand_total,
      payment_mode: active.payment_mode,
      status: 'Completed',
      print_status: 'PRINT_PENDING',
      items: active.items
    });

    set({ pendingCheckoutBill: createdBill });

    // ── PRINT PATH ────────────────────────────────────────────────────────
    set({ printJobStatus: null, printJobId: null });
    const printerCfg = get().printerConfig;

    if (!isThisDeviceHost() && bluetoothPrinter.isConnected()) {
      await claimPrinterHost(getMyDeviceId(), printerCfg.printer_mac);
    }

    if (isThisDeviceHost()) {
      // HOST PATH: this device is connected to printer.
      set({ showPrintingProgressModal: true, printingStatusText: 'Connecting...' });
      await new Promise(r => setTimeout(r, 300));
      set({ printingStatusText: 'Printing...' });

      const status = await printDirectAsHost(createdBill, printerCfg);
      set({ printJobStatus: status });
      if (status === 'PRINT_SUCCESS') {
        set({ printingStatusText: 'Success' });
        await new Promise(r => setTimeout(r, 1000));
        set({ showPrintingProgressModal: false });

        const updatedBill = { ...createdBill, print_status: 'PRINTED' as const };
        await db.updateBill(updatedBill);

        // Save AI-resolved voice mapping cache on success
        const pendingCache = get().pendingVoiceCache;
        if (pendingCache.length > 0) {
          for (const entry of pendingCache) {
            await db.saveVoiceCacheEntry(entry);
          }
          set({ pendingVoiceCache: [] });
        }

        // Reset active bill only on success
        set({ pendingCheckoutBill: null });
        get().startNewBill();
        await get().loadStoreData();
        get().triggerSync();

        return updatedBill;
      } else {
        set({ showPrintingProgressModal: false });
        // Print failed — bill is safe, signal UI (active cart remains populated)
        throw new Error('PRINTER_OFFLINE');
      }
    } else {
      // NON-HOST PATH: a live host must already exist. No host means no print job.
      const hostAvailability = await getPrinterHostAvailability(350);
      if (!hostAvailability.isAvailable) {
        throw new Error('NO_PRINTER_CONNECTED');
      }

      // Host exists and is alive! Set progress modal and submit job.
      set({ showPrintingProgressModal: true, printingStatusText: 'Connecting...' });

      const job = await submitPrintJob(createdBill);
      set({ printJobId: job.id ?? null });

      // Trigger immediate sync to push the print job row to Supabase
      syncEngine.triggerSync();

      // Poll every 200ms with a 2-second ACK limit and a short printing window.
      const start = Date.now();
      let finalStatus: PrintJobStatus = 'PENDING';
      let ackReceived = false;

      while (Date.now() - start < PRINT_JOB_TOTAL_TIMEOUT_MS) {
        await new Promise(r => setTimeout(r, 200));

        // Pull status directly from Supabase to bypass local 20s polling delay
        if (db.supabase && navigator.onLine) {
          try {
            const { data } = await db.supabase
              .from('print_jobs')
              .select('status')
              .eq('id', job.id)
              .single();
            if (data && data.status) {
              finalStatus = data.status as PrintJobStatus;
            }
          } catch (e) {
            console.warn('[PrinterHost] Failed to query remote job status, falling back to local');
          }
        }

        // Local check fallback
        if (finalStatus === 'PENDING') {
          const localJob = db.getPrintJobs().find(j => j.id === job.id);
          if (localJob) {
            finalStatus = localJob.status;
          }
        }

        const elapsed = Date.now() - start;

        // Check if host has acknowledged (status changed from PENDING)
        if (!ackReceived && finalStatus !== 'PENDING') {
          ackReceived = true;
          set({ printingStatusText: 'Printing...' });
        }

        // ACK timeout check (2 seconds max)
        if (elapsed > PRINT_JOB_ACK_TIMEOUT_MS && !ackReceived) {
          console.warn('[PrinterHost] Acknowledgment timeout. Host not responding.');
          finalStatus = 'PRINT_FAILED';
          if (job.id) {
            await db.updatePrintJobStatus(job.id, 'PRINT_FAILED', 'Host unavailable: no ACK within 2 seconds');
          }
          break;
        }

        // Terminate poll early if print settles
        if (finalStatus === 'PRINT_SUCCESS' || finalStatus === 'PRINT_FAILED') {
          break;
        }
      }

      if (finalStatus === 'PRINT_SUCCESS') {
        set({ printingStatusText: 'Success' });
        await new Promise(r => setTimeout(r, 1000));
        set({ showPrintingProgressModal: false });

        const updatedBill = { ...createdBill, print_status: 'PRINTED' as const };
        await db.updateBill(updatedBill);

        // Save AI-resolved voice mapping cache on success
        const pendingCache = get().pendingVoiceCache;
        if (pendingCache.length > 0) {
          for (const entry of pendingCache) {
            await db.saveVoiceCacheEntry(entry);
          }
          set({ pendingVoiceCache: [] });
        }

        // Reset active bill only on success
        set({ pendingCheckoutBill: null });
        get().startNewBill();
        await get().loadStoreData();
        get().triggerSync();

        return updatedBill;
      } else {
        set({ showPrintingProgressModal: false });
        if (finalStatus === 'NO_PRINTER_CONNECTED') {
          throw new Error('NO_PRINTER_CONNECTED');
        } else {
          throw new Error('PRINTER_OFFLINE');
        }
      }
    }

    return createdBill;
  },

  saveAndSkipPrint: async () => {
    const active = get().activeBill;
    if (active.items.length === 0) return null;

    // Check credit validation
    if (active.payment_mode === 'Credit') {
      const hasName = active.customer_name && active.customer_name.trim() !== 'Customer' && active.customer_name.trim() !== '';
      const hasPhone = active.customer_phone && active.customer_phone.trim() !== 'NA' && active.customer_phone.trim() !== '';
      if (!hasName && !hasPhone) {
        throw new Error('Please enter either a Customer Name or Phone Number to save this bill under Khata.');
      }
    }

    // Save customer if doesn't exist
    const hasName = active.customer_name && active.customer_name.trim() !== 'Customer' && active.customer_name.trim() !== '';
    const hasPhone = active.customer_phone && active.customer_phone.trim() !== 'NA' && active.customer_phone.trim() !== '';
    let resolvedCustomerId: number | undefined = active.customer_id;
    let resolvedCustomerName: string = active.customer_name;
    let resolvedCustomerPhone: string = active.customer_phone;

    if (hasName || hasPhone) {
      let match = null;
      if (hasPhone) {
        match = await db.findCustomerByPhone(active.customer_phone);
      }
      if (!match && hasName) {
        const allCusts = await db.getCustomers();
        match = allCusts.find(c => c.name.toLowerCase() === active.customer_name.toLowerCase()) || null;
      }

      if (!match) {
        const finalName = hasName ? active.customer_name.trim() : `Customer-${active.customer_phone}`;
        const finalPhone = hasPhone ? active.customer_phone.trim() : undefined;
        const newCust = await db.saveCustomer({
          name: finalName,
          phone: finalPhone,
          total_bills: 0,
          total_purchases: 0
        });
        resolvedCustomerId = newCust.id;
        resolvedCustomerName = finalName;
        resolvedCustomerPhone = finalPhone || 'NA';
      } else {
        resolvedCustomerId = match.id;
        resolvedCustomerName = match.name;
        resolvedCustomerPhone = match.phone || 'NA';
      }
    }

    // Generate bill number
    const bills = await db.getBills();
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const todayISO = new Date().toISOString().slice(0, 10);
    const billsToday = bills.filter(b => b.created_at?.slice(0, 10) === todayISO);
    let seq = billsToday.length + 1;
    let preparedBillId = `BILL_${todayStr}_${String(seq).padStart(4, '0')}`;
    while (bills.some(b => b.bill_id === preparedBillId)) {
      seq++;
      preparedBillId = `BILL_${todayStr}_${String(seq).padStart(4, '0')}`;
    }

    // Save bill to DB without printing — mark print status as skipped
    const createdBill = await db.saveBill({
      bill_id: preparedBillId,
      customer_id: resolvedCustomerId,
      customer_name: resolvedCustomerName,
      customer_phone: resolvedCustomerPhone,
      subtotal: active.subtotal,
      discount: active.discount,
      grand_total: active.grand_total,
      payment_mode: active.payment_mode,
      status: 'Completed',
      print_status: 'PRINT_SKIPPED',
      items: active.items
    });

    // Save AI-resolved voice mapping cache entries
    const pendingCache = get().pendingVoiceCache;
    if (pendingCache.length > 0) {
      for (const entry of pendingCache) {
        await db.saveVoiceCacheEntry(entry);
      }
      set({ pendingVoiceCache: [] });
    }

    // Clear any pending checkout state
    set({ pendingCheckoutBill: null });
    get().triggerSync();
    get().startNewBill();
    await get().loadStoreData();

    return createdBill;
  },

  saveBillAfterPrintSuccess: async (billData) => {
    const createdBill = await db.saveBill(billData);

    const pendingCache = get().pendingVoiceCache;
    if (pendingCache.length > 0) {
      for (const entry of pendingCache) {
        await db.saveVoiceCacheEntry(entry);
      }
      set({ pendingVoiceCache: [] });
    }

    set({ pendingCheckoutBill: null });
    get().triggerSync();
    get().startNewBill();
    await get().loadStoreData();
    return createdBill;
  },

  retryCheckoutPrint: async () => {
    const pendingBill = get().pendingCheckoutBill;
    if (!pendingBill) return null;

    const printSuccess = await bluetoothPrinter.printReceipt(pendingBill, get().printerConfig);
    if (!printSuccess) {
      throw new Error('PRINTER_OFFLINE');
    }

    // Print succeeded, save bill to DB
    const createdBill = await db.saveBill({
      bill_id: pendingBill.bill_id,
      customer_id: pendingBill.customer_id,
      customer_name: pendingBill.customer_name || 'Customer',
      customer_phone: pendingBill.customer_phone || 'NA',
      subtotal: pendingBill.subtotal,
      discount: pendingBill.discount,
      grand_total: pendingBill.grand_total,
      payment_mode: pendingBill.payment_mode,
      status: 'Completed',
      print_status: 'PRINTED',
      items: pendingBill.items
    });

    // Clear pending cache and bill
    const pendingCache = get().pendingVoiceCache;
    if (pendingCache.length > 0) {
      for (const entry of pendingCache) {
        await db.saveVoiceCacheEntry(entry);
      }
      set({ pendingVoiceCache: [] });
    }

    set({ pendingCheckoutBill: null });
    get().triggerSync();
    get().startNewBill();
    await get().loadStoreData();

    return createdBill;
  },

  scanBluetoothDevices: async () => {
    set({ isScanning: true });
    try {
      const devices = await bluetoothPrinter.scanDevices();
      set({ pairedPrinters: devices });
    } catch (e) {
      console.error("Scan bluetooth devices failed", e);
    } finally {
      set({ isScanning: false });
    }
  },

  connectPrinter: async (mac: string, name?: string) => {
    set({ printerStatus: 'Connecting' });
    const success = await bluetoothPrinter.connectPrinter(mac, name);
    if (success) {
      set(state => ({
        printerStatus: 'Connected',
        printerConnected: true,
        printerConfig: {
          ...state.printerConfig,
          printer_mac: mac,
          printer_name: name || "ATPOS H58BT"
        }
      }));
      db.setSetting('printer_mac', mac);
      db.setSetting('printer_name', name || "ATPOS H58BT");
      // CLAIM PRINTER HOST: announce to all devices that this device owns the printer
      await claimPrinterHost(getMyDeviceId(), mac);
    } else {
      set({ printerStatus: 'Disconnected', printerConnected: false });
    }
    return success;
  },

  disconnectPrinter: async () => {
    // Release printer host before disconnecting
    await releasePrinterHost(getMyDeviceId());
    await bluetoothPrinter.disconnectPrinter();
    set(state => ({
      printerStatus: 'Disconnected',
      printerConnected: false,
      printerConfig: {
        ...state.printerConfig,
        printer_mac: '',
        printer_name: ''
      }
    }));
    db.setSetting('printer_mac', '');
    db.setSetting('printer_name', '');
  },

  reconnectPrinter: async () => {
    const mac = get().printerConfig.printer_mac;
    const name = get().printerConfig.printer_name;
    if (!mac) return false;
    return get().connectPrinter(mac, name);
  },

  toggleAutoConnect: () => {
    const newVal = !get().autoConnect;
    set({ autoConnect: newVal });
    db.setSetting('auto_connect', String(newVal));
  },

  cancelBill: async (billId) => {
    await db.cancelBill(billId);
    get().triggerSync();
    await get().loadStoreData();
  },

  updateBill: async (updatedBill) => {
    await db.updateBill(updatedBill);
    get().triggerSync();
    await get().loadStoreData();
  },

  // ----------------------------------------------------
  // SETTINGS & PRINTER TESTS
  // ----------------------------------------------------
  saveSettings: (settings) => {
    db.setSetting('store_name', settings.store_name);
    db.setSetting('upi_id', settings.upi_id);
    db.setSetting('printer_name', settings.printer_name);
    db.setSetting('printer_mac', settings.printer_mac);
    if (settings.upi_qr_image !== undefined) {
      db.setSetting('upi_qr_image', settings.upi_qr_image);
    }
    if (settings.qr_size !== undefined) {
      db.setSetting('qr_size', String(settings.qr_size));
    }
    // API keys are loaded from .env — not stored in localStorage

    set(state => ({
      storeName: settings.store_name,
      upiId: settings.upi_id,
      printerConnected: !!settings.printer_mac,
      printerConfig: {
        ...state.printerConfig,
        printer_name: settings.printer_name,
        printer_mac: settings.printer_mac,
        upi_id: settings.upi_id,
        merchant_name: settings.store_name,
        upi_qr_image: settings.upi_qr_image !== undefined ? (settings.upi_qr_image || undefined) : state.printerConfig.upi_qr_image,
        qr_size: settings.qr_size !== undefined ? settings.qr_size : state.printerConfig.qr_size
      }
    }));

    // Reload SyncEngine client credentials
    syncEngine.reloadClient();
    get().triggerSync();
  },

  testPrint: async () => {
    const mockBill: Bill = {
      id: 9999,
      bill_id: 'BILL_TEST_9999',
      bill_number: 9999,
      customer_name: 'TEST CUSTOMER',
      customer_phone: '9876543210',
      subtotal: 100,
      discount: 10,
      grand_total: 90,
      payment_mode: 'UPI',
      status: 'Completed',
      print_status: 'PRINT_PENDING',
      created_at: new Date().toISOString(),
      items: [
        { product_id: 99, product_name: 'Test Tea Pack', quantity: 2, unit: 'Pudha', price: 50, total: 100 }
      ]
    };
    return printReceipt(mockBill, get().printerConfig);
  },

  setOnline: (online: boolean) => {
    set({ isOnline: online });
  },

  setSyncing: (syncing: boolean) => {
    set({ isSyncing: syncing });
  },

  triggerSync: async (isManual = false) => {
    const manual = (isManual === true || (isManual && typeof isManual === 'object'));
    if (get().isSyncing) return;
    set({ isSyncing: true });
    try {
      await syncEngine.triggerSync(manual);
    } finally {
      set({ isSyncing: false });
    }
    const queue = db.getSyncQueue();
    set({ syncQueueCount: queue.filter(q => q.status === 'pending' || q.status === 'failed').length });
    await get().loadStoreData();
  },

  forceFullSync: async () => {
    if (get().isSyncing) return;
    set({ isSyncing: true });
    try {
      try {
        await syncEngine.triggerSync();
      } catch (pushErr) {
        console.error('[store] Push local changes failed during forceFullSync:', pushErr);
      }
      
      await db.forceFullSync();
      
      await get().loadStoreData();
    } finally {
      set({ isSyncing: false });
    }
  },

  manualSync: async () => {
    await get().triggerSync(true);
  }
}));
