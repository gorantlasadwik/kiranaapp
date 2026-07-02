import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ScreenType } from "./store";
import {
  useStore,
  resolveUnitAndPrice,
  getBaseBrandName,
  findProductInFamilyForUnit,
  getUnitBaseQuantity,
} from "./store";
import type {
  Product,
  Customer,
  Bill,
  BillItem,
  KhataRecord,
  Category,
  Barcode as DbBarcode,
  CatalogCategory,
  ProductCategory,
} from "./db";
import { db } from "./db";
import {
  generateProductAliases,
  parseProductCreationVoiceCommand,
  parseKhataVoiceCommand,
} from "./utils/voiceParser";
import {
  resolveVoiceCommand,
  recordVoiceSuccess,
  recordVoiceCorrection,
} from "./utils/voiceEngineV4";
import {
  startBarcodeScanner,
  stopBarcodeScanner,
  setTorch,
} from "./utils/barcodeScanner";
import {
  generateSimulatedReceipt,
  generateSimulatedBarcodeLabel,
  bluetoothPrinter,
  generateCode128SVG,
} from "./utils/printerService";
import type { PrinterConfig } from "./utils/printerService";
import {
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  User,
  Cloud,
  ShoppingCart,
  FileText,
  BookOpen,
  Database,
  Barcode,
  TrendingUp,
  Settings,
  Mic,
  MicOff,
  Search,
  Plus,
  Trash2,
  X,
  ArrowLeft,
  Printer,
  ChevronRight,
  Zap,
  Eye,
  ShoppingBag,
  DownloadCloud,
  Camera,
  UploadCloud,
} from "lucide-react";
import confetti from "canvas-confetti";
import {
  generateBillPDF,
  generateKhataPDF,
  shareViaWhatsApp,
} from "./utils/pdfGenerator";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

const ContactsPlugin = registerPlugin<any>("ContactsPlugin");
const SpeechPlugin = registerPlugin<any>("SpeechPlugin");

// Compact unit label for dropdowns and receipts
const formatUnitShort = (unit: string): string => {
  switch ((unit || "").toLowerCase().trim()) {
    case "gram":
    case "grams":
    case "g":
    case "gm":
    case "gms":
      return "g";
    case "kg":
    case "kgs":
    case "kilo":
    case "kilos":
    case "kilogram":
      return "kg";
    case "litre":
    case "litres":
    case "liter":
    case "liters":
      return "L";
    case "ml":
    case "mls":
    case "milliliter":
    case "milliliters":
      return "ml";
    case "piece":
    case "pieces":
    case "pc":
    case "pcs":
      return "pc";
    case "carton":
    case "cartons":
    case "cartoon":
    case "cartoons":
      return "ct";
    case "bag":
    case "bags":
      return "bg";
    case "tray":
    case "trays":
      return "tr";
    case "sheet":
    case "sheets":
      return "sht";
    case "pudha":
    case "pudhas":
    case "puda":
      return "pud";
    case "na":
      return "NA";
    default:
      return unit || "";
  }
};

export const formatIndianCurrency = (amount: number): string => {
  const formatter = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const formatted = formatter.format(amount).replace(/[^0-9.,]/g, "");
  return "₹" + formatted;
};

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  return isMobile;
}

const pickBestSpeechTranscript = (result: any): string => {
  const candidates = [result?.transcript, result?.alt1, result?.alt2].filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  if (candidates.length <= 1) return candidates[0] || "";

  const detectedLanguage = String(result?.detectedLanguage || "").toLowerCase();
  const scoreCandidate = (text: string, index: number) => {
    const teluguChars = (text.match(/[\u0C00-\u0C7F]/g) || []).length;
    const devanagariChars = (text.match(/[\u0900-\u097F]/g) || []).length;
    const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
    let score = 100 - index;
    score += teluguChars * 8 + devanagariChars * 8;
    if (detectedLanguage.startsWith("te")) score += teluguChars * 20;
    if (detectedLanguage.startsWith("hi")) score += devanagariChars * 20;
    if ((teluguChars || devanagariChars) && latinChars) score += 20;
    return score;
  };

  return candidates
    .map((text, index) => ({ text, score: scoreCandidate(text, index) }))
    .sort((a, b) => b.score - a.score)[0].text;
};

interface SetupWizardProps {
  initialDeviceSetup: (
    onProgress: (table: string, current: number, total: number) => void,
  ) => Promise<void>;
  onComplete: () => void;
}

function SetupWizard({ initialDeviceSetup, onComplete }: SetupWizardProps) {
  const [progress, setProgress] = useState<
    Record<string, { current: number; total: number }>
  >({});
  const [status, setStatus] = useState<
    "idle" | "running" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const tableLabels: Record<string, string> = {
    categories: "Categories",
    products: "Products",
    barcodes: "Barcode Records",
    product_aliases: "Aliases",
    units: "Unit Pricing Details",
    voice_phrase_cache: "Voice Cache",
    voice_memory: "Voice Memory",
    voice_corrections: "Voice Corrections",
  };

  const handleStart = React.useCallback(async () => {
    setStatus("running");
    setErrorMsg("");
    try {
      await initialDeviceSetup((table, current, total) => {
        setProgress((prev) => ({
          ...prev,
          [table]: { current, total },
        }));
      });
      setStatus("success");
      onComplete();
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(
        err?.message ||
          "Failed to download setup files. Please check connection and try again.",
      );
    }
  }, [initialDeviceSetup, onComplete]);

  useEffect(() => {
    handleStart();
  }, [handleStart]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#0b0a0f",
        color: "#fff",
        padding: "24px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "480px",
          width: "100%",
          background: "#13111c",
          borderRadius: "16px",
          border: "1px solid #2e2a45",
          padding: "32px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontSize: "24px",
            fontWeight: 700,
            marginBottom: "8px",
            color: "#f59e0b",
          }}
        >
          Setting Up Sai Ram Kirana
        </h2>
        <p style={{ fontSize: "14px", color: "#a1a1aa", marginBottom: "24px" }}>
          Downloading POS tables & building indexes for local use. Please do not
          close the app.
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            textAlign: "left",
            marginBottom: "32px",
          }}
        >
          {Object.keys(tableLabels).map((tableKey) => {
            const prog = progress[tableKey] || { current: 0, total: 0 };
            const isDone =
              status === "success" ||
              (prog.current > 0 && prog.current >= prog.total);
            const isDownloading =
              status === "running" && !isDone && prog.current > 0;

            return (
              <div
                key={tableKey}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 16px",
                  background: "#1c192b",
                  borderRadius: "8px",
                  border: "1px solid #26223b",
                }}
              >
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#e4e4e7",
                  }}
                >
                  {tableLabels[tableKey]}
                </span>
                <span
                  style={{
                    fontSize: "13px",
                    fontFamily: "monospace",
                    color: isDone
                      ? "#22c55e"
                      : isDownloading
                        ? "#f59e0b"
                        : "#71717a",
                    fontWeight: "bold",
                  }}
                >
                  {isDone ? "✓ Complete" : `${prog.current} / ${prog.total}`}
                </span>
              </div>
            );
          })}
        </div>

        {status === "running" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <div
              className="animate-spin"
              style={{
                width: "24px",
                height: "24px",
                border: "3px solid rgba(245, 158, 11, 0.1)",
                borderTop: "3px solid #f59e0b",
                borderRadius: "50%",
              }}
            />
            <span
              style={{
                fontSize: "13px",
                color: "#a1a1aa",
                fontStyle: "italic",
              }}
            >
              Building Search Index... Please Wait
            </span>
          </div>
        )}

        {status === "success" && (
          <div style={{ color: "#22c55e", fontSize: "15px", fontWeight: 600 }}>
            🚀 Setup Complete! Launching POS...
          </div>
        )}

        {status === "error" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              alignItems: "center",
            }}
          >
            <div
              style={{
                color: "#ef4444",
                fontSize: "14px",
                background: "rgba(239, 68, 68, 0.1)",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid rgba(239, 68, 68, 0.2)",
              }}
            >
              {errorMsg}
            </div>
            <button
              onClick={handleStart}
              style={{
                padding: "12px 24px",
                background: "#f59e0b",
                color: "#0b0a0f",
                borderRadius: "8px",
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
              }}
            >
              Retry Setup
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const {
    currentScreen,
    storeName,
    upiId,
    syncQueueCount,
    products,
    customers,
    khataRecords,
    activeBill,
    draftRecoverable,
    printerConnected,
    printerConfig,
    initApp,
    setScreen,
    setCustomer,
    addItem: storeAddItem,
    removeItem: storeRemoveItem,
    editItem: storeEditItem,
    setDiscount,
    setPaymentMode,
    recoverDraftBill,
    discardDraftBill,
    checkoutAndPrint,
    saveSettings,
    testPrint,
    triggerSync,
    isDatabaseInitialized,
    initialDeviceSetup,
    showSyncPopup,
    syncProgressText,
    syncCurrentCount,
    syncTotalCount,
    manualSync,
  } = useStore();

  const [initialized, setInitialized] = useState(false);
  const [historyReferrer, setHistoryReferrer] = useState<"home" | "new_bill">(
    "home",
  );
  const [categories, setCategories] = useState<Category[]>([]);

  // Voice AI V3 Self-learning & Correction tracking refs
  const lastVoiceExecutionRef = useRef<{
    timestamp: number;
    rawText: string;
    resolvedProductId: number;
    quantity: number;
    unit: string;
    action: "ADD_ITEM" | "REMOVE_ITEM" | "UPDATE_ITEM";
  } | null>(null);

  const lastVoiceCorrectionRef = useRef<{
    rawText: string;
    wrongProductId: number;
    timestamp: number;
    quantity: number;
    unit: string;
    action: string;
  } | null>(null);

  const addItem = React.useCallback(
    (p: Product, qty: number, unit?: string) => {
      // Intercept manual replacement correction if a voice execution was deleted recently
      const lastCorrection = lastVoiceCorrectionRef.current;
      if (lastCorrection && Date.now() - lastCorrection.timestamp < 5000) {
        console.log(
          "[Voice AI] Intercepted manual replacement correction. Recording voice correction.",
        );
        recordVoiceCorrection(
          lastCorrection.rawText,
          lastCorrection.wrongProductId,
          p.id,
          qty,
          unit || lastCorrection.unit,
          lastCorrection.action,
        ).catch((err) => {
          console.error("[Voice AI] Error saving replacement correction:", err);
        });
        lastVoiceCorrectionRef.current = null; // consume the correction
      }
      storeAddItem(p, qty, unit);
    },
    [storeAddItem],
  );

  const removeItem = React.useCallback(
    (id: number) => {
      const lastVoice = lastVoiceExecutionRef.current;
      if (
        lastVoice &&
        Date.now() - lastVoice.timestamp < 5000 &&
        lastVoice.resolvedProductId === id
      ) {
        console.log(
          "[Voice AI] Intercepted manual removal of voice resolved item. Saving for potential replacement.",
        );
        lastVoiceCorrectionRef.current = {
          rawText: lastVoice.rawText,
          wrongProductId: id,
          timestamp: Date.now(),
          quantity: lastVoice.quantity,
          unit: lastVoice.unit,
          action: lastVoice.action,
        };
      }
      storeRemoveItem(id);
    },
    [storeRemoveItem],
  );

  const editItem = React.useCallback(
    (
      id: number,
      qty: number,
      unit?: string,
      price?: number,
      nameOverride?: string,
      originalUnit?: string,
    ) => {
      const lastVoice = lastVoiceExecutionRef.current;
      if (
        lastVoice &&
        Date.now() - lastVoice.timestamp < 5000 &&
        lastVoice.resolvedProductId === id
      ) {
        console.log(
          "[Voice AI] Intercepted manual edit of voice resolved item. Updating voice memory/cache.",
        );
        const targetQty = qty;
        const targetUnit = unit || lastVoice.unit;
        recordVoiceSuccess(
          lastVoice.rawText,
          id,
          targetQty,
          targetUnit,
          lastVoice.action,
        ).catch((err) => {
          console.error(
            "[Voice AI] Error updating voice memory on manual edit:",
            err,
          );
        });
      }
      storeEditItem(id, qty, unit, price, nameOverride, originalUnit);
    },
    [storeEditItem],
  );

  // System Barcode Preview & Gen States
  const [printedBarcodeLabel, setPrintedBarcodeLabel] = useState<{
    barcode: string;
    productName: string;
    unitName: string;
  } | null>(null);
  const [systemBarcodeModalProduct, setSystemBarcodeModalProduct] =
    useState<Product | null>(null);

  useEffect(() => {
    (window as any)._openGenSystemBarcode = (prod: Product) => {
      setSystemBarcodeModalProduct(prod);
    };
    (window as any)._setBarcodePreview = setPrintedBarcodeLabel;
    return () => {
      delete (window as any)._openGenSystemBarcode;
      delete (window as any)._setBarcodePreview;
    };
  }, []);


  const handlePickContact = async (
    onSelect: (name: string, phone: string) => void,
  ) => {
    if (Capacitor.isNativePlatform()) {
      try {
        const result = await ContactsPlugin.pickContact();
        if (result && result.phone) {
          const displayName = result.name || "";
          const cleanPhone = result.phone
            .replace(/\s+/g, "")
            .replace(/[-()]/g, "");
          onSelect(displayName, cleanPhone);
          return;
        }
      } catch (err) {
        console.warn(
          "Native ContactsPlugin pickContact failed or was cancelled:",
          err,
        );
      }
      return;
    }

    if ("contacts" in navigator && "select" in (navigator as any).contacts) {
      try {
        const props = ["name", "tel"];
        const opts = { multiple: false };
        const contacts = await (navigator as any).contacts.select(props, opts);
        if (contacts && contacts.length > 0) {
          const contact = contacts[0];
          const displayName = contact.name?.[0] || "";
          let rawPhone = contact.tel?.[0] || "";
          // Clean phone number
          const cleanPhone = rawPhone.replace(/\s+/g, "").replace(/[-()]/g, "");
          onSelect(displayName, cleanPhone);
        }
      } catch (err) {
        console.warn(
          "Native contacts select failed or cancelled:",
          err,
        );
      }
    } else {
      alert("Contacts selection is only supported in the native Android app or secure mobile browsers.");
    }
  };

  useEffect(() => {
    initApp().then(() => {
      setInitialized(true);
      db.getCategories().then(setCategories);
    });
  }, []);

  useEffect(() => {
    if (!initialized) return;

    const handleHashChange = () => {
      const hash = window.location.hash;
      const screen = hash.replace(/^#\/?/, "") as ScreenType;
      const validScreens: ScreenType[] = [
        "home",
        "new_bill",
        "products",
        "barcode",
        "history",
        "khata",
        "settings",
        "reports",
        "categories",
      ];

      if (validScreens.includes(screen)) {
        if (useStore.getState().currentScreen !== screen) {
          useStore.getState().setScreen(screen);
        }
      } else if (!hash || hash === "#/") {
        if (useStore.getState().currentScreen !== "home") {
          useStore.getState().setScreen("home");
        }
      }
    };

    window.addEventListener("hashchange", handleHashChange);

    // Check initial hash on load
    handleHashChange();

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [initialized]);

  // Push a history state entry whenever the screen changes so the browser back
  // button has something to pop (preventing app exit / tab close on mobile).
  useEffect(() => {
    if (!initialized) return;
    const hash = `#/${currentScreen}`;
    if (window.location.hash !== hash) {
      window.history.pushState({ screen: currentScreen }, "", hash);
    }
    // Scroll the main content viewport to the top on any screen transition
    const mainEl = document.querySelector(".main-content");
    if (mainEl) {
      mainEl.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  }, [currentScreen, initialized]);

  // Intercept the hardware back button on Android (Capacitor native) and
  // the browser back button (web). Instead of exiting, navigate back.
  useEffect(() => {
    if (!initialized) return;

    // ── Native Android back button via Capacitor App plugin ──
    let nativeBackListener: any = null;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener("backButton", ({ canGoBack }) => {
        const screen = useStore.getState().currentScreen;
        if (screen !== "home") {
          useStore.getState().setScreen("home");
        } else if (canGoBack) {
          // Already on home & there's browser history — do nothing (stay in app)
          // Do NOT call window.history.back() as that would navigate out
        }
        // Otherwise: already on home, no browser history → do nothing (don't exit)
      }).then((listener: any) => {
        nativeBackListener = listener;
      });
    }

    // ── Web browser back button via popstate ──
    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      const screen = useStore.getState().currentScreen;
      if (screen !== "home") {
        useStore.getState().setScreen("home");
        window.history.pushState({ screen: "home" }, "", "#/home");
      } else {
        window.history.pushState({ screen: "home" }, "", "#/home");
      }
    };

    window.history.pushState(
      { screen: currentScreen },
      "",
      `#/${currentScreen}`,
    );
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (nativeBackListener) {
        nativeBackListener.remove();
      }
    };
  }, [initialized]);

  useEffect(() => {
    if (!initialized) return;

    const handleOnline = () => {
      useStore.getState().setOnline(true);
    };
    const handleOffline = () => {
      useStore.getState().setOnline(false);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    useStore.getState().setOnline(navigator.onLine);

    // Known Hindi bazaar / market colloquial alias patches.
    // These are injected regardless of AI — they work offline too.
    const KNOWN_ALIAS_PATCHES: Record<string, string[]> = {
      // Tamarind
      chintapandu: [
        "imly",
        "imli",
        "emli",
        "इमली",
        "chintapandu",
        "చింతపండు",
        "chinta pandu",
        "tamarind",
      ],
      tamarind: ["imly", "imli", "emli", "इमली", "chintapandu", "చింతపండు"],
      // Turmeric
      pasupu: ["haldi", "हल्दी", "pasupu", "పసుపు", "turmeric"],
      turmeric: ["haldi", "हल्दी", "pasupu", "పసుపు"],
      // Chilli
      mirchi: [
        "mirchi",
        "lal mirch",
        "लाल मिर्च",
        "mirapakaya",
        "మిర్చి",
        "red chilli",
      ],
      mirapakaya: [
        "mirchi",
        "lal mirch",
        "లాల్ మిర్చ్",
        "mirapakaya",
        "మిరపకాయ",
      ],
      // Coriander
      dhaniyalu: [
        "dhaniya",
        "dhania",
        "धनिया",
        "dhaniyalu",
        "ధనియాలు",
        "coriander",
      ],
      coriander: ["dhaniya", "dhania", "धनिया", "dhaniyalu"],
      // Cumin
      jeelakarra: ["jeera", "jira", "जीरा", "jeelakarra", "జీలకర్ర", "cumin"],
      cumin: ["jeera", "jira", "जीरा", "jeelakarra"],
      // Fenugreek
      menthulu: ["methi", "मेथी", "menthulu", "మెంతులు", "fenugreek"],
      fenugreek: ["methi", "मेथी", "menthulu"],
      // Mustard
      avalu: ["rai", "sarson", "राई", "avalu", "ఆవాలు", "mustard"],
      mustard: ["rai", "sarson", "राई", "avalu"],
      // Coconut
      kobbari: ["nariyal", "नारियल", "kobbari", "కొబ్బరి", "coconut"],
      coconut: ["nariyal", "नारियल", "kobbari"],
      // Onion
      ullipaya: ["pyaz", "pyaaz", "प्याज", "ullipaya", "ఉల్లిపాయ", "onion"],
      onion: ["pyaz", "pyaaz", "प्याज", "ullipaya"],
      // Garlic
      vellulli: [
        "lahsun",
        "lasun",
        "लहसुन",
        "vellulli",
        "వెల్లుల్లి",
        "garlic",
      ],
      garlic: ["lahsun", "lasun", "लहसुन", "vellulli"],
      // Ginger
      allam: ["adrak", "अदरक", "allam", "అల్లం", "ginger"],
      ginger: ["adrak", "अदरक", "allam"],
      // Jaggery
      bellam: ["gur", "gud", "गुड़", "bellam", "బెల్లం", "jaggery"],
      jaggery: ["gur", "gud", "गुड़", "bellam"],
      // Groundnuts
      pallilu: [
        "moongfali",
        "mungfali",
        "मूंगफली",
        "pallilu",
        "పల్లీలు",
        "groundnut",
        "peanut",
      ],
      groundnut: ["moongfali", "mungfali", "मूंगफली", "pallilu"],
      peanut: ["moongfali", "mungfali", "मूंगफली", "pallilu"],
    };

    const patchProductAliases = async () => {
      try {
        const localProducts = await db.getProducts();
        let modified = false;
        for (const p of localProducts) {
          const nameLower = p.display_name.toLowerCase();
          // Find which patch keys match this product name
          const patchAliases: string[] = [];
          for (const [key, aliases] of Object.entries(KNOWN_ALIAS_PATCHES)) {
            if (nameLower.includes(key)) {
              patchAliases.push(...aliases);
            }
          }
          if (patchAliases.length > 0) {
            const current = new Set(
              (p.aliases || []).map((a) => a.toLowerCase()),
            );
            const missing = patchAliases.filter(
              (a) => !current.has(a.toLowerCase()),
            );
            if (missing.length > 0) {
              p.aliases = Array.from(
                new Set([...(p.aliases || []), ...missing]),
              );
              await db.saveProduct(p);
              modified = true;
            }
          }
        }
        if (modified) {
          useStore.getState().loadStoreData();
          useStore.getState().triggerSync();
        }
      } catch (err) {
        console.error("Known alias patch error:", err);
      }
    };

    const enrichExistingAliases = async () => {
      const geminiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || "";
      const groqKey = (import.meta as any).env?.VITE_GROQ_API_KEY || "";
      if (!geminiKey && !groqKey) return;

      try {
        const localProducts = await db.getProducts();
        let modified = false;

        for (const p of localProducts) {
          // If aliases are empty, null, or have only 1 item (e.g. self-name)
          if (!p.aliases || p.aliases.length <= 1) {
            console.log(
              `Generating background AI aliases for: ${p.display_name}`,
            );
            try {
              const suggested = await generateProductAliases(p.display_name);
              if (suggested && suggested.length > 0) {
                const merged = Array.from(
                  new Set([...(p.aliases || []), ...suggested]),
                );
                p.aliases = merged;
                await db.saveProduct(p);
                modified = true;
              }
            } catch (err) {
              console.error(
                `AI Alias generation failed for ${p.display_name}:`,
                err,
              );
            }
          }
        }

        if (modified) {
          // Reload the store data to update catalog list UI
          useStore.getState().loadStoreData();
          useStore.getState().triggerSync();
        }
      } catch (err) {
        console.error("Background product alias enrichment error:", err);
      }
    };

    // Apply known alias patches immediately (offline, no API needed)
    patchProductAliases();

    // Run AI enrichment 2 seconds after initialization to not block startup rendering
    const timer = setTimeout(enrichExistingAliases, 2000);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [initialized]);

  if (!initialized) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#0b0a0f",
          color: "#fff",
        }}
      >
        <RefreshCw style={{ animation: "spin 1s linear infinite" }} />
        <span style={{ marginTop: 12, fontFamily: "monospace" }}>
          Loading Sai Ram Kirana POS...
        </span>
      </div>
    );
  }

  if (initialized && !isDatabaseInitialized) {
    return (
      <SetupWizard
        initialDeviceSetup={initialDeviceSetup}
        onComplete={() => {
          db.getCategories().then(setCategories);
        }}
      />
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="app-container">
        <TopBar
          storeName={storeName}
          syncQueue={syncQueueCount}
          printer={printerConnected}
          currentScreen={currentScreen}
          onNavigate={setScreen}
          onSync={triggerSync}
        />
        <main className="main-content">
          {currentScreen === "home" && (
            <HomeScreen
              onNavigate={(s) => {
                if (s === "history") setHistoryReferrer("home");
                setScreen(s);
              }}
              onSync={manualSync}
            />
          )}
          {currentScreen === "new_bill" && (
            <BillingTerminal
              activeBill={activeBill}
              products={products}
              customers={customers}
              khataRecords={khataRecords}
              draftRecoverable={draftRecoverable}
              onRecoverDraft={recoverDraftBill}
              onDiscardDraft={discardDraftBill}
              onAddItem={addItem}
              onRemoveItem={removeItem}
              onEditItem={editItem}
              onSetCustomer={setCustomer}
              onSetDiscount={setDiscount}
              onSetPaymentMode={setPaymentMode}
              onCheckout={checkoutAndPrint}
              printerConfig={printerConfig}
              onBack={() => setScreen("home")}
              onGoToHistory={() => {
                setHistoryReferrer("new_bill");
                setScreen("history");
              }}
              handlePickContact={handlePickContact}
            />
          )}
          {currentScreen === "products" && (
            <ProductsManager
              products={products}
              categories={categories}
              onBack={() => setScreen("home")}
            />
          )}
          {currentScreen === "barcode" && (
            <BarcodeAssociation
              products={products}
              onBack={() => setScreen("home")}
            />
          )}
          {currentScreen === "system_barcodes" && (
            <SystemBarcodesManager
              products={products}
              onBack={() => setScreen("home")}
            />
          )}
          {currentScreen === "history" && (
            <HistoryScreen
              onBack={() => setScreen(historyReferrer)}
              handlePickContact={handlePickContact}
            />
          )}
          {currentScreen === "khata" && (
            <KhataLedger
              khataRecords={khataRecords}
              onBack={() => setScreen("home")}
              handlePickContact={handlePickContact}
            />
          )}
          {currentScreen === "reports" && (
            <ReportsScreen onBack={() => setScreen("home")} />
          )}
          {currentScreen === "settings" && (
            <SettingsScreen
              storeName={storeName}
              upiId={upiId}
              printerConfig={printerConfig}
              onSave={saveSettings}
              onTestPrint={testPrint}
              onBack={() => setScreen("home")}
            />
          )}
          {currentScreen === "categories" && (
            <CategoriesScreen
              onBack={() => setScreen("home")}
              products={products}
            />
          )}
        </main>

        {/* SYSTEM BARCODE LABEL PREVIEW MODAL */}
        {printedBarcodeLabel && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 110,
              padding: 20,
            }}
          >
            <div
              className="pos-card ticket-print-animation"
              style={{
                width: "100%",
                maxWidth: 360,
                background: "#181520",
                padding: 24,
                borderRadius: 12,
              }}
            >
              <div className="flex-between" style={{ marginBottom: 16 }}>
                <span
                  style={{
                    fontWeight: 800,
                    color: "#a78bfa",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <CheckCircle size={18} /> Barcode Label Generated
                </span>
                <button
                  onClick={() => setPrintedBarcodeLabel(null)}
                  style={{
                    background: "transparent",
                    color: "#9c97aa",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  <X size={20} />
                </button>
              </div>

              <div
                style={{
                  maxHeight: 400,
                  overflowY: "auto",
                  borderRadius: 6,
                  margin: "12px 0",
                  display: "flex",
                  justifyContent: "center",
                  width: "100%",
                }}
                dangerouslySetInnerHTML={{
                  __html: generateSimulatedBarcodeLabel(
                    printedBarcodeLabel.barcode,
                    printedBarcodeLabel.productName,
                    printedBarcodeLabel.unitName,
                    printerConfig,
                  ).html,
                }}
              />

              <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
                <button
                  onClick={async () => {
                    const ok = await bluetoothPrinter.printBarcodeLabel(
                      printedBarcodeLabel.barcode,
                      printedBarcodeLabel.productName,
                      printedBarcodeLabel.unitName,
                      printerConfig,
                    );
                    if (ok) {
                      alert("Label reprint command sent to ATPOS H58BT");
                    } else {
                      alert("Printer connection failed.");
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: 12,
                    borderRadius: 8,
                    background: "#a78bfa",
                    color: "#181520",
                    fontSize: 14,
                    fontWeight: 700,
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  🏷️ Reprint Label
                </button>
                <button
                  onClick={() => setPrintedBarcodeLabel(null)}
                  style={{
                    flex: 1,
                    padding: 12,
                    borderRadius: 8,
                    background: "#2b253b",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 700,
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SYSTEM BARCODE GENERATOR FORM MODAL */}
        {systemBarcodeModalProduct &&
          createPortal(
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0,0,0,0.8)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 120,
                padding: 20,
              }}
            >
              <div
                className="pos-card ticket-print-animation"
                style={{
                  width: "100%",
                  maxWidth: 450,
                  background: "#1c1926",
                  padding: 24,
                  borderRadius: 12,
                }}
              >
                <div className="flex-between" style={{ marginBottom: 16 }}>
                  <h2
                    style={{ fontSize: 18, fontWeight: 800, color: "#a78bfa" }}
                  >
                    Generate System Barcode
                  </h2>
                  <button
                    onClick={() => {
                      setSystemBarcodeModalProduct(null);
                    }}
                    style={{
                      background: "transparent",
                      color: "#9c97aa",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    <X size={20} />
                  </button>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#9c97aa",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    Product Name
                  </span>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: "#fff",
                      marginTop: 4,
                    }}
                  >
                    {systemBarcodeModalProduct.display_name}
                  </div>
                </div>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();

                    try {
                      const barcodeCode = `SYS-${systemBarcodeModalProduct.id}`;
                      const allBarcodes = await db.getBarcodes();
                      const existing = allBarcodes.find(
                        (b) => b.barcode === barcodeCode,
                      );
                      if (!existing) {
                        await db.addBarcode(
                          systemBarcodeModalProduct.id,
                          barcodeCode,
                          "Code-128",
                          undefined,
                          true,
                        );
                      }

                      setPrintedBarcodeLabel({
                        barcode: barcodeCode,
                        productName: systemBarcodeModalProduct.display_name,
                        unitName: "",
                      });

                      await bluetoothPrinter.printBarcodeLabel(
                        barcodeCode,
                        systemBarcodeModalProduct.display_name,
                        "",
                        printerConfig,
                      );

                      await useStore.getState().loadStoreData();
                      useStore.getState().triggerSync();

                      if ((window as any)._reloadSystemBarcodes) {
                        (window as any)._reloadSystemBarcodes();
                      }

                      setSystemBarcodeModalProduct(null);
                    } catch (err: any) {
                      alert(
                        err.message || "Failed to generate system barcode.",
                      );
                    }
                  }}
                >
                  <div
                    style={{
                      marginBottom: 16,
                      fontSize: 13,
                      color: "#9c97aa",
                      lineHeight: 1.5,
                    }}
                  >
                    This will generate a custom system barcode (
                    <strong>SYS-{systemBarcodeModalProduct.id}</strong>) linked
                    directly to this product. When scanned, it will add the
                    product using its primary billing unit.
                  </div>

                  <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
                    <button
                      type="submit"
                      style={{
                        flex: 1,
                        padding: 12,
                        background: "#a78bfa",
                        color: "#181520",
                        border: "none",
                        borderRadius: 8,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Generate & Print Label
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSystemBarcodeModalProduct(null);
                      }}
                      style={{
                        flex: 1,
                        padding: 12,
                        background: "#2b253b",
                        color: "#fff",
                        border: "none",
                        borderRadius: 8,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )}
      </div>


      {/* Blocking Sync Progress Modal */}
      {showSyncPopup && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(11, 10, 15, 0.92)",
            backdropFilter: "blur(10px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
            padding: 24,
            pointerEvents: "all",
          }}
        >
          <div
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 420,
              background: "linear-gradient(135deg, #181524, #12101b)",
              border: "1px solid rgba(167, 139, 250, 0.25)",
              padding: "32px 24px",
              borderRadius: 16,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 20,
              boxShadow:
                "0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(109, 40, 217, 0.2)",
            }}
          >
            <div
              style={{
                position: "relative",
                width: 64,
                height: 64,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <RefreshCw
                size={36}
                color="#a78bfa"
                style={{ animation: "spin 1.5s linear infinite" }}
              />
              <Cloud
                size={16}
                color="#14b8a6"
                style={{ position: "absolute", top: 24, left: 24 }}
              />
            </div>

            <div style={{ textAlign: "center" }}>
              <h3
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: "#f3f1f6",
                  margin: 0,
                }}
              >
                Database Synchronization
              </h3>
              <p
                style={{
                  color: "#9c97aa",
                  fontSize: 13,
                  marginTop: 6,
                  marginBottom: 0,
                }}
              >
                Bidirectional data sync in progress. Please wait...
              </p>
            </div>

            <div
              style={{
                width: "100%",
                background: "#121017",
                border: "1px solid #2b253b",
                borderRadius: 12,
                padding: "12px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <span style={{ color: "#a78bfa" }}>{syncProgressText}</span>
                <span style={{ color: "#14b8a6", fontFamily: "monospace" }}>
                  {syncTotalCount > 0
                    ? `${syncCurrentCount}/${syncTotalCount}`
                    : "Pending"}
                </span>
              </div>

              {syncTotalCount > 0 && (
                <div
                  style={{
                    width: "100%",
                    height: 6,
                    background: "#231e2e",
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(0, (syncCurrentCount / syncTotalCount) * 100))}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, #6d28d9, #14b8a6)",
                      borderRadius: 3,
                      transition: "width 0.3s ease-out",
                    }}
                  ></div>
                </div>
              )}
            </div>

            <div
              style={{
                fontSize: 11,
                color: "#6b7280",
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 4,
              }}
            >
              <div
                className="pulse-status-dot"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#14b8a6",
                }}
              ></div>
              <span>DO NOT CLOSE THE APP</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// SHARED COMPONENT: TOP BAR NAVIGATION
// ----------------------------------------------------
function TopBar({
  storeName,
  syncQueue,
  printer,
  currentScreen,
  onNavigate,
  onSync,
}: {
  storeName: string;
  syncQueue: number;
  printer: boolean;
  currentScreen: ScreenType;
  onNavigate: (s: ScreenType) => void;
  onSync: () => void;
}) {
  const { isOnline, isSyncing } = useStore();

  let statusColor = "#22c55e"; // Green
  let statusText = "Synced";
  if (!isOnline) {
    statusColor = "#ef4444"; // Red
    statusText = "Offline";
  } else if (isSyncing) {
    statusColor = "#eab308"; // Yellow
    statusText = "Syncing";
  }

  return (
    <header className="top-bar">
      <div
        className="logo-container"
        style={{ cursor: "pointer" }}
        onClick={() => onNavigate("home")}
      >
        <img
          src="/app-logo.png"
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            objectFit: "contain",
          }}
          alt="App Logo"
        />
        <span className="logo-text mobile-hide">{storeName.toUpperCase()}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Sync Status Badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            background: "#13111c",
            border: "1px solid #2b253b",
            padding: "6px 12px",
            borderRadius: 20,
            color: "#9c97aa",
            fontWeight: 600,
          }}
        >
          <div
            className={isSyncing ? "pulse-status-dot" : ""}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: statusColor,
              boxShadow: `0 0 8px ${statusColor}`,
            }}
          ></div>
          <span className="mobile-hide">{statusText.toUpperCase()}</span>
        </div>

        <button
          onClick={onSync}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.2)",
            padding: "6px 12px",
            borderRadius: 20,
            color: "#f59e0b",
            cursor: "pointer",
          }}
          disabled={isSyncing}
        >
          <RefreshCw size={13} className={isSyncing ? "animate-spin" : ""} />
          <span>
            <span className="mobile-hide">SYNC: </span>
            {syncQueue}
          </span>
        </button>

        <button
          onClick={() => onNavigate("settings")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            background: printer
              ? "rgba(20,184,166,0.1)"
              : "rgba(239,68,68,0.1)",
            border: "1px solid rgba(255,255,255,0.05)",
            padding: "6px 12px",
            borderRadius: 20,
            color: printer ? "#14b8a6" : "#ef4444",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: printer ? "#14b8a6" : "#ef4444",
            }}
          ></div>
          <span>
            <span className="mobile-hide">PRINTER: </span>
            {printer ? "ON" : "OFF"}
          </span>
        </button>

        {currentScreen !== "home" && (
          <button
            onClick={() => onNavigate("home")}
            style={{
              padding: "6px 12px",
              background: "#2b253b",
              borderRadius: 6,
              fontSize: 12,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            Home
          </button>
        )}
      </div>
    </header>
  );
}

// ----------------------------------------------------
// SCREEN 4: HOME SCREEN (Navigation Grid)
// ----------------------------------------------------
function HomeScreen({
  onNavigate,
  onSync,
}: {
  onNavigate: (s: ScreenType) => void;
  onSync: () => Promise<void>;
}) {
  const [syncing, setSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    setSyncDone(false);
    try {
      await onSync();
      setSyncDone(true);
      setTimeout(() => setSyncDone(false), 3000);
    } finally {
      setSyncing(false);
    }
  };

  const modules = [
    {
      id: "new_bill",
      title: "New Billing Terminal",
      desc: "Create retail/wholesale sales bills via voice, catalog, barcode",
      icon: <ShoppingCart size={28} />,
      color: "#f59e0b",
      highlight: true,
    },
    {
      id: "products",
      title: "Product Inventory",
      desc: "Manage catalog, custom retail rates, parent-child conversions & aliases",
      icon: <Database size={28} />,
      color: "#14b8a6",
    },
    {
      id: "categories",
      title: "Categories Settings",
      desc: "Manage product categories, display orders, and terminal catalog assignments",
      icon: <ShoppingBag size={28} />,
      color: "#f59e0b",
    },
    {
      id: "barcode",
      title: "Barcode Manager",
      desc: "Register standard barcode products and reassign references",
      icon: <Barcode size={28} />,
      color: "#3b82f6",
    },
    {
      id: "system_barcodes",
      title: "System Barcodes",
      desc: "Generate system barcodes for barcode-less products, reprint and delete labels",
      icon: <Barcode size={28} />,
      color: "#a78bfa",
    },
    {
      id: "history",
      title: "Sales History",
      desc: "View complete log of printed bills, cancel bills, and reprint",
      icon: <FileText size={28} />,
      color: "#8b5cf6",
    },
    {
      id: "khata",
      title: "Khata Credit Ledger",
      desc: "View customer accounts, record payments, and track outstanding balances",
      icon: <BookOpen size={28} />,
      color: "#ec4899",
    },
    {
      id: "reports",
      title: "Analytics Reports",
      desc: "Summaries of cash, credit & UPI sales, and total business analytics",
      icon: <TrendingUp size={28} />,
      color: "#10b981",
    },
    {
      id: "settings",
      title: "System Settings",
      desc: "Configure Bluetooth printer MAC, default store UPI, and AI keys",
      icon: <Settings size={28} />,
      color: "#6b7280",
    },
  ];

  return (
    <div
      style={{ maxWidth: 1000, margin: "0 auto", padding: "16px 0" }}
      className="animate-slide-up"
    >
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800 }}>
            Welcome, Shop Manager
          </h1>
          <p style={{ color: "#9c97aa", marginTop: 4 }}>
            Select a module below to start operations.
          </p>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 700,
            color: "#14b8a6",
            background: "rgba(20,184,166,0.08)",
            border: "1px solid rgba(20,184,166,0.15)",
            padding: "6px 12px",
            borderRadius: 20,
          }}
        >
          <CheckCircle size={14} />
          <span>Online</span>
        </div>
      </div>

      {/* Manual Sync Banner */}
      <div
        style={{
          marginBottom: 20,
          background: syncDone
            ? "rgba(34,197,94,0.08)"
            : "rgba(109,40,217,0.08)",
          border: `1px solid ${syncDone ? "rgba(34,197,94,0.3)" : "rgba(109,40,217,0.25)"}`,
          borderRadius: 14,
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: syncDone ? "#22c55e" : "#a78bfa",
            }}
          >
            {syncDone ? "✅ Sync Complete!" : "☁️ Supabase Bidirectional Sync"}
          </div>
          <div style={{ fontSize: 11, color: "#9c97aa", marginTop: 2 }}>
            {syncDone
              ? "All local and cloud data is fully synchronized."
              : "Sync latest products, customers, bills, and ledger bidirectionally"}
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 20px",
            borderRadius: 10,
            fontWeight: 700,
            fontSize: 13,
            border: "none",
            cursor: syncing ? "not-allowed" : "pointer",
            background: syncDone
              ? "rgba(34,197,94,0.2)"
              : "linear-gradient(135deg, #6d28d9, #a78bfa)",
            color: syncDone ? "#22c55e" : "#fff",
            opacity: syncing ? 0.7 : 1,
            transition: "all 0.2s",
          }}
        >
          <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing..." : syncDone ? "Synced!" : "Sync Now"}
        </button>
      </div>

      <div className="modules-grid">
        {modules.map((mod) => (
          <div
            key={mod.id}
            className="pos-card animate-fade-in"
            onClick={() => onNavigate(mod.id as ScreenType)}
            style={{
              cursor: "pointer",
              borderTop: mod.highlight
                ? `4px solid ${mod.color}`
                : `1px solid var(--border-color)`,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              minHeight: 150,
            }}
          >
            <div>
              <div style={{ color: mod.color, marginBottom: 12 }}>
                {mod.icon}
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
                {mod.title}
              </h3>
              <p style={{ fontSize: 12, color: "#9c97aa", lineHeight: 1.4 }}>
                {mod.desc}
              </p>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                color: mod.color,
                marginTop: 8,
              }}
            >
              <ChevronRight size={18} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// SCREEN 5: NEW BILLING TERMINAL
// ----------------------------------------------------
interface BillingProps {
  activeBill: any;
  products: Product[];
  customers: Customer[];
  khataRecords: KhataRecord[];
  draftRecoverable: boolean;
  onRecoverDraft: () => void;
  onDiscardDraft: () => void;
  onAddItem: (p: Product, qty: number, unit?: string) => void;
  onRemoveItem: (id: number) => void;
  onEditItem: (
    id: number,
    qty: number,
    unit?: string,
    price?: number,
    nameOverride?: string,
    originalUnit?: string,
  ) => void;
  onSetCustomer: (id?: number, name?: string, phone?: string) => void;
  onSetDiscount: (amt: number) => void;
  onSetPaymentMode: (mode: "Cash" | "UPI" | "Credit") => void;
  onCheckout: () => Promise<Bill | null>;
  printerConfig: PrinterConfig;
  onBack: () => void;
  onGoToHistory: () => void;
  handlePickContact: (onSelect: (name: string, phone: string) => void) => void;
}

// Sub-component for desktop cart item row to prevent auto-fill with 0
function DesktopCartItemRow({
  item,
  onEditItem,
  onRemoveItem,
  getProductUnits,
}: {
  item: any;
  onEditItem: (
    id: number,
    qty: number,
    unit?: string,
    price?: number,
    nameOverride?: string,
    originalUnit?: string,
  ) => void;
  onRemoveItem: (id: number) => void;
  getProductUnits: (id: number) => string[];
}) {
  const [qtyText, setQtyText] = useState(String(item.quantity));
  const [priceText, setPriceText] = useState(String(item.price));
  const [nameText, setNameText] = useState(item.product_name);
  const [totalText, setTotalText] = useState(String(item.total));

  useEffect(() => {
    if (parseFloat(qtyText) !== item.quantity) {
      setQtyText(String(item.quantity));
    }
  }, [item.quantity]);

  useEffect(() => {
    if (parseFloat(priceText) !== item.price) {
      setPriceText(String(item.price));
    }
  }, [item.price]);

  useEffect(() => {
    if (nameText !== item.product_name) {
      setNameText(item.product_name);
    }
  }, [item.product_name]);

  useEffect(() => {
    if (parseFloat(totalText) !== item.total) {
      setTotalText(String(item.total));
    }
  }, [item.total]);

  const handleQtyChange = (val: string) => {
    if (val.toLowerCase() === "na") {
      onEditItem(item.product_id, 1, "NA", undefined, undefined, item.unit);
    } else {
      setQtyText(val);
      const parsed = parseFloat(val);
      if (!isNaN(parsed) && parsed >= 0) {
        const newUnit = item.unit === "NA" ? "Piece" : item.unit;
        onEditItem(
          item.product_id,
          parsed,
          newUnit,
          undefined,
          undefined,
          item.unit,
        );
      }
    }
  };

  const handlePriceChange = (val: string) => {
    setPriceText(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed >= 0) {
      onEditItem(
        item.product_id,
        item.quantity,
        item.unit,
        parsed,
        undefined,
        item.unit,
      );
    }
  };

  const handleNameChange = (val: string) => {
    setNameText(val);
    onEditItem(
      item.product_id,
      item.quantity,
      item.unit,
      undefined,
      val,
      item.unit,
    );
  };

  const handleTotalChange = (val: string) => {
    setTotalText(val);
    const parsedTotal = parseFloat(val);
    if (!isNaN(parsedTotal) && parsedTotal >= 0 && item.quantity > 0) {
      const calculatedPrice = +(parsedTotal / item.quantity).toFixed(6);
      onEditItem(
        item.product_id,
        item.quantity,
        item.unit,
        calculatedPrice,
        undefined,
        item.unit,
      );
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        padding: "8px 0",
        borderBottom: "1px solid #201b2d",
        whiteSpace: "normal",
      }}
    >
      {/* Line 1: Product Name (left), total price input and delete X (right) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        {item.product_id < 0 ? (
          <input
            type="text"
            value={nameText}
            onChange={(e) => handleNameChange(e.target.value)}
            style={{
              width: "60%",
              padding: "2px 4px",
              background: "#0b0a0f",
              border: "1px solid #2b253b",
              borderRadius: 4,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
            }}
          />
        ) : (
          <span
            style={{
              fontWeight: 600,
              fontSize: 14,
              color: "#fff",
              whiteSpace: "normal",
              wordBreak: "break-word",
              flex: 1,
              paddingRight: 8,
            }}
          >
            {item.product_name}
          </span>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
            <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>
              ₹
            </span>
            <input
              type="number"
              step="0.01"
              value={totalText}
              onChange={(e) => handleTotalChange(e.target.value)}
              style={{
                width: 68,
                padding: "2px 0",
                background: "transparent",
                border: "none",
                borderBottom: "1px dashed #3a334e",
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                fontFamily: "monospace",
                outline: "none",
                textAlign: "right",
              }}
            />
          </div>
          <button
            onClick={() => onRemoveItem(item.product_id)}
            style={{
              display: "flex",
              justifyContent: "center",
              background: "transparent",
              color: "#ef4444",
              border: "none",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Line 2: Quantity input, Unit select dropdown (left) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <input
            type="text"
            value={item.unit === "NA" && item.quantity === 1 ? "NA" : qtyText}
            onChange={(e) => handleQtyChange(e.target.value)}
            style={{
              width: 48,
              padding: "2px 0",
              background: "transparent",
              border: "none",
              borderBottom: "1px dashed #3a334e",
              color: "#fff",
              fontSize: 13,
              fontWeight: "bold",
              textAlign: "left",
              outline: "none",
            }}
          />
          <select
            value={(() => {
              const units = getProductUnits(item.product_id);
              return (
                units.find(
                  (u) => u.toLowerCase() === item.unit.toLowerCase(),
                ) || item.unit
              );
            })()}
            onChange={(e) => {
              const newUnit = e.target.value;
              const oldUnit = item.unit;
              const oldNorm = oldUnit.toLowerCase();
              const newNorm = newUnit.toLowerCase();

              // Weight conversion factors (in KG)
              const weightFactor = (u: string) => {
                if (u === "kg" || u === "kgs") return 1;
                if (u === "gram" || u === "grams" || u === "g") return 0.001;
                return null;
              };
              // Volume conversion factors (in Litre)
              const volumeFactor = (u: string) => {
                if (
                  u === "litre" ||
                  u === "litres" ||
                  u === "liter" ||
                  u === "liters"
                )
                  return 1;
                if (u === "ml" || u === "mls") return 0.001;
                return null;
              };

              const oldW = weightFactor(oldNorm);
              const newW = weightFactor(newNorm);
              const oldV = volumeFactor(oldNorm);
              const newV = volumeFactor(newNorm);

              if (oldW !== null && newW !== null && oldW !== newW) {
                const ratio = oldW / newW;
                const newQty = +(item.quantity * ratio).toFixed(4);
                const newPrice = +(item.price / ratio).toFixed(6);
                onEditItem(
                  item.product_id,
                  newQty,
                  newUnit,
                  newPrice,
                  undefined,
                  item.unit,
                );
              } else if (oldV !== null && newV !== null && oldV !== newV) {
                const ratio = oldV / newV;
                const newQty = +(item.quantity * ratio).toFixed(4);
                const newPrice = +(item.price / ratio).toFixed(6);
                onEditItem(
                  item.product_id,
                  newQty,
                  newUnit,
                  newPrice,
                  undefined,
                  item.unit,
                );
              } else {
                onEditItem(
                  item.product_id,
                  item.quantity,
                  newUnit,
                  undefined,
                  undefined,
                  item.unit,
                );
              }
            }}
            style={{
              marginLeft: 4,
              padding: "2px 0",
              background: "transparent",
              border: "none",
              color: "#9c97aa",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              outline: "none",
            }}
          >
            {getProductUnits(item.product_id).map((u) => (
              <option
                key={u}
                value={u}
                style={{ background: "#121017", color: "#fff" }}
              >
                {formatUnitShort(u)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Line 3: Rate per unit (left, e.g. ₹38/kg) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          fontSize: 12,
          color: "#9c97aa",
        }}
      >
        <span>₹</span>
        <input
          type="number"
          step="0.01"
          value={priceText}
          onChange={(e) => handlePriceChange(e.target.value)}
          style={{
            width: 48,
            padding: "1px 0",
            background: "transparent",
            border: "none",
            borderBottom: "1px dashed #3a334e",
            color: "#9c97aa",
            fontSize: 12,
            fontFamily: "monospace",
            outline: "none",
            textAlign: "left",
            margin: "0 2px",
          }}
        />
        <span>/{formatUnitShort(item.unit)}</span>
      </div>
    </div>
  );
}

// Sub-component for mobile cart item row to prevent auto-fill with 0
function MobileCartItemRow({
  item,
  onEditItem,
  onRemoveItem,
  getProductUnits,
}: {
  item: any;
  onEditItem: (
    id: number,
    qty: number,
    unit?: string,
    price?: number,
    nameOverride?: string,
    originalUnit?: string,
  ) => void;
  onRemoveItem: (id: number) => void;
  getProductUnits: (id: number) => string[];
}) {
  const [qtyText, setQtyText] = useState(String(item.quantity));
  const [priceText, setPriceText] = useState(String(item.price));
  const [nameText, setNameText] = useState(item.product_name);
  const [totalText, setTotalText] = useState(String(item.total));

  useEffect(() => {
    if (parseFloat(qtyText) !== item.quantity) {
      setQtyText(String(item.quantity));
    }
  }, [item.quantity]);

  useEffect(() => {
    if (parseFloat(priceText) !== item.price) {
      setPriceText(String(item.price));
    }
  }, [item.price]);

  useEffect(() => {
    if (nameText !== item.product_name) {
      setNameText(item.product_name);
    }
  }, [item.product_name]);

  useEffect(() => {
    if (parseFloat(totalText) !== item.total) {
      setTotalText(String(item.total));
    }
  }, [item.total]);

  const handleQtyChange = (val: string) => {
    if (val.toLowerCase() === "na") {
      onEditItem(item.product_id, 1, "NA", undefined, undefined, item.unit);
    } else {
      setQtyText(val);
      const parsed = parseFloat(val);
      if (!isNaN(parsed) && parsed >= 0) {
        const newUnit = item.unit === "NA" ? "Piece" : item.unit;
        onEditItem(
          item.product_id,
          parsed,
          newUnit,
          undefined,
          undefined,
          item.unit,
        );
      }
    }
  };

  const handlePriceChange = (val: string) => {
    setPriceText(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed >= 0) {
      onEditItem(
        item.product_id,
        item.quantity,
        item.unit,
        parsed,
        undefined,
        item.unit,
      );
    }
  };

  const handleNameChange = (val: string) => {
    setNameText(val);
    onEditItem(
      item.product_id,
      item.quantity,
      item.unit,
      undefined,
      val,
      item.unit,
    );
  };

  const handleTotalChange = (val: string) => {
    setTotalText(val);
    const parsedTotal = parseFloat(val);
    if (!isNaN(parsedTotal) && parsedTotal >= 0 && item.quantity > 0) {
      const calculatedPrice = +(parsedTotal / item.quantity).toFixed(6);
      onEditItem(
        item.product_id,
        item.quantity,
        item.unit,
        calculatedPrice,
        undefined,
        item.unit,
      );
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        padding: "8px 0",
        borderBottom: "1px solid #201b2d",
        whiteSpace: "normal",
      }}
    >
      {/* Line 1: Product Name (left), total price input and delete X (right) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        {item.product_id < 0 ? (
          <input
            type="text"
            value={nameText}
            onChange={(e) => handleNameChange(e.target.value)}
            style={{
              width: "60%",
              padding: "2px 4px",
              background: "#0b0a0f",
              border: "1px solid #2b253b",
              borderRadius: 4,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
            }}
          />
        ) : (
          <span
            style={{
              fontWeight: 600,
              fontSize: 14,
              color: "#fff",
              whiteSpace: "normal",
              wordBreak: "break-word",
              flex: 1,
              paddingRight: 8,
            }}
          >
            {item.product_name}
          </span>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
            <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>
              ₹
            </span>
            <input
              type="number"
              step="0.01"
              value={totalText}
              onChange={(e) => handleTotalChange(e.target.value)}
              style={{
                width: 68,
                padding: "2px 0",
                background: "transparent",
                border: "none",
                borderBottom: "1px dashed #3a334e",
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                fontFamily: "monospace",
                outline: "none",
                textAlign: "right",
              }}
            />
          </div>
          <button
            onClick={() => onRemoveItem(item.product_id)}
            style={{
              display: "flex",
              justifyContent: "center",
              background: "transparent",
              color: "#ef4444",
              border: "none",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Line 2: Quantity input, Unit select dropdown (left) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <input
            type="text"
            value={item.unit === "NA" && item.quantity === 1 ? "NA" : qtyText}
            onChange={(e) => handleQtyChange(e.target.value)}
            style={{
              width: 48,
              padding: "2px 0",
              background: "transparent",
              border: "none",
              borderBottom: "1px dashed #3a334e",
              color: "#fff",
              fontSize: 13,
              fontWeight: "bold",
              textAlign: "left",
              outline: "none",
            }}
          />
          <select
            value={(() => {
              const units = getProductUnits(item.product_id);
              return (
                units.find(
                  (u) => u.toLowerCase() === item.unit.toLowerCase(),
                ) || item.unit
              );
            })()}
            onChange={(e) => {
              const newUnit = e.target.value;
              const oldUnit = item.unit;
              const oldNorm = oldUnit.toLowerCase();
              const newNorm = newUnit.toLowerCase();

              // Weight conversion factors (in KG)
              const weightFactor = (u: string) => {
                if (u === "kg" || u === "kgs") return 1;
                if (u === "gram" || u === "grams" || u === "g") return 0.001;
                return null;
              };
              // Volume conversion factors (in Litre)
              const volumeFactor = (u: string) => {
                if (
                  u === "litre" ||
                  u === "litres" ||
                  u === "liter" ||
                  u === "liters"
                )
                  return 1;
                if (u === "ml" || u === "mls") return 0.001;
                return null;
              };

              const oldW = weightFactor(oldNorm);
              const newW = weightFactor(newNorm);
              const oldV = volumeFactor(oldNorm);
              const newV = volumeFactor(newNorm);

              if (oldW !== null && newW !== null && oldW !== newW) {
                const ratio = oldW / newW;
                const newQty = +(item.quantity * ratio).toFixed(4);
                const newPrice = +(item.price / ratio).toFixed(6);
                onEditItem(
                  item.product_id,
                  newQty,
                  newUnit,
                  newPrice,
                  undefined,
                  item.unit,
                );
              } else if (oldV !== null && newV !== null && oldV !== newV) {
                const ratio = oldV / newV;
                const newQty = +(item.quantity * ratio).toFixed(4);
                const newPrice = +(item.price / ratio).toFixed(6);
                onEditItem(
                  item.product_id,
                  newQty,
                  newUnit,
                  newPrice,
                  undefined,
                  item.unit,
                );
              } else {
                onEditItem(
                  item.product_id,
                  item.quantity,
                  newUnit,
                  undefined,
                  undefined,
                  item.unit,
                );
              }
            }}
            style={{
              marginLeft: 4,
              padding: "2px 0",
              background: "transparent",
              border: "none",
              color: "#9c97aa",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              outline: "none",
            }}
          >
            {getProductUnits(item.product_id).map((u) => (
              <option
                key={u}
                value={u}
                style={{ background: "#121017", color: "#fff" }}
              >
                {formatUnitShort(u)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Line 3: Rate per unit (left, e.g. ₹38/kg) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          fontSize: 12,
          color: "#9c97aa",
        }}
      >
        <span>₹</span>
        <input
          type="number"
          step="0.01"
          value={priceText}
          onChange={(e) => handlePriceChange(e.target.value)}
          style={{
            width: 48,
            padding: "1px 0",
            background: "transparent",
            border: "none",
            borderBottom: "1px dashed #3a334e",
            color: "#9c97aa",
            fontSize: 12,
            fontFamily: "monospace",
            outline: "none",
            textAlign: "left",
            margin: "0 2px",
          }}
        />
        <span>/{formatUnitShort(item.unit)}</span>
      </div>
    </div>
  );
}

function BillingTerminal({
  activeBill,
  products,
  customers,
  khataRecords,
  draftRecoverable,
  onRecoverDraft,
  onDiscardDraft,
  onAddItem,
  onRemoveItem,
  onEditItem,
  onSetCustomer,
  onSetDiscount,
  onSetPaymentMode,
  onCheckout,
  printerConfig,
  onBack,
  onGoToHistory,
  handlePickContact,
}: BillingProps) {
  const { showPrintingProgressModal, printingStatusText } = useStore();
  const [custSuggestions, setCustSuggestions] = useState<Customer[]>([]);
  const [_recentCustomers, setRecentCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const latestSearchQueryRef = useRef("");

  const [catalogSearchQuery, setCatalogSearchQuery] = useState("");
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [recentlyAdded, setRecentlyAdded] = useState<Record<number, boolean>>(
    {},
  );

  useEffect(() => {
    setCatalogPage(1);
  }, [catalogSearchQuery]);
  const [simulatedVoiceText, setSimulatedVoiceText] = useState("");

  const [showPrinterOfflineModal, setShowPrinterOfflineModal] = useState(false);
  const [showNoPrinterModal, setShowNoPrinterModal] = useState(false);
  const [retryPrintLoading, setRetryPrintLoading] = useState(false);
  const [retryPrintError, setRetryPrintError] = useState("");
  // Bill that was saved but whose print failed — used for reprint
  const [printFailedBill, setPrintFailedBill] = useState<any>(null);

  useEffect(() => {
    db.getBills().then((allBills) => {
      // Frequency Map based on all bills (overall most ordered for catalog)
      const generalFreq: Record<number, number> = {};
      allBills.forEach((b) => {
        if (b.status !== "Cancelled") {
          b.items.forEach((item) => {
            generalFreq[item.product_id] =
              (generalFreq[item.product_id] || 0) + item.quantity;
          });
        }
      });

      // 1. Arrange Catalog Products (no barcode, Weight/Volume units only) by overall frequency of orders descending
      const noBarcodeProds = products.filter(
        (p) =>
          (p.category_id === 1 ||
            p.category_id === 2 ||
            p.product_type === "WEIGHT" ||
            p.product_type === "VOLUME") &&
          (!p.barcode ||
            p.barcode.startsWith("SYS-") ||
            p.barcode.startsWith("sys-")),
      );
      const sortedCatalog = noBarcodeProds.sort((a, b) => {
        const freqA = generalFreq[a.id] || 0;
        const freqB = generalFreq[b.id] || 0;
        return freqB - freqA;
      });
      setCatalogProducts(sortedCatalog);

      // 2. Top 5 most used barcode products daily (created in last 24 hours, fallback to 7 days, then to all bills)
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      let dailyBills = allBills.filter(
        (b) => b.status !== "Cancelled" && new Date(b.created_at) >= oneDayAgo,
      );
      if (dailyBills.length === 0) {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        dailyBills = allBills.filter(
          (b) =>
            b.status !== "Cancelled" && new Date(b.created_at) >= sevenDaysAgo,
        );
      }
      if (dailyBills.length === 0) {
        dailyBills = allBills.filter((b) => b.status !== "Cancelled");
      }

      const dailyFreq: Record<number, number> = {};
      dailyBills.forEach((b) => {
        b.items.forEach((item) => {
          dailyFreq[item.product_id] =
            (dailyFreq[item.product_id] || 0) + item.quantity;
        });
      });

      // 3. Extract Recent/Frequent Customers
      const customerFreq: Record<number, number> = {};
      allBills.forEach((b) => {
        if (b.customer_id) {
          customerFreq[b.customer_id] = (customerFreq[b.customer_id] || 0) + 1;
        }
      });
      const sortedCustomerIds = Object.keys(customerFreq)
        .map(Number)
        .sort((a, b) => customerFreq[b] - customerFreq[a]);
      const frequentCusts = sortedCustomerIds
        .map((id) => customers.find((c) => c.id === id))
        .filter((c): c is Customer => !!c)
        .slice(0, 4);
      if (frequentCusts.length < 4) {
        const extra = customers
          .filter((c) => !frequentCusts.some((fc) => fc.id === c.id))
          .slice(0, 4 - frequentCusts.length);
        setRecentCustomers([...frequentCusts, ...extra]);
      } else {
        setRecentCustomers(frequentCusts);
      }
    });
  }, [products, customers, activeBill.items.length]);

  // Product billing quantity & unit selector states
  const [selectedAddProduct, setSelectedAddProduct] = useState<Product | null>(
    null,
  );
  const [addQuantity, setAddQuantity] = useState<number>(1);
  const [addUnit, setAddUnit] = useState<string>("");

  // Categories for smart unit dropdown
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    db.getCategories().then(setCategories);
  }, []);

  // ── ONE-TIME FAMILY BARCODE MIGRATION ──────────────────────────────────────
  // Runs once when products are loaded. Scans all products, groups them by
  // getBaseBrandName, and ensures ONLY ONE active barcode maps to the main product,
  // deactivating duplicate barcodes (marking them deleted and changing barcode string
  // to avoid Supabase unique index violations).
  useEffect(() => {
    if (!products || products.length === 0) return;
    const migrationKey = "family_barcode_migration_v4";
    if (localStorage.getItem(migrationKey)) return; // already ran

    (async () => {
      try {
        const allBarcodes = db.getRawList<DbBarcode>("sr_barcodes");
        // Group products by base brand name
        const groups = new Map<string, Product[]>();
        products.forEach((p) => {
          if ((p as any).is_deleted) return;
          const base = getBaseBrandName(p.display_name);
          if (!groups.has(base)) groups.set(base, []);
          groups.get(base)!.push(p);
        });

        let updatedBarcodesList = [...allBarcodes];
        let changed = false;

        for (const [base, members] of groups) {
          if (members.length === 0) continue;

          // Find the main product/variant of the family to be the barcode owner
          const sortedMembers = [...members].sort((a, b) => {
            const aIsMain =
              !/\b(piece|pieces|pc|pcs|bag|bags|carton|cartons|cartoon|cartoons|tray|trays|sheet|sheets|pudha|pudhas|puda|pudas)\b/i.test(
                a.display_name,
              );
            const bIsMain =
              !/\b(piece|pieces|pc|pcs|bag|bags|carton|cartons|cartoon|cartoons|tray|trays|sheet|sheets|pudha|pudhas|puda|pudas)\b/i.test(
                b.display_name,
              );
            if (aIsMain && !bIsMain) return -1;
            if (!aIsMain && bIsMain) return 1;
            return (a.retail_price || 0) - (b.retail_price || 0);
          });
          const owner = sortedMembers[0];

          const memberIds = members.map((m) => m.id);
          const familyBarcodes = allBarcodes.filter(
            (b) =>
              memberIds.includes(b.product_id) && b.is_active && !b.is_deleted,
          );

          if (familyBarcodes.length === 0) continue;

          // Find the best shared barcode string
          let sharedBarcode = familyBarcodes.find(
            (b) => !b.is_system && !b.barcode.toLowerCase().startsWith("sys-"),
          )?.barcode;
          if (!sharedBarcode) {
            sharedBarcode = familyBarcodes.find(
              (b) =>
                b.barcode.startsWith("SYS-") && !b.barcode.includes("-", 4),
            )?.barcode;
          }
          if (!sharedBarcode) {
            sharedBarcode = familyBarcodes[0].barcode;
          }

          console.log(
            `[Migration V4] Family "${base}" (owner: ${owner.display_name}) chosen shared barcode: ${sharedBarcode}`,
          );

          // Ensure only the owner has this barcode active
          let primaryRecord = updatedBarcodesList.find(
            (b) => b.product_id === owner.id && b.barcode === sharedBarcode,
          );

          if (!primaryRecord) {
            // Check if there is ANY record with this barcode string (e.g. mapped to another member)
            const duplicate = updatedBarcodesList.find(
              (b) => b.barcode === sharedBarcode && !b.is_deleted,
            );
            if (duplicate) {
              // Update it in-place to map to the owner!
              const idx = updatedBarcodesList.findIndex(
                (b) => b.id === duplicate.id,
              );
              if (idx !== -1) {
                updatedBarcodesList[idx] = {
                  ...updatedBarcodesList[idx],
                  product_id: owner.id,
                  is_active: true,
                  is_deleted: false,
                  updated_at: new Date().toISOString(),
                  version: (updatedBarcodesList[idx].version || 1) + 1,
                };
                db.addToSyncQueue(
                  "barcodes",
                  String(duplicate.id),
                  "UPDATE",
                  updatedBarcodesList[idx],
                );
                primaryRecord = updatedBarcodesList[idx];
                changed = true;
              }
            } else {
              // Create new record for the owner
              const devId = db.getSetting("device_id") || "unknown";
              const newId =
                updatedBarcodesList.reduce(
                  (max, item) => (item.id > max ? item.id : max),
                  0,
                ) + 1;
              const newB = {
                id: newId,
                product_id: owner.id,
                barcode: sharedBarcode!,
                barcode_type: "Code-128",
                unit: owner.units?.[0]?.unit_name || "Piece",
                is_system: sharedBarcode!.toLowerCase().startsWith("sys-"),
                is_active: true,
                is_deleted: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                version: 1,
                updated_by: devId,
              };
              updatedBarcodesList.push(newB);
              db.addToSyncQueue("barcodes", String(newId), "INSERT", newB);
              primaryRecord = newB;
              changed = true;
            }
          } else {
            // Ensure it is active & not deleted
            const idx = updatedBarcodesList.findIndex(
              (b) => b.id === primaryRecord!.id,
            );
            if (
              idx !== -1 &&
              (!updatedBarcodesList[idx].is_active ||
                updatedBarcodesList[idx].is_deleted)
            ) {
              updatedBarcodesList[idx] = {
                ...updatedBarcodesList[idx],
                is_active: true,
                is_deleted: false,
                updated_at: new Date().toISOString(),
                version: (updatedBarcodesList[idx].version || 1) + 1,
              };
              db.addToSyncQueue(
                "barcodes",
                String(primaryRecord.id),
                "UPDATE",
                updatedBarcodesList[idx],
              );
              changed = true;
            }
          }

          // Deactivate all OTHER barcode records in the family that have the same barcode string OR are system barcodes
          familyBarcodes.forEach((b) => {
            if (primaryRecord && b.id === primaryRecord.id) return;
            const isDuplicateBarcodeString = b.barcode === sharedBarcode;
            const isSystemBarcode =
              b.is_system || b.barcode.toLowerCase().startsWith("sys-");
            if (isDuplicateBarcodeString || isSystemBarcode) {
              const idx = updatedBarcodesList.findIndex((x) => x.id === b.id);
              if (
                idx !== -1 &&
                (updatedBarcodesList[idx].is_active ||
                  !updatedBarcodesList[idx].is_deleted)
              ) {
                const prev = updatedBarcodesList[idx];
                updatedBarcodesList[idx] = {
                  ...prev,
                  is_active: false,
                  is_deleted: true,
                  barcode: prev.barcode.includes("-deleted-")
                    ? prev.barcode
                    : `${prev.barcode}-deleted-${prev.id}`,
                  updated_at: new Date().toISOString(),
                  version: (prev.version || 1) + 1,
                };
                db.addToSyncQueue(
                  "barcodes",
                  String(b.id),
                  "UPDATE",
                  updatedBarcodesList[idx],
                );
                changed = true;
              }
            }
          });
        }

        if (changed) {
          db.saveList("sr_barcodes", updatedBarcodesList);
          await db.rebuildProductsCache();
          useStore.getState().triggerSync();
        }

        localStorage.setItem(migrationKey, "1");
        console.log("[Migration V4] Family barcode consolidation complete");
      } catch (err) {
        console.error("[Migration V4] Family barcode migration failed:", err);
      }
    })();
  }, [products.length > 0 ? "loaded" : "empty"]);

  // Customer name & phone states for billing modal
  const [showCustomerModal, setShowCustomerModal] = useState(() => {
    const hasItems =
      activeBill && activeBill.items && activeBill.items.length > 0;
    const hasCustomer =
      activeBill &&
      activeBill.customer_name &&
      activeBill.customer_name !== "Customer" &&
      activeBill.customer_name !== "";
    return !hasItems && !hasCustomer;
  });
  const [customerNameInput, setCustomerNameInput] = useState("");
  const [customerPhoneInput, setCustomerPhoneInput] = useState("");

  // Wholesale / MRP price mode toggle
  const [isWholesale, setIsWholesale] = useState(true);
  // Ref so handlers always read the latest value without stale closures
  const isWholesaleRef = React.useRef(true);
  isWholesaleRef.current = isWholesale;

  // Re-price all cart items when switching price mode.
  // Uses a wholesale/retail ratio so sub-unit prices (e.g. 500g) scale correctly.
  const applyPriceMode = (wholesale: boolean) => {
    activeBill.items.forEach((item: any) => {
      const prod = products.find((p) => p.id === item.product_id);
      if (!prod || !prod.retail_price) return;
      const { resolvedPrice } = resolveUnitAndPrice(prod, 1, item.unit);
      const ratio =
        prod.retail_price > 0 ? prod.wholesale_price / prod.retail_price : 1;
      const newPrice = wholesale
        ? +(resolvedPrice * ratio).toFixed(2)
        : +resolvedPrice.toFixed(2);
      onEditItem(item.product_id, item.quantity, item.unit, newPrice);
    });
  };

  const handleTogglePriceMode = (wholesale: boolean) => {
    setIsWholesale(wholesale);
    applyPriceMode(wholesale);
  };

  // Wrapper for onAddItem: when wholesale mode is active, override price to wholesale
  // after the item lands in the cart (Zustand state settles after the call).
  const handleAddItem = (prod: Product, qty: number, unit?: string) => {
    onAddItem(prod, qty, unit);
    playSuccessBeep();
    if (isWholesaleRef.current) {
      setTimeout(() => {
        const cart = useStore.getState().activeBill.items;
        const cartItem = cart.find((i: any) => i.product_id === prod.id);
        if (cartItem) {
          const { resolvedWholesalePrice } = resolveUnitAndPrice(
            prod,
            cartItem.quantity,
            cartItem.unit,
          );
          onEditItem(
            prod.id,
            cartItem.quantity,
            cartItem.unit,
            resolvedWholesalePrice,
          );
        }
      }, 0);
    }
  };

  const handleEditItem = (
    id: number,
    qty: number,
    unit?: string,
    price?: number,
    nameOverride?: string,
    originalUnit?: string,
  ) => {
    // Case 1: explicit price override passed in -- just pass through
    if (price !== undefined) {
      onEditItem(id, qty, unit, price, nameOverride, originalUnit);
      return;
    }

    const prod = products.find((p) => p.id === id);
    if (!prod) {
      onEditItem(id, qty, unit, undefined, nameOverride, originalUnit);
      return;
    }

    let targetQty = qty;
    if (
      unit &&
      originalUnit &&
      (prod.category_id === 1 || prod.category_id === 2)
    ) {
      const origQtyInBase = getUnitBaseQuantity(originalUnit, prod);
      const destQtyInBase = getUnitBaseQuantity(unit, prod);
      if (origQtyInBase > 0 && destQtyInBase > 0) {
        targetQty = qty * (origQtyInBase / destQtyInBase);
      }
    }

    if (unit) {
      const base = getBaseBrandName(prod.display_name);
      const familyProducts = products.filter(
        (p) => getBaseBrandName(p.display_name) === base,
      );

      // Find the product in the family that owns this unit (e.g. Bag product for "Bag" unit)
      const targetProd =
        findProductInFamilyForUnit(familyProducts, unit) ?? prod;

      const { resolvedPrice, resolvedWholesalePrice } = resolveUnitAndPrice(
        targetProd,
        targetQty,
        unit,
      );
      const resolved = isWholesaleRef.current
        ? resolvedWholesalePrice
        : resolvedPrice;

      // Use originalUnit to find the exact cart item, pass resolved price override
      onEditItem(id, targetQty, unit, resolved, nameOverride, originalUnit);

      // If wholesale mode is active and unit changed, re-apply wholesale after store settles
      const currentUnit =
        originalUnit ||
        activeBill.items.find((i: any) => i.product_id === id)?.unit;
      const unitChanging =
        currentUnit && unit.toLowerCase() !== currentUnit.toLowerCase();
      if (unitChanging && isWholesaleRef.current) {
        setTimeout(() => applyPriceMode(true), 0);
      }
    } else {
      // No unit specified -- resolve from current product
      const { resolvedPrice, resolvedWholesalePrice } = resolveUnitAndPrice(
        prod,
        targetQty,
        unit,
      );
      const resolved = isWholesaleRef.current
        ? resolvedWholesalePrice
        : resolvedPrice;
      onEditItem(id, targetQty, unit, resolved, nameOverride, originalUnit);
    }
  };

  const handleAddCustomItem = () => {
    let nextNum = 1;
    const existingNames = activeBill.items.map((i: any) =>
      i.product_name.toLowerCase().trim(),
    );
    while (
      existingNames.includes(`item${nextNum}`) ||
      existingNames.includes(`item ${nextNum}`)
    ) {
      nextNum++;
    }
    const name = `item${nextNum}`;

    const existingIds = activeBill.items.map((i: any) => i.product_id);
    const minId = existingIds.length > 0 ? Math.min(...existingIds) : 0;
    const newId = minId < 0 ? minId - 1 : -1;

    const customProduct = {
      id: newId,
      display_name: name,
      retail_price: 0,
      wholesale_price: 0,
      units: [],
    };
    handleAddItem(customProduct as any, 1, "Piece");
  };

  const handleShareCurrentBillWhatsApp = async () => {
    if (!printedBill) return;

    const storeName = useStore.getState().storeName;
    // 1. Generate PDF
    const pdfBlob = generateBillPDF(printedBill, storeName);

    // 2. Generate WhatsApp Text Summary
    const itemsList = printedBill.items
      .map(
        (itm, idx) =>
          `${idx + 1}. ${itm.product_name} x ${itm.quantity} ${itm.unit} @ Rs.${itm.price.toFixed(0)} = Rs.${itm.total.toFixed(0)}`,
      )
      .join("\n");

    const summary = `🧾 *${storeName.toUpperCase()} - BILL RECEIPT*
----------------------------------------
*Bill No:* #${printedBill.bill_number}
*Date:* ${new Date(printedBill.created_at).toLocaleDateString()}
*Customer:* ${printedBill.customer_name || "Guest"} (${printedBill.customer_phone || "NA"})
*Payment Mode:* ${printedBill.payment_mode}

*Items:*
${itemsList}

----------------------------------------
*Subtotal:* Rs. ${printedBill.subtotal.toFixed(2)}
*Discount:* Rs. ${printedBill.discount.toFixed(2)}
*Grand Total:* Rs. ${printedBill.grand_total.toFixed(2)}

Thank you for shopping with us! 🙏`;

    // 3. Share
    await shareViaWhatsApp(
      printedBill.customer_phone || "NA",
      summary,
      pdfBlob,
      `Bill_${printedBill.bill_number}.pdf`,
    );
  };

  const playSuccessBeep = async () => {
    try {
      const audioCtx = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      osc.frequency.exponentialRampToValueAtTime(
        1320,
        audioCtx.currentTime + 0.1,
      ); // Slide up to E6

      gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.001,
        audioCtx.currentTime + 0.15,
      ); // Smooth decay

      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);

      // Centralized Haptic Feedback (Capacitor plugin fallback to navigator)
      if (Capacitor.isPluginAvailable("Haptics")) {
        await Haptics.impact({ style: ImpactStyle.Medium });
      } else if (navigator.vibrate) {
        navigator.vibrate(80); // 80ms short vibration pulse
      }
    } catch (e) {
      console.warn(
        "AudioContext/Vibration/Haptics not supported or blocked by browser policy:",
        e,
      );
    }
  };

  // Tab control inside billing helper panels
  const [inputTab, setInputTab] = useState<"scan" | "catalog">("scan");

  const [catalogCategories, setCatalogCategories] = useState<CatalogCategory[]>([]);
  const [productMappings, setProductMappings] = useState<ProductCategory[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<string>("all");
  const [recentProductIds, setRecentProductIds] = useState<number[]>([]);
  
  // Quick category modal states
  const [showQuickCategoryModal, setShowQuickCategoryModal] = useState(false);
  const [quickCatName, setQuickCatName] = useState("");
  
  // Long press / detail modal states
  const longPressTimeout = useRef<any>(null);
  const isLongPressActive = useRef(false);
  const [longPressedProduct, setLongPressedProduct] = useState<Product | null>(null);
  const [editProdPrice, setEditProdPrice] = useState("");
  const [editProdWholesale, setEditProdWholesale] = useState("");

  useEffect(() => {
    if (longPressedProduct) {
      setEditProdPrice(String(longPressedProduct.retail_price));
      setEditProdWholesale(String(longPressedProduct.wholesale_price));
    }
  }, [longPressedProduct]);

  const loadCatalogData = () => {
    setCatalogCategories(db.getCatalogCategories().sort((a, b) => a.display_order - b.display_order));
    setProductMappings(db.getProductCategories());
  };

  useEffect(() => {
    if (inputTab === "catalog") {
      loadCatalogData();
    }
  }, [inputTab, products]);

  useEffect(() => {
    db.getBills().then((bills) => {
      const sortedBills = bills
        .filter((b) => b.status !== "Cancelled")
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      const ids: number[] = [];
      const seen = new Set<number>();
      for (const bill of sortedBills) {
        for (const item of bill.items) {
          if (!seen.has(item.product_id)) {
            seen.add(item.product_id);
            ids.push(item.product_id);
            if (ids.length >= 50) break;
          }
        }
        if (ids.length >= 50) break;
      }
      setRecentProductIds(ids);
    });
  }, [products]);

  const startPress = (prod: Product) => {
    isLongPressActive.current = false;
    longPressTimeout.current = setTimeout(() => {
      isLongPressActive.current = true;
      setLongPressedProduct(prod);
      if (navigator.vibrate) navigator.vibrate(50);
    }, 600);
  };

  const handleSaveProductEdit = async () => {
    if (!longPressedProduct) return;
    try {
      const updated = {
        ...longPressedProduct,
        retail_price: parseFloat(editProdPrice) || 0,
        wholesale_price: parseFloat(editProdWholesale) || 0,
      };
      await db.saveProduct(updated);
      alert("Product updated successfully!");
      setLongPressedProduct(null);
      loadCatalogData();
    } catch (e) {
      console.error(e);
      alert("Failed to update product.");
    }
  };



  const endPress = () => {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current);
    }
  };

  const handleProductClick = (prod: Product) => {
    if (isLongPressActive.current) {
      return;
    }
    const units = getProductUnits(prod.id);
    const defaultUnit = units && units.length > 0 ? units[0] : undefined;
    handleAddItem(prod, 1, defaultUnit);
    setRecentlyAdded((prev) => ({
      ...prev,
      [prod.id]: true,
    }));
    setTimeout(
      () =>
        setRecentlyAdded((prev) => ({
          ...prev,
          [prod.id]: false,
        })),
      800,
    );
  };

  // Mobile responsiveness
  const isMobile = useIsMobile();

  const getProductUnits = (productId: number) => {
    if (productId < 0) {
      return ["Piece", "NA", "Pudha", "KG", "Gram", "Litre", "ML"];
    }
    const prod = products.find((p) => p.id === productId);
    if (!prod) return ["Piece"];

    // Weight or volume check
    const cat = prod.category_id
      ? categories.find((c) => c.id === prod.category_id)
      : null;
    const isWeight =
      cat?.measurement_type === "Weight" ||
      cat?.name.toLowerCase() === "weight";
    const isVolume =
      cat?.measurement_type === "Volume" ||
      cat?.name.toLowerCase() === "volume";

    const unitsSet = new Set<string>();

    // 1. Add base units for Weight / Volume
    if (isWeight) {
      unitsSet.add("KG");
      unitsSet.add("Gram");
    } else if (isVolume) {
      unitsSet.add("Litre");
      unitsSet.add("ML");
    } else {
      // For packaged products, ALWAYS put the product's own primary unit FIRST
      // so that catalog/search/scan use the correct unit (Sheet, Bag, Pudha, etc.)
      if (prod.units && prod.units.length > 0 && prod.units[0].unit_name) {
        unitsSet.add(prod.units[0].unit_name);
      } else {
        // Resolve primary unit from display name keywords if no stored units
        const nameLower = prod.display_name.toLowerCase();
        let defaultUnit = "Piece";
        if (nameLower.includes("bag")) defaultUnit = "Bag";
        else if (nameLower.includes("carton") || nameLower.includes("cartoon"))
          defaultUnit = "Carton";
        else if (nameLower.includes("pudha") || nameLower.includes("puda"))
          defaultUnit = "Pudha";
        else if (nameLower.includes("tray")) defaultUnit = "Tray";
        else if (nameLower.includes("sheet")) defaultUnit = "Sheet";
        unitsSet.add(defaultUnit);
      }
    }

    // 2. Add remaining units from the current product's own units list
    if (prod.units && prod.units.length > 0) {
      prod.units.forEach((u) => {
        if (u.unit_name) unitsSet.add(u.unit_name);
      });
    }

    // 3. Find related products with the same base brand name to include their units
    const currentBase = getBaseBrandName(prod.display_name);
    const relatedProducts = products.filter(
      (p) => getBaseBrandName(p.display_name) === currentBase,
    );

    relatedProducts.forEach((p) => {
      p.units?.forEach((u) => {
        if (u.unit_name) unitsSet.add(u.unit_name);
      });
    });

    // 4. Fallbacks if set is empty — use category default_units
    if (unitsSet.size <= 1) {
      // Also allow category defaults as fallbacks even if we only have the primary unit
      if (prod.category_id) {
        const catForFallback = categories.find(
          (c) => c.id === prod.category_id,
        );
        if (catForFallback?.default_units) {
          catForFallback.default_units.forEach((u) => unitsSet.add(u));
        }
      }
    }

    if (unitsSet.size === 0) {
      unitsSet.add("Piece");
    }

    return Array.from(unitsSet);
  };

  // Voice recording states
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [voiceFeedbackSuccess, setVoiceFeedbackSuccess] = useState(false);
  const [aiUsedFlag, setAiUsedFlag] = useState(false);
  const lastVoiceExecutionRef = useRef<{
    timestamp: number;
    rawText: string;
    resolvedProductId: number;
    quantity: number;
    unit: string;
    action: "ADD_ITEM" | "REMOVE_ITEM" | "UPDATE_ITEM";
  } | null>(null);

  const [showVoiceVariantsModal, setShowVoiceVariantsModal] = useState(false);
  const [voiceVariants, setVoiceVariants] = useState<Product[]>([]);
  const [voiceVariantsGroup, setVoiceVariantsGroup] = useState("");
  const [pendingVoiceAction, setPendingVoiceAction] = useState<{
    action: "ADD_ITEM" | "REMOVE_ITEM" | "UPDATE_ITEM";
    quantity: number;
    unit?: string;
  } | null>(null);

  const [showBarcodeMatchesModal, setShowBarcodeMatchesModal] = useState(false);
  const [barcodeMatches, setBarcodeMatches] = useState<Product[]>([]);

  const handleSelectVoiceVariant = (product: Product) => {
    if (pendingVoiceAction) {
      // Use the product's own primary unit (units[0]) to ensure correct unit (Sheet, Bag, Pudha, etc.)
      // scanned_unit may be undefined for products added via search/catalog, so don't rely on it
      const primaryUnit =
        product.units && product.units.length > 0
          ? product.units[0].unit_name
          : pendingVoiceAction.unit || "Piece";
      executeVoiceAction(
        pendingVoiceAction.action,
        product,
        pendingVoiceAction.quantity,
        primaryUnit,
      );
      playSuccessBeep();
    }
    setShowVoiceVariantsModal(false);
    setVoiceVariants([]);
    setVoiceVariantsGroup("");
    setPendingVoiceAction(null);
  };

  const handleSelectBarcodeMatchProduct = (product: Product) => {
    const primaryUnit =
      product.units && product.units.length > 0
        ? product.units[0].unit_name
        : (product as any).scanned_unit || "Piece";
    handleAddItem(product, 1, primaryUnit);
    setShowBarcodeMatchesModal(false);
    setBarcodeMatches([]);
  };

  // Barcode input states
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeError, setBarcodeError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  const autoFlashTimeoutRef = useRef<any>(null);
  const cameraActiveRef = useRef(false);
  const flashOnRef = useRef(false);

  // Mini Form Modal states for unknown barcode
  const [showAddMiniModal, setShowAddMiniModal] = useState(false);
  const [miniBarcode, setMiniBarcode] = useState("");
  const [miniName, setMiniName] = useState("");
  const [miniRetail, setMiniRetail] = useState("");
  const [miniWholesale, setMiniWholesale] = useState("");
  const [miniError, setMiniError] = useState("");

  useEffect(() => {
    return () => {
      stopCameraScanner();
    };
  }, []);

  const handleToggleFlash = async () => {
    const nextState = !flashOn;
    const success = await setTorch(nextState);
    if (success) {
      setFlashOn(nextState);
      flashOnRef.current = nextState;
      if (autoFlashTimeoutRef.current) {
        clearTimeout(autoFlashTimeoutRef.current);
        autoFlashTimeoutRef.current = null;
      }
    } else {
      setBarcodeError("Flash/Torch is not supported on this camera/device.");
    }
  };

  const startCameraScanner = async () => {
    setBarcodeError("");
    setCameraActive(true);
    cameraActiveRef.current = true;
    setFlashOn(false);
    flashOnRef.current = false;

    if (autoFlashTimeoutRef.current) clearTimeout(autoFlashTimeoutRef.current);
    autoFlashTimeoutRef.current = setTimeout(async () => {
      if (cameraActiveRef.current && !flashOnRef.current) {
        const success = await setTorch(true);
        if (success) {
          setFlashOn(true);
          flashOnRef.current = true;
        }
      }
    }, 3500);

    await startBarcodeScanner(
      "barcode-scanner-viewfinder",
      async (decodedText: string) => {
        const matches = await db.findProductsByBarcode(decodedText.trim());
        if (matches && matches.length > 0) {
          if (matches.length > 1) {
            setBarcodeMatches(matches);
            setShowBarcodeMatchesModal(true);
            await stopCameraScanner();
          } else {
            const allFamilyMembers: Product[] = [];
            const seenIds = new Set<number>();
            for (const match of matches) {
              const base = getBaseBrandName(match.display_name);
              const familyMembers = products.filter(
                (p) =>
                  getBaseBrandName(p.display_name) === base &&
                  !(p as any).is_deleted,
              );
              const sorted = [...familyMembers].sort((a, b) => {
                const aIsMain =
                  !/\b(piece|pieces|pc|pcs|bag|bags|carton|cartons|cartoon|cartoons|tray|trays|sheet|sheets|pudha|pudhas|puda|pudas)\b/i.test(
                    a.display_name,
                  );
                const bIsMain =
                  !/\b(piece|pieces|pc|pcs|bag|bags|carton|cartons|cartoon|cartoons|tray|trays|sheet|sheets|pudha|pudhas|puda|pudas)\b/i.test(
                    b.display_name,
                  );
                if (aIsMain && !bIsMain) return -1;
                if (!aIsMain && bIsMain) return 1;
                return (a.retail_price || 0) - (b.retail_price || 0);
              });
              sorted.forEach((fm) => {
                if (!seenIds.has(fm.id)) {
                  seenIds.add(fm.id);
                  allFamilyMembers.push(fm);
                }
              });
            }

            if (allFamilyMembers.length > 1) {
              // Multiple family members — show chooser
              setVoiceVariants(allFamilyMembers);
              setVoiceVariantsGroup("Select Unit");
              setPendingVoiceAction({
                action: "ADD_ITEM",
                quantity: 1,
                unit: allFamilyMembers[0].units?.[0]?.unit_name || "Piece",
              });
              setShowVoiceVariantsModal(true);
              await stopCameraScanner();
            } else {
              // Only 1 family member — add directly
              const prod = allFamilyMembers[0] || matches[0];
              const primaryUnit =
                prod.units && prod.units.length > 0
                  ? prod.units[0].unit_name
                  : (prod as any).scanned_unit || "Piece";
              handleAddItem(prod, 1, primaryUnit);
              await stopCameraScanner();
            }
          }
          try {
            const audioCtx = new (
              window.AudioContext || (window as any).webkitAudioContext
            )();
            const osc = audioCtx.createOscillator();
            osc.frequency.setValueAtTime(1000, audioCtx.currentTime);
            osc.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.12);
          } catch (err) {}
        } else {
          await stopCameraScanner();
          setMiniBarcode(decodedText.trim());
          setMiniName("");
          setMiniRetail("");
          setMiniWholesale("");
          setMiniError("");
          setShowAddMiniModal(true);
        }
      },
      (err: string) => {
        setBarcodeError(err);
        setCameraActive(false);
        cameraActiveRef.current = false;
        if (autoFlashTimeoutRef.current) {
          clearTimeout(autoFlashTimeoutRef.current);
          autoFlashTimeoutRef.current = null;
        }
      },
    );
  };

  const stopCameraScanner = async () => {
    if (autoFlashTimeoutRef.current) {
      clearTimeout(autoFlashTimeoutRef.current);
      autoFlashTimeoutRef.current = null;
    }
    await stopBarcodeScanner();
    setCameraActive(false);
    cameraActiveRef.current = false;
    setFlashOn(false);
    flashOnRef.current = false;
  };

  // Print simulation popup
  const [printedBill, setPrintedBill] = useState<Bill | null>(null);

  // Confetti trigger
  const triggerConfetti = () => {
    confetti({
      particleCount: 80,
      spread: 60,
      origin: { y: 0.8 },
      colors: ["#f59e0b", "#14b8a6", "#ffffff"],
    });
  };

  // Customer modal helpers
  const handleCustomerModalSubmit = () => {
    const name = customerNameInput.trim();
    const phone = customerPhoneInput.trim();

    if (phone) {
      const existing = customers.find((c) => c.phone === phone);
      if (existing) {
        if (name && existing.name.toLowerCase() !== name.toLowerCase()) {
          const confirmSave = window.confirm(
            `A customer named "${existing.name}" is already registered with this phone number. Do you want to continue with the same number?`,
          );
          if (!confirmSave) return; // go back
        }
      }
    }

    if (name || phone) {
      // Check existing customers first
      const found = customers.find(
        (c) =>
          (phone && c.phone === phone) ||
          (name && c.name.toLowerCase() === name.toLowerCase()),
      );
      if (found) {
        onSetCustomer(found.id, found.name, found.phone || "NA");
      } else {
        onSetCustomer(undefined, name || "Customer", phone || "NA");
      }
    } else {
      // Default Guest/Walk-in customer
      onSetCustomer(undefined, "Customer", "NA");
    }
    setShowCustomerModal(false);
  };

  const handleCustomerModalSkip = () => {
    onSetCustomer(undefined, "Customer", "NA");
    setShowCustomerModal(false);
  };

  const handleNameInputChange = (val: string) => {
    setCustomerNameInput(val);
    if (!val.trim()) {
      setCustSuggestions([]);
      return;
    }
    const clean = val.toLowerCase();
    const matches = customers.filter((c) =>
      c.name.toLowerCase().includes(clean),
    );
    setCustSuggestions(matches);
  };

  const handlePhoneInputChange = (val: string) => {
    setCustomerPhoneInput(val);
    if (!val.trim()) {
      setCustSuggestions([]);
      return;
    }
    const clean = val.toLowerCase();
    const matches = customers.filter((c) => c.phone && c.phone.includes(clean));
    setCustSuggestions(matches);
  };

  const handleSelectCustomer = (c: Customer) => {
    onSetCustomer(c.id, c.name, c.phone || "NA");
    setCustomerNameInput(c.name);
    setCustomerPhoneInput(c.phone || "");
    setCustSuggestions([]);
    setShowCustomerModal(false);
  };

  // Product Search logic
  const handleSearchChange = async (val: string) => {
    setSearchQuery(val);
    latestSearchQueryRef.current = val;
    if (!val.trim()) {
      setSearchResults([]);
      return;
    }
    const matches = await db.searchProducts(val);
    if (latestSearchQueryRef.current === val) {
      setSearchResults(matches);
    }
  };

  // Barcode / Name Submission
  const handleBarcodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBarcodeError("");
    const inputVal = barcodeInput.trim();
    if (!inputVal) return;

    const isBarcode =
      /^\d{6,}$/.test(inputVal) || inputVal.toLowerCase().startsWith("sys-");

    if (isBarcode) {
      const barcodeMatches = await db.findProductsByBarcode(inputVal);
      if (barcodeMatches && barcodeMatches.length > 0) {
        if (barcodeMatches.length > 1) {
          setBarcodeMatches(barcodeMatches);
          setShowBarcodeMatchesModal(true);
          setBarcodeInput("");
        } else {
          const allFamilyMembers: Product[] = [];
          const seenIds = new Set<number>();
          for (const match of barcodeMatches) {
            const base = getBaseBrandName(match.display_name);
            const familyMembers = products.filter(
              (p) =>
                getBaseBrandName(p.display_name) === base &&
                !(p as any).is_deleted,
            );
            const sorted = [...familyMembers].sort((a, b) => {
              const aIsMain =
                !/\b(piece|pieces|pc|pcs|bag|bags|carton|cartons|cartoon|cartoons|tray|trays|sheet|sheets|pudha|pudhas|puda|pudas)\b/i.test(
                  a.display_name,
                );
              const bIsMain =
                !/\b(piece|pieces|pc|pcs|bag|bags|carton|cartons|cartoon|cartoons|tray|trays|sheet|sheets|pudha|pudhas|puda|pudas)\b/i.test(
                  b.display_name,
                );
              if (aIsMain && !bIsMain) return -1;
              if (!aIsMain && bIsMain) return 1;
              return (a.retail_price || 0) - (b.retail_price || 0);
            });
            sorted.forEach((fm) => {
              if (!seenIds.has(fm.id)) {
                seenIds.add(fm.id);
                allFamilyMembers.push(fm);
              }
            });
          }

          if (allFamilyMembers.length > 1) {
            setVoiceVariants(allFamilyMembers);
            setVoiceVariantsGroup("Select Unit");
            setPendingVoiceAction({
              action: "ADD_ITEM",
              quantity: 1,
              unit: allFamilyMembers[0].units?.[0]?.unit_name || "Piece",
            });
            setShowVoiceVariantsModal(true);
          } else {
            const prod = allFamilyMembers[0] || barcodeMatches[0];
            const primaryUnit =
              prod.units && prod.units.length > 0
                ? prod.units[0].unit_name
                : (prod as any).scanned_unit || "Piece";
            handleAddItem(prod, 1, primaryUnit);
          }
          setBarcodeInput("");
        }
        try {
          const audioCtx = new (
            window.AudioContext || (window as any).webkitAudioContext
          )();
          const osc = audioCtx.createOscillator();
          osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
          osc.connect(audioCtx.destination);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.1);
        } catch (err) {}
      } else {
        setMiniBarcode(inputVal);
        setMiniName("");
        setMiniRetail("");
        setMiniWholesale("");
        setMiniError("");
        setShowAddMiniModal(true);
        setBarcodeInput("");
      }
    } else {
      // It's a product name. Check if there's an exact product match first
      const matches = await db.searchProducts(inputVal);
      const exactMatch = matches.find(
        (p) => p.display_name.toLowerCase() === inputVal.toLowerCase(),
      );
      if (exactMatch) {
        const units = getProductUnits(exactMatch.id);
        const defaultUnit = units && units.length > 0 ? units[0] : undefined;
        handleAddItem(exactMatch, 1, defaultUnit);
        setBarcodeInput("");
        setSearchQuery("");
        latestSearchQueryRef.current = "";
        setSearchResults([]);
      } else {
        // Product name not found -> Open registration modal
        setMiniBarcode("");
        setMiniName(inputVal);
        setMiniRetail("");
        setMiniWholesale("");
        setMiniError("");
        setShowAddMiniModal(true);
        setBarcodeInput("");
        setSearchQuery("");
        latestSearchQueryRef.current = "";
        setSearchResults([]);
      }
    }
  };

  // Voice Recording refs & helpers
  const recognitionRef = useRef<any>(null);

  const toggleListening = async () => {
    if (isListening) {
      if (Capacitor.isNativePlatform()) {
        try {
          await SpeechPlugin.stopListening();
        } catch (e) {
          console.error("Failed to stop native listening:", e);
        }
      } else if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    setVoiceError("");
    setTranscript("");
    setAiUsedFlag(false);

    if (Capacitor.isNativePlatform()) {
      try {
        const permStatus = await SpeechPlugin.checkPermissions();
        console.log(
          "[Voice V3] Fresh microphone permission status:",
          permStatus,
        );

        if (permStatus.microphone !== "granted") {
          console.log("[Voice V3] Permission not granted, requesting...");
          const reqStatus = await SpeechPlugin.requestPermissions();
          console.log("[Voice V3] Request permission result:", reqStatus);
          if (reqStatus.microphone !== "granted") {
            setVoiceError(
              "Microphone permission denied. Please allow microphone access and try again.",
            );
            return;
          }
        }
      } catch (permErr) {
        console.error(
          "[Voice V3] Failed to check/request permission via Capacitor:",
          permErr,
        );
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          stream.getTracks().forEach((track) => track.stop());
        } catch (mediaErr: any) {
          console.error(
            "[Voice V3] navigator.mediaDevices.getUserMedia failed:",
            mediaErr,
          );
          setVoiceError(
            `Microphone access error: ${mediaErr.message || "Permission denied"}`,
          );
          return;
        }
      }

      setIsListening(true);
      setTranscript("Listening...");

      let partialListener: any = null;
      try {
        partialListener = await (SpeechPlugin as any).addListener(
          "onPartialResult",
          (data: any) => {
            if (data && data.partial) {
              setTranscript(data.partial);
            }
          },
        );

        const result = await SpeechPlugin.startListening();
        const transcriptText = pickBestSpeechTranscript(result);
        if (transcriptText) {
          setTranscript(transcriptText);
          await processSpeechText(transcriptText);
        }
        setIsListening(false);
      } catch (err: any) {
        console.error("Native speech error:", err);
        const errMsg = err.message || "";
        if (
          err.code === "PERMISSION_DENIED" ||
          errMsg.includes("PERMISSION") ||
          errMsg.includes("permission")
        ) {
          setVoiceError(
            "Microphone permission denied. Please allow microphone access and try again.",
          );
        } else if (
          err.code === "ERROR_NO_MATCH" ||
          errMsg.includes("No speech match")
        ) {
          setVoiceError(
            "Couldn't hear you clearly. Please speak closer to the mic.",
          );
        } else if (err.code === "ERROR_NETWORK") {
          setVoiceError("Speech engine needs internet for first-time setup.");
        } else if (err.code === "ERROR_RECOGNIZER_BUSY") {
          setVoiceError("Speech engine is busy. Wait a moment.");
        } else if (err.code === "ENGINE_UNAVAILABLE") {
          setVoiceError(
            "Native speech recognizer is unavailable on this device.",
          );
        } else {
          setVoiceError(
            errMsg || "Native speech recognition engine failed to start.",
          );
        }
        setIsListening(false);
      } finally {
        if (partialListener) {
          partialListener.remove();
        }
      }
      return;
    }

    setVoiceError(
      "Native speech recognition is only available on Android. Please use the Voice Simulator below.",
    );
    setIsListening(false);
    return;
  };

  const executeVoiceAction = (
    action: "ADD_ITEM" | "REMOVE_ITEM" | "UPDATE_ITEM",
    product: Product,
    quantity: number,
    unit: string,
    price?: number,
  ) => {
    if (action === "ADD_ITEM") {
      const pType =
        product.product_type ||
        (product.category_id === 1
          ? "WEIGHT"
          : product.category_id === 2
            ? "VOLUME"
            : "PACKAGED");
      if (pType === "PACKAGED" && unit) {
        const base = getBaseBrandName(product.display_name);
        const allAvailUnits = new Set<string>();
        products
          .filter((p) => getBaseBrandName(p.display_name) === base)
          .forEach((p) =>
            p.units?.forEach((u) => allAvailUnits.add(u.unit_name)),
          );
        const PACK_UNITS = new Set([
          "piece",
          "pieces",
          "bag",
          "bags",
          "carton",
          "cartons",
          "tray",
          "trays",
          "sheet",
          "sheets",
          "pudha",
        ]);
        const isPack = PACK_UNITS.has(unit.toLowerCase());
        const unitOk =
          !isPack ||
          allAvailUnits.size === 0 ||
          Array.from(allAvailUnits).some(
            (u) => u.toLowerCase() === unit.toLowerCase(),
          );
        if (!unitOk) {
          const available = Array.from(allAvailUnits).join(", ");
          setVoiceError(
            `"${unit}" is not available for ${product.display_name}. ` +
              `Available: ${available || "Piece"}. Please try again.`,
          );
          return;
        }
      }
      handleAddItem(product, quantity, unit);
      if (price !== undefined) {
        onEditItem(product.id, quantity, unit || "Piece", price);
      }
    } else if (action === "REMOVE_ITEM") {
      onRemoveItem(product.id);
    } else if (action === "UPDATE_ITEM") {
      const existingCartItem = activeBill.items.find(
        (item: any) => item.product_id === product.id,
      );
      if (existingCartItem) {
        const currentQty = existingCartItem.quantity;
        const currentUnit = existingCartItem.unit;
        const targetQty = quantity !== undefined ? quantity : currentQty;
        const targetUnit = unit || currentUnit;
        onEditItem(product.id, targetQty, targetUnit, price);
      } else {
        handleAddItem(product, quantity, unit);
        if (price !== undefined) {
          onEditItem(product.id, quantity, unit || "Piece", price);
        }
      }
    }
  };

  const processSpeechText = async (textStr: string) => {
    if (!textStr.trim()) return;
    setVoiceError("");
    setAiUsedFlag(false);

    try {
      const parsed = await resolveVoiceCommand(textStr);
      setAiUsedFlag(parsed.aiUsed);

      if (parsed.action === "PRINT_BILL") {
        playSuccessBeep();
        handleCheckoutSubmit();
        return;
      }

      if (
        parsed.variantAction === "SHOW_VARIANTS" &&
        parsed.variants &&
        parsed.variants.length > 0
      ) {
        setVoiceVariants(parsed.variants);
        setVoiceVariantsGroup(parsed.variantGroup || "Variants");
        setPendingVoiceAction({
          action:
            parsed.action === "REMOVE_ITEM" || parsed.action === "UPDATE_ITEM"
              ? parsed.action
              : "ADD_ITEM",
          quantity: parsed.quantity,
          unit: parsed.unit,
        });
        setShowVoiceVariantsModal(true);
        return;
      }

      // Auto-resolve if product found and confidence is high
      if (parsed.resolvedProduct && parsed.confidence >= 80) {
        const actionToExecute =
          parsed.action === "REMOVE_ITEM" || parsed.action === "UPDATE_ITEM"
            ? parsed.action
            : "ADD_ITEM";
        executeVoiceAction(
          actionToExecute,
          parsed.resolvedProduct,
          parsed.quantity,
          parsed.unit,
          parsed.price,
        );
        await recordVoiceSuccess(
          textStr,
          parsed.resolvedProduct.id,
          parsed.quantity,
          parsed.unit,
          parsed.action,
        );

        lastVoiceExecutionRef.current = {
          timestamp: Date.now(),
          rawText: textStr,
          resolvedProductId: parsed.resolvedProduct.id,
          quantity: parsed.quantity,
          unit: parsed.unit,
          action: parsed.action as any,
        };

        setVoiceFeedbackSuccess(true);
        setTimeout(() => setVoiceFeedbackSuccess(false), 1000);
        return;
      }

      // Fallback: search catalog for parsed name or barcode
      const query = (parsed.productName || textStr || "").trim();
      if (query) {
        setBarcodeInput(query);
        await handleSearchChange(query);
        setShowAddMiniModal(false);
        return;
      }

      setVoiceError(
        "Sorry, I couldn't resolve that product. Please try again.",
      );
    } catch (e: any) {
      console.error("Failed to process voice command:", e);
      setVoiceError(e.message || "Error processing speech command.");
    }
  };

  const handleCheckoutSubmit = async () => {
    try {
      setRetryPrintError("");
      const bill = await onCheckout();
      if (bill) {
        setPrintedBill(bill);
        triggerConfetti();
      }
    } catch (e: any) {
      if (e.message === "PRINTER_OFFLINE") {
        const pendingBill = useStore.getState().pendingCheckoutBill;
        setPrintFailedBill(pendingBill);
        setShowPrinterOfflineModal(true);
      } else if (e.message === "NO_PRINTER_CONNECTED") {
        const pendingBill = useStore.getState().pendingCheckoutBill;
        setPrintFailedBill(pendingBill);
        setShowNoPrinterModal(true);
      } else {
        alert(e.message || "Checkout failed.");
      }
    }
  };

  const handleRetryPrint = async () => {
    setRetryPrintLoading(true);
    setRetryPrintError("");
    try {
      const pMac = useStore.getState().printerConfig.printer_mac;
      const pName = useStore.getState().printerConfig.printer_name;
      if (pMac && useStore.getState().printerStatus !== "Connected") {
        await useStore.getState().connectPrinter(pMac, pName);
      }

      // Reprint the saved bill directly
      if (printFailedBill) {
        const { bluetoothPrinter } = await import("./utils/printerService");
        const success = await bluetoothPrinter.printReceipt(
          printFailedBill,
          useStore.getState().printerConfig,
        );
        if (success) {
          useStore.getState().startNewBill(); // Clear cart now that print succeeded
          setShowPrinterOfflineModal(false);
          setShowNoPrinterModal(false);
          setPrintFailedBill(null);
          setPrintedBill(printFailedBill);
          triggerConfetti();
          return;
        }
        throw new Error("Reprint failed. Check printer connection.");
      }
    } catch (e: any) {
      setRetryPrintError(e.message || "Printing failed again.");
    } finally {
      setRetryPrintLoading(false);
    }
  };

  const handleSaveWithoutPrinting = async () => {
    try {
      if (printFailedBill) {
        const updatedBill = {
          ...printFailedBill,
          print_status: "PRINT_SKIPPED" as const,
        };
        await useStore.getState().updateBill(updatedBill);
      }
    } catch (err) {
      console.error("Failed to update print status to SKIPPED:", err);
    }
    useStore.getState().startNewBill(); // Reset the cart
    setShowPrinterOfflineModal(false);
    setShowNoPrinterModal(false);
    setPrintFailedBill(null);
  };

  const handleCancelAndEdit = async () => {
    if (printFailedBill) {
      try {
        await useStore.getState().cancelBill(printFailedBill.id);
        const { db } = await import("./db");
        await db.deleteBillPermanently(printFailedBill.id);
      } catch (err) {
        console.error("Failed to cancel and delete temp bill:", err);
      }
    }
    setShowPrinterOfflineModal(false);
    setShowNoPrinterModal(false);
    setPrintFailedBill(null);
    await useStore.getState().loadStoreData();
    useStore.getState().triggerSync();
  };

  const handleSaveMiniProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setMiniError("");
    if (!miniName.trim() || !miniRetail || !miniWholesale) {
      setMiniError("Please fill out all fields.");
      return;
    }
    const retail = parseFloat(miniRetail);
    const wholesale = parseFloat(miniWholesale);
    if (isNaN(retail) || isNaN(wholesale)) {
      setMiniError("Prices must be valid numbers.");
      return;
    }

    try {
      // Background AI Alias Generation if API key is set
      let miniAliases: string[] = [];
      const geminiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || "";
      const groqKey = (import.meta as any).env?.VITE_GROQ_API_KEY || "";
      if (geminiKey || groqKey) {
        try {
          miniAliases = await generateProductAliases(miniName.trim());
        } catch (e) {
          console.error("Background alias generation failed:", e);
          miniAliases = [miniName.trim()];
        }
      } else {
        miniAliases = [miniName.trim()];
      }

      // Save product locally (which registers product and link barcode)
      const savedProd = await db.saveProduct({
        display_name: miniName.trim(),
        retail_price: retail,
        wholesale_price: wholesale,
        barcode: miniBarcode,
        aliases: miniAliases,
      });

      // Add to bill
      handleAddItem(savedProd, 1);

      // Reset & Close
      setShowAddMiniModal(false);
      setMiniBarcode("");
      setMiniName("");
      setMiniRetail("");
      setMiniWholesale("");

      // Reload store products so we search successfully
      useStore.getState().loadStoreData();
      useStore.getState().triggerSync();
    } catch (err: any) {
      setMiniError(err.message || "Error saving product.");
    }
  };

  // Catalog loose items grid list dynamically updated by useEffect

  const renderCartColumn = () => (
    <div className="pos-card animate-fade-in" style={{ padding: 24 }}>
      <div
        className="flex-between"
        style={{
          borderBottom: "1px solid #2b253b",
          paddingBottom: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Active Bill Summary</h2>
          {/* Inline price mode indicator in cart header */}
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 10px",
              borderRadius: 12,
              background: isWholesale
                ? "rgba(20,184,166,0.15)"
                : "rgba(245,158,11,0.15)",
              color: isWholesale ? "#14b8a6" : "#f59e0b",
              border: `1px solid ${isWholesale ? "rgba(20,184,166,0.3)" : "rgba(245,158,11,0.3)"}`,
            }}
          >
            {isWholesale ? "📦 Wholesale" : "🏷️ MRP"}
          </span>
        </div>
        <button
          onClick={onDiscardDraft}
          style={{
            fontSize: 12,
            color: "#ef4444",
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "transparent",
          }}
        >
          <Trash2 size={13} /> Reset Bill
        </button>
      </div>

      {activeBill.items.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "64px 0",
            color: "#9c97aa",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <ShoppingCart size={40} style={{ opacity: 0.3 }} />
          <span style={{ fontSize: 14 }}>
            Your billing cart is empty. Add items using the panels on the right.
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Table header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              fontWeight: 700,
              color: "#9c97aa",
              textTransform: "uppercase",
              borderBottom: "1px solid #2b253b",
              paddingBottom: 6,
            }}
          >
            <span>Item Details</span>
            <span>Total</span>
          </div>

          {/* Items List */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activeBill.items.map((item: BillItem) => (
              <DesktopCartItemRow
                key={`${item.product_id}-${item.unit}`}
                item={item}
                onEditItem={handleEditItem}
                onRemoveItem={onRemoveItem}
                getProductUnits={getProductUnits}
              />
            ))}
          </div>

          {/* Plus Button to add custom item */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: 4,
            }}
          >
            <button
              onClick={handleAddCustomItem}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                background: "rgba(245,158,11,0.08)",
                border: "1px solid rgba(245,158,11,0.2)",
                borderRadius: 6,
                color: "#f59e0b",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              <Plus size={13} /> Add Custom Item
            </button>
          </div>

          {/* Running Totals section */}
          <div
            style={{
              borderTop: "2px solid #2b253b",
              paddingTop: 16,
              marginTop: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div className="flex-between" style={{ fontSize: 14 }}>
              <span style={{ color: "#9c97aa" }}>Subtotal:</span>
              <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                ₹{activeBill.subtotal.toFixed(2)}
              </span>
            </div>
            <div className="flex-between" style={{ fontSize: 14 }}>
              <span style={{ color: "#9c97aa" }}>Discount (₹):</span>
              <input
                type="number"
                value={activeBill.discount || ""}
                onChange={(e) => onSetDiscount(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                style={{
                  width: 80,
                  padding: "4px 8px",
                  textAlign: "right",
                  background: "#0b0a0f",
                }}
              />
            </div>
            <div
              className="flex-between"
              style={{
                fontSize: 18,
                fontWeight: 800,
                borderTop: "1px solid #2b253b",
                paddingTop: 12,
                marginTop: 4,
              }}
            >
              <span>Grand Total:</span>
              <span style={{ color: "#f59e0b", fontFamily: "monospace" }}>
                ₹{activeBill.grand_total.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Payment Mode Selector */}
          <div style={{ marginTop: 16 }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#9c97aa",
                textTransform: "uppercase",
                display: "block",
                marginBottom: 8,
              }}
            >
              Payment Mode
            </span>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 12,
              }}
            >
              {["Cash", "UPI", "Credit"].map((mode) => (
                <button
                  key={mode}
                  onClick={() => onSetPaymentMode(mode as any)}
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    background:
                      activeBill.payment_mode === mode
                        ? "rgba(245,158,11,0.1)"
                        : "#121017",
                    border:
                      activeBill.payment_mode === mode
                        ? "1px solid #f59e0b"
                        : "1px solid #2b253b",
                    color:
                      activeBill.payment_mode === mode ? "#f59e0b" : "#fff",
                  }}
                >
                  {mode === "Credit" ? "Credit (Khata)" : mode}
                </button>
              ))}
            </div>
          </div>

          {/* Checkout Button */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginTop: 16,
            }}
          >
            <button
              onClick={handleCheckoutSubmit}
              style={{
                width: "100%",
                padding: 16,
                borderRadius: 8,
                background: "#f59e0b",
                color: "#0b0a0f",
                fontSize: 16,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <Printer size={18} /> Complete Bill & Print
            </button>
            <button
              onClick={async () => {
                try {
                  const bill = await useStore.getState().saveAndSkipPrint();
                  if (bill) {
                    setPrintedBill(bill);
                    triggerConfetti();
                  }
                } catch (e: any) {
                  alert(e.message || "Failed to save bill.");
                }
              }}
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 8,
                background: "rgba(20,184,166,0.08)",
                border: "1px solid rgba(20,184,166,0.25)",
                color: "#14b8a6",
                fontSize: 13,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              💾 Save Without Printing
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderInputColumn = () => (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 20 }}
      className="animate-fade-in"
    >
      {/* 2-Tab Billing Methods */}
      <div className="pos-card" style={{ padding: inputTab === "catalog" ? "8px 4px" : 20, flex: 1 }}>
        {/* Tab Switcher — 2 tabs only */}
        <div
          style={{
            display: "flex",
            background: "#0e0b12",
            borderRadius: 10,
            padding: 4,
            marginBottom: 20,
            gap: 4,
            border: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          {(["scan", "catalog"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setInputTab(tab)}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                background:
                  inputTab === tab
                    ? "linear-gradient(135deg, #f59e0b, #d97706)"
                    : "transparent",
                color: inputTab === tab ? "#0b0a0f" : "#9c97aa",
                border: "none",
                cursor: "pointer",
                transition: "all 0.2s",
                boxShadow:
                  inputTab === tab
                    ? "0 4px 12px rgba(245,158,11,0.25)"
                    : "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {tab === "scan" ? (
                <>
                  <Barcode size={14} /> Scan / Search
                </>
              ) : (
                <>
                  <ShoppingBag size={14} /> Catalog
                </>
              )}
            </button>
          ))}
        </div>

        {/* ── TAB 1: UNIFIED SCAN + VOICE + MANUAL SEARCH ── */}
        {inputTab === "scan" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Active Camera Viewfinder: stretches 100% full-width and has wide rectangular ratio */}
            {cameraActive && (
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "16/9",
                  maxHeight: 240,
                  borderRadius: 10,
                  overflow: "hidden",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                }}
              >
                <div
                  id="barcode-scanner-viewfinder"
                  style={{
                    width: "100%",
                    height: "100%",
                    background: "#000",
                    border: "1px solid rgba(245,158,11,0.3)",
                  }}
                ></div>
              </div>
            )}

            {/* Row 1: Scan Camera + Voice Mic Controls */}
            <div style={{ display: "flex", gap: 10 }}>
              {cameraActive ? (
                <div style={{ display: "flex", gap: 10, flex: 1 }}>
                  <button
                    type="button"
                    onClick={stopCameraScanner}
                    style={{
                      flex: 1,
                      padding: "14px 12px",
                      background: "rgba(239,68,68,0.15)",
                      border: "1px solid #ef4444",
                      color: "#ef4444",
                      borderRadius: 12,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    Stop Camera
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleFlash}
                    style={{
                      padding: "14px 16px",
                      background: flashOn
                        ? "rgba(245, 158, 11, 0.2)"
                        : "rgba(255, 255, 255, 0.05)",
                      border: flashOn
                        ? "1px solid #f59e0b"
                        : "1px solid rgba(255, 255, 255, 0.1)",
                      color: flashOn ? "#f59e0b" : "#94a3b8",
                      borderRadius: 12,
                      fontSize: 13,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    <Zap size={18} fill={flashOn ? "#f59e0b" : "none"} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startCameraScanner}
                  style={{
                    flex: 1,
                    padding: "18px 12px",
                    background: "rgba(245,158,11,0.06)",
                    border: "1px solid rgba(245,158,11,0.25)",
                    color: "#f59e0b",
                    borderRadius: 12,
                    fontSize: 13,
                    fontWeight: 700,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(245,158,11,0.12)";
                    e.currentTarget.style.borderColor = "rgba(245,158,11,0.5)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(245,158,11,0.06)";
                    e.currentTarget.style.borderColor = "rgba(245,158,11,0.25)";
                  }}
                >
                  <Barcode size={22} />
                  <span style={{ fontSize: 11, opacity: 0.8 }}>
                    Scan Camera
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={toggleListening}
                style={{
                  flex: 1,
                  padding: "18px 12px",
                  background: isListening ? "#ef4444" : "rgba(168,85,247,0.06)",
                  border: isListening
                    ? "1px solid #ef4444"
                    : "1px solid rgba(168,85,247,0.25)",
                  color: isListening ? "#fff" : "#a855f7",
                  borderRadius: 12,
                  fontSize: 13,
                  fontWeight: 700,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  if (!isListening) {
                    e.currentTarget.style.background = "rgba(168,85,247,0.12)";
                    e.currentTarget.style.borderColor = "rgba(168,85,247,0.5)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isListening) {
                    e.currentTarget.style.background = "rgba(168,85,247,0.06)";
                    e.currentTarget.style.borderColor = "rgba(168,85,247,0.25)";
                  }
                }}
              >
                {isListening ? <MicOff size={22} /> : <Mic size={22} />}
                <span style={{ fontSize: 11, opacity: 0.8 }}>
                  {isListening ? "Stop Mic" : "Voice Mic"}
                </span>
              </button>
            </div>

            {/* Voice Command Simulator for Testing & Desktop */}
            {!Capacitor.isNativePlatform() && (
              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  gap: 8,
                  background: "rgba(168,85,247,0.04)",
                  border: "1px solid rgba(168,85,247,0.15)",
                  padding: 10,
                  borderRadius: 10,
                }}
              >
                <input
                  type="text"
                  value={simulatedVoiceText}
                  onChange={(e) => setSimulatedVoiceText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (simulatedVoiceText.trim()) {
                        setTranscript(simulatedVoiceText);
                        processSpeechText(simulatedVoiceText);
                        setSimulatedVoiceText("");
                      }
                    }
                  }}
                  placeholder="Simulate voice billing, e.g. 50g chakra..."
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    fontSize: 12,
                    background: "#0b0a0f",
                    border: "1px solid #2b253b",
                    borderRadius: 6,
                    color: "#fff",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (simulatedVoiceText.trim()) {
                      setTranscript(simulatedVoiceText);
                      processSpeechText(simulatedVoiceText);
                      setSimulatedVoiceText("");
                    }
                  }}
                  style={{
                    padding: "6px 10px",
                    background: "#a855f7",
                    color: "#fff",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Run
                </button>
              </div>
            )}

            {/* V4 Voice AI Status and Feedback Panel */}
            {(transcript || voiceError || voiceFeedbackSuccess) && (
              <div
                style={{
                  background: "#121017",
                  border: "1px solid #2b253b",
                  padding: "12px 14px",
                  borderRadius: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#9c97aa",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    🎙️ Voice Engine V4
                  </span>
                  <div
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    {aiUsedFlag && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          background:
                            "linear-gradient(135deg, #a855f7 0%, #d946ef 100%)",
                          color: "#fff",
                          padding: "2px 6px",
                          borderRadius: 4,
                          textTransform: "uppercase",
                          boxShadow: "0 0 8px rgba(168, 85, 247, 0.4)",
                        }}
                      >
                        AI Mode
                      </span>
                    )}
                    {voiceFeedbackSuccess && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#10b981",
                          display: "flex",
                          alignItems: "center",
                          gap: 2,
                        }}
                      >
                        <CheckCircle size={12} /> Success
                      </span>
                    )}
                  </div>
                </div>

                {transcript && (
                  <div
                    style={{
                      fontSize: 13,
                      fontFamily: "monospace",
                      color: "#f59e0b",
                      background: "rgba(245, 158, 11, 0.05)",
                      padding: "8px 10px",
                      borderRadius: 6,
                      borderLeft: "3px solid #f59e0b",
                      wordBreak: "break-all",
                    }}
                  >
                    "{transcript}"
                  </div>
                )}

                {voiceError && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#ef4444",
                      background: "rgba(239, 68, 68, 0.05)",
                      padding: "8px 10px",
                      borderRadius: 6,
                      borderLeft: "3px solid #ef4444",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <AlertTriangle size={14} />
                    <span>{voiceError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Row 2: Unified Smart Search Bar */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#9c97aa",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 8,
                }}
              >
                🔍 Search by Name or Scan Barcode
              </label>
              <form
                onSubmit={handleBarcodeSubmit}
                style={{ display: "flex", gap: 8 }}
              >
                <div style={{ position: "relative", flex: 1 }}>
                  <Search
                    size={15}
                    style={{
                      position: "absolute",
                      left: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "#6b6880",
                      pointerEvents: "none",
                    }}
                  />
                  <input
                    type="text"
                    value={searchQuery || barcodeInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      // If it looks like a barcode (all digits, long) or a system barcode, route to barcode input
                      if (
                        /^\d{6,}$/.test(val) ||
                        val.toLowerCase().startsWith("sys-")
                      ) {
                        setBarcodeInput(val);
                        setSearchQuery("");
                      } else {
                        setSearchQuery(val);
                        setBarcodeInput(val); // keep in sync for form submit
                        handleSearchChange(val);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (barcodeInput.trim()) handleBarcodeSubmit(e as any);
                      }
                    }}
                    placeholder="Type product name or scan / enter barcode…"
                    autoComplete="off"
                    style={{
                      width: "100%",
                      padding: "12px 38px 12px 38px",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.09)",
                      borderRadius: 10,
                      color: "#fff",
                      fontSize: 14,
                      outline: "none",
                      boxSizing: "border-box",
                      transition: "all 0.2s",
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = "rgba(245,158,11,0.5)";
                      e.target.style.boxShadow =
                        "0 0 0 3px rgba(245,158,11,0.08)";
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = "rgba(255,255,255,0.09)";
                      e.target.style.boxShadow = "none";
                    }}
                  />
                  {(searchQuery || barcodeInput) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery("");
                        setBarcodeInput("");
                        latestSearchQueryRef.current = "";
                        setSearchResults([]);
                      }}
                      style={{
                        position: "absolute",
                        right: 10,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "transparent",
                        border: "none",
                        color: "#9c97aa",
                        cursor: "pointer",
                        display: "flex",
                        padding: 4,
                      }}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  style={{
                    padding: "12px 18px",
                    background: "linear-gradient(135deg, #f59e0b, #d97706)",
                    color: "#0b0a0f",
                    borderRadius: 10,
                    fontWeight: 800,
                    fontSize: 13,
                    border: "none",
                    cursor: "pointer",
                    flexShrink: 0,
                    boxShadow: "0 4px 12px rgba(245,158,11,0.25)",
                  }}
                >
                  Add
                </button>
              </form>
              {barcodeError && (
                <span
                  style={{
                    color: "#ef4444",
                    fontSize: 11,
                    display: "block",
                    marginTop: 6,
                  }}
                >
                  {barcodeError}
                </span>
              )}
            </div>

            {/* Search Results from name search */}
            {searchResults.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {searchResults.map((prod) => (
                  <div
                    key={prod.id}
                    className="flex-between"
                    style={{
                      padding: "10px 14px",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      borderRadius: 10,
                      fontSize: 13,
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 700, color: "#fff" }}>
                        {prod.display_name}
                      </span>
                      <span
                        style={{
                          color: "#f59e0b",
                          marginLeft: 8,
                          fontSize: 11,
                        }}
                      >
                        ₹
                        {isWholesale ? prod.wholesale_price : prod.retail_price}
                      </span>
                    </div>
                    <button
                      onClick={async () => {
                        // Check for family variants sharing the same base brand name
                        const base = getBaseBrandName(prod.display_name);
                        const familyVariants = products.filter(
                          (p) =>
                            getBaseBrandName(p.display_name) === base &&
                            p.id !== prod.id &&
                            p.category_id !== undefined &&
                            [3, 4, 5, 6, 7].includes(p.category_id),
                        );
                        if (familyVariants.length > 0) {
                          // Show variant chooser so user picks the right unit (Sheet vs Piece, etc.)
                          const allVariants = [prod, ...familyVariants];
                          setVoiceVariants(allVariants);
                          setVoiceVariantsGroup("Select Variant");
                          setPendingVoiceAction({
                            action: "ADD_ITEM",
                            quantity: 1,
                            unit: prod.units?.[0]?.unit_name || "Piece",
                          });
                          setShowVoiceVariantsModal(true);
                          setSearchQuery("");
                          setBarcodeInput("");
                          latestSearchQueryRef.current = "";
                          setSearchResults([]);
                        } else {
                          const units = getProductUnits(prod.id);
                          const defaultUnit =
                            units && units.length > 0 ? units[0] : undefined;
                          handleAddItem(prod, 1, defaultUnit);

                          // Voice learning integration
                          if (
                            transcript &&
                            transcript !== "Listening..." &&
                            transcript !== "Processing..."
                          ) {
                            await recordVoiceSuccess(
                              transcript,
                              prod.id,
                              1,
                              defaultUnit || "Piece",
                              "ADD_ITEM",
                            );
                          }

                          setSearchQuery("");
                          setBarcodeInput("");
                          latestSearchQueryRef.current = "";
                          setSearchResults([]);
                        }
                      }}
                      style={{
                        padding: "6px 14px",
                        background: "linear-gradient(135deg, #f59e0b, #d97706)",
                        color: "#0b0a0f",
                        borderRadius: 8,
                        fontWeight: 800,
                        fontSize: 12,
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      + Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {inputTab === "catalog" && (
          <div style={{ display: "flex", gap: 4, minHeight: "60vh" }}>
            {/* Sidebar (Left) */}
            <div
              style={{
                width: "26%",
                borderRight: "1px solid var(--border-color)",
                paddingRight: 4,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              {/* Category List */}
              <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: "550px", overflowY: "auto", paddingRight: 1 }}>
                {[
                  { id: "all", name: "All Items", icon: "📦", imageUrl: undefined as string | undefined, count: catalogProducts.length },
                  { id: "recent", name: "Recent", icon: "🕒", imageUrl: undefined as string | undefined, count: products.filter(p => recentProductIds.includes(p.id) && !p.is_deleted).length },
                  { id: "fast", name: "Fast Selling", icon: "🔥", imageUrl: undefined as string | undefined, count: catalogProducts.length },
                  ...catalogCategories.map(cat => ({
                    id: cat.id,
                    name: cat.name,
                    icon: undefined,
                    imageUrl: cat.image_url,
                    count: productMappings.filter(m => m.category_id === cat.id && !m.is_deleted).length
                  })),
                  { id: "uncategorized", name: "Uncategorized", icon: "📁", imageUrl: undefined as string | undefined, count: catalogProducts.filter(p => !new Set(productMappings.map(m => m.product_id)).has(p.id)).length }
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedCatId(item.id);
                      setCatalogPage(1);
                    }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      width: "100%",
                      padding: "8px 6px",
                      borderRadius: "6px",
                      border: selectedCatId === item.id ? "1.5px solid var(--accent-gold)" : "1px solid var(--border-color)",
                      cursor: "pointer",
                      textAlign: "center",
                      background: selectedCatId === item.id ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.02)",
                      color: selectedCatId === item.id ? "var(--accent-gold)" : "var(--text-primary)",
                      fontWeight: "700",
                      fontSize: "12px",
                      transition: "all 0.15s",
                      gap: "6px",
                      outline: "none",
                      boxSizing: "border-box"
                    }}
                  >
                    {/* Category Image/Thumbnail or Icon Placeholder */}
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} style={{ width: "100%", height: "45px", borderRadius: 4, objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: "100%", height: "45px", borderRadius: 4, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                        {item.icon || "📁"}
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "center", width: "100%" }}>
                      <span style={{ display: "block", fontSize: "10px", fontWeight: "800", wordBreak: "break-word", lineHeight: "12px", textAlign: "center" }}>
                        {item.name}
                      </span>
                      <span style={{ display: "block", fontSize: "8px", color: "var(--text-secondary)", fontWeight: "500", textAlign: "center" }}>
                        {item.count} items
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Sidebar bottom actions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16, borderTop: "1px solid var(--border-color)", paddingTop: 12 }}>
                <button
                  onClick={() => setShowQuickCategoryModal(true)}
                  style={{
                    background: "rgba(20,184,166,0.08)",
                    border: "1px solid rgba(20,184,166,0.15)",
                    borderRadius: 8,
                    color: "var(--accent-teal)",
                    padding: "10px",
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <Plus size={14} /> New Category
                </button>
                <button
                  onClick={() => useStore.getState().setScreen("categories")}
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--border-color)",
                    borderRadius: 8,
                    color: "#fff",
                    padding: "10px",
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <Settings size={14} /> Settings
                </button>
              </div>
            </div>

            {/* Grid & Search (Right) */}
            <div style={{ width: "74%", display: "flex", flexDirection: "column" }}>
              {/* Search Bar */}
              <div style={{ position: "relative", marginBottom: 14 }}>
                <Search
                  size={15}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#6b6880",
                    pointerEvents: "none",
                  }}
                />
                <input
                  type="text"
                  value={catalogSearchQuery}
                  onChange={(e) => setCatalogSearchQuery(e.target.value)}
                  placeholder={selectedCatId === "all" ? "Search catalog items..." : `Search in category or globally...`}
                  style={{
                    width: "100%",
                    padding: "11px 36px",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.09)",
                    borderRadius: 10,
                    color: "#fff",
                    fontSize: 14,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                {catalogSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setCatalogSearchQuery("")}
                    style={{
                      position: "absolute",
                      right: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      color: "#9c97aa",
                      cursor: "pointer",
                      display: "flex",
                    }}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>

              {/* Grid of Products (3 columns - zero wastage) */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 6,
                }}
              >
                {(() => {
                  const currentGridProducts = (() => {
                    if (selectedCatId === "all") return catalogProducts;
                    if (selectedCatId === "recent") return products.filter(p => recentProductIds.includes(p.id) && !p.is_deleted);
                    if (selectedCatId === "fast") return catalogProducts;
                    if (selectedCatId === "uncategorized") {
                      const assignedIds = new Set(productMappings.map(m => m.product_id));
                      return catalogProducts.filter(p => !assignedIds.has(p.id));
                    }
                    const catProdIds = new Set(productMappings.filter(m => m.category_id === selectedCatId).map(m => m.product_id));
                    return products.filter(p => catProdIds.has(p.id) && !p.is_deleted);
                  })();

                  const q = catalogSearchQuery.trim().toLowerCase();
                  const filtered = q
                    ? products.filter(
                        p => !p.is_deleted &&
                        (p.display_name.toLowerCase().includes(q) ||
                         p.aliases?.some(a => a.toLowerCase().includes(q)))
                      )
                    : currentGridProducts;

                  if (filtered.length === 0) {
                    return (
                      <div
                        style={{
                          gridColumn: "span 3",
                          textAlign: "center",
                          padding: "32px 8px",
                          color: "#6b6880",
                          fontSize: 13,
                        }}
                      >
                        {catalogSearchQuery
                          ? `No items matching "${catalogSearchQuery}"`
                          : "No products found in this category"}
                      </div>
                    );
                  }

                  const ITEMS_PER_PAGE = 40;
                  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
                  const startIdx = (catalogPage - 1) * ITEMS_PER_PAGE;
                  const paginated = filtered.slice(startIdx, startIdx + ITEMS_PER_PAGE);

                  return (
                    <>
                      {paginated.map((prod) => {
                        const isAdded = !!recentlyAdded[prod.id];
                        const price = isWholesale ? prod.wholesale_price : prod.retail_price;
                        return (
                          <div
                            key={prod.id}
                            onClick={() => handleProductClick(prod)}
                            onMouseDown={() => startPress(prod)}
                            onMouseUp={endPress}
                            onMouseLeave={endPress}
                            onTouchStart={() => startPress(prod)}
                            onTouchEnd={endPress}
                            style={{
                              background: isAdded ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.03)",
                              border: `1px solid ${isAdded ? "#10b981" : "var(--border-color)"}`,
                              borderRadius: "6px",
                              padding: "6px",
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "stretch",
                              cursor: "pointer",
                              position: "relative",
                              overflow: "hidden",
                              textAlign: "center",
                              minHeight: "135px",
                              transition: "all 0.15s",
                              boxSizing: "border-box"
                            }}
                          >
                            {/* Corner Active Price Badge */}
                            <div
                              style={{
                                position: "absolute",
                                top: "4px",
                                right: "4px",
                                background: isAdded ? "rgba(16,185,129,0.9)" : "rgba(245,158,11,0.9)",
                                color: "#0b0a0f",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                fontSize: "9px",
                                fontWeight: "900",
                                zIndex: 5,
                                pointerEvents: "none"
                              }}
                            >
                              {isWholesale ? "W " : "R "}₹{price}
                            </div>

                            {/* Image with graceful fallback */}
                            {prod.image_url ? (
                              <img
                                src={prod.image_url}
                                alt={prod.display_name}
                                style={{ width: "100%", height: "80px", objectFit: "cover", borderRadius: "4px", marginBottom: "6px" }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: "100%",
                                  height: "80px",
                                  borderRadius: "4px",
                                  background: getProductColor(prod.display_name),
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontWeight: "bold",
                                  fontSize: "24px",
                                  color: "#fff",
                                  marginBottom: "6px",
                                }}
                              >
                                {prod.display_name.charAt(0).toUpperCase()}
                              </div>
                            )}

                            <span
                              style={{
                                fontSize: "11px",
                                fontWeight: "700",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                height: "30px",
                                lineHeight: "15px",
                                color: isAdded ? "#10b981" : "var(--text-primary)",
                                marginBottom: "4px"
                              }}
                            >
                              {prod.display_name}
                            </span>
                          </div>
                        );
                      })}

                      {/* Pagination Controls */}
                      {totalPages > 1 && (
                        <div
                          style={{
                            gridColumn: "span 3",
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            gap: 12,
                            marginTop: 10,
                            padding: "8px 0",
                          }}
                        >
                          <button
                            onClick={() => setCatalogPage((prev) => Math.max(prev - 1, 1))}
                            disabled={catalogPage === 1}
                            style={{
                              padding: "6px 12px",
                              borderRadius: 6,
                              background: catalogPage === 1 ? "transparent" : "rgba(245,158,11,0.15)",
                              border: "1px solid #2b253b",
                              color: catalogPage === 1 ? "#4b4855" : "#f59e0b",
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: catalogPage === 1 ? "not-allowed" : "pointer",
                            }}
                          >
                            Prev
                          </button>
                          <span style={{ fontSize: 13, color: "#9c97aa", fontWeight: 600 }}>
                            {catalogPage} / {totalPages}
                          </span>
                          <button
                            onClick={() => setCatalogPage((prev) => Math.min(prev + 1, totalPages))}
                            disabled={catalogPage === totalPages}
                            style={{
                              padding: "6px 12px",
                              borderRadius: 6,
                              background: catalogPage === totalPages ? "transparent" : "rgba(245,158,11,0.15)",
                              border: "1px solid #2b253b",
                              color: catalogPage === totalPages ? "#4b4855" : "#f59e0b",
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: catalogPage === totalPages ? "not-allowed" : "pointer",
                            }}
                          >
                            Next
                          </button>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

            {/* QUICK NEW CATEGORY MODAL */}
            {showQuickCategoryModal && (
              <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120 }}>
                <div style={{ background: "#181520", padding: 24, borderRadius: 12, width: "100%", maxWidth: 360, border: "1px solid var(--border-color)", margin: "auto" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 800 }}>Quick New Category</h3>
                    <button onClick={() => setShowQuickCategoryModal(false)} className="pos-btn" style={{ background: "transparent", border: "none", color: "var(--text-secondary)" }}>
                      <X size={18} />
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6, fontWeight: 700 }}>CATEGORY NAME</label>
                      <input type="text" value={quickCatName} onChange={e => setQuickCatName(e.target.value)} className="pos-input" style={{ width: "100%" }} placeholder="e.g. Chocolates 🍫" />
                    </div>
                    <button
                      onClick={async () => {
                        if (!quickCatName.trim()) return;
                        await db.saveCatalogCategory({
                          name: quickCatName.trim(),
                          display_order: catalogCategories.length,
                          is_system: false
                        });
                        setQuickCatName("");
                        setShowQuickCategoryModal(false);
                        loadCatalogData();
                      }}
                      className="pos-btn"
                      style={{ background: "var(--accent-teal)", color: "#fff", width: "100%", padding: 10, fontWeight: 700 }}
                    >
                      Create
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* LONG PRESS PRODUCT DETAIL / EDIT MODAL */}
            {longPressedProduct && (
              <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120 }}>
                <div style={{ background: "#181520", padding: 24, borderRadius: 12, width: "100%", maxWidth: 400, border: "1px solid var(--border-color)", margin: "auto" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ fontSize: 18, fontWeight: 800 }}>Product Catalog Options</h3>
                    <button onClick={() => setLongPressedProduct(null)} className="pos-btn" style={{ background: "transparent", border: "none", color: "var(--text-secondary)" }}>
                      <X size={20} />
                    </button>
                  </div>
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {/* Product preview */}
                    <div style={{ display: "flex", gap: 12, alignItems: "center", background: "#120f1a", padding: 12, borderRadius: 8 }}>
                      {longPressedProduct.image_url ? (
                        <img src={longPressedProduct.image_url} alt="Product" style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: 64, height: 64, borderRadius: 8, background: getProductColor(longPressedProduct.display_name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: "bold", color: "#fff" }}>
                          {longPressedProduct.display_name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <h4 style={{ fontWeight: 700, fontSize: 15 }}>{longPressedProduct.display_name}</h4>
                        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Barcode: {longPressedProduct.barcode || "Loose Item"}</span>
                      </div>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6, fontWeight: 700 }}>RETAIL PRICE (₹)</label>
                      <input type="number" value={editProdPrice} onChange={e => setEditProdPrice(e.target.value)} className="pos-input" style={{ width: "100%" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6, fontWeight: 700 }}>WHOLESALE PRICE (₹)</label>
                      <input type="number" value={editProdWholesale} onChange={e => setEditProdWholesale(e.target.value)} className="pos-input" style={{ width: "100%" }} />
                    </div>


                    <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                      <button onClick={() => setLongPressedProduct(null)} className="pos-btn" style={{ flex: 1, background: "#2b253b", color: "#fff" }}>
                        Cancel
                      </button>
                      <button onClick={handleSaveProductEdit} className="pos-btn" style={{ flex: 1, background: "var(--accent-gold)", color: "#0b0a0f", fontWeight: 700 }}>
                        Save Changes
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      style={{ maxWidth: 1200, margin: "0 auto" }}
      className="animate-slide-up"
    >
      {/* ── CUSTOMER DETAILS MODAL ───────────────────────── */}
      {showCustomerModal &&
        createPortal(
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(5, 4, 8, 0.85)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              padding: 24,
              backdropFilter: "blur(8px)",
            }}
          >
            <div
              className="pos-card animate-slide-up"
              style={{
                width: "100%",
                maxWidth: isMobile ? "100%" : 620,
                padding: isMobile ? "28px 20px" : "40px 48px",
                background: "#1c1926",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 16,
                boxShadow: "0 24px 48px -12px rgba(0, 0, 0, 0.8)",
                position: "relative",
              }}
            >
              {/* Close Button on Top Right */}
              <button
                onClick={handleCustomerModalSkip}
                style={{
                  position: "absolute",
                  top: 18,
                  right: 18,
                  background: "transparent",
                  border: "none",
                  color: "#9c97aa",
                  cursor: "pointer",
                  padding: 4,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#9c97aa")}
                title="Close & Skip"
              >
                <X size={20} />
              </button>

              {/* Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  marginBottom: 32,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    flexShrink: 0,
                    background:
                      "linear-gradient(135deg, rgba(245,158,11,0.18), rgba(217,119,6,0.06))",
                    border: "1px solid rgba(245,158,11,0.28)",
                    color: "#f59e0b",
                    boxShadow: "0 0 20px rgba(245,158,11,0.12)",
                  }}
                >
                  <User size={26} />
                </div>
                <div>
                  <h2
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      color: "#fff",
                      margin: 0,
                    }}
                  >
                    Customer Details
                  </h2>
                  <p
                    style={{
                      fontSize: 13,
                      color: "#6b6880",
                      marginTop: 4,
                      marginBottom: 0,
                    }}
                  >
                    Optional — skip for a walk-in sale
                  </p>
                </div>
              </div>

              {/* Two-column input layout on desktop */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                  gap: isMobile ? 16 : 20,
                  marginBottom: 28,
                  position: "relative",
                }}
              >
                {/* Customer Name */}
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#9c97aa",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 8,
                    }}
                  >
                    Customer Name
                  </label>
                  <div
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        left: 14,
                        color: "#6b6880",
                        display: "flex",
                        alignItems: "center",
                        pointerEvents: "none",
                      }}
                    >
                      <User size={15} />
                    </span>
                    <input
                      type="text"
                      value={customerNameInput}
                      onChange={(e) => handleNameInputChange(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleCustomerModalSubmit()
                      }
                      placeholder="e.g. Ramesh Kumar"
                      autoComplete="off"
                      style={{
                        width: "100%",
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.09)",
                        borderRadius: 10,
                        padding: "12px 14px 12px 40px",
                        color: "#fff",
                        fontSize: 14,
                        outline: "none",
                        transition: "all 0.2s",
                        boxSizing: "border-box",
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = "rgba(245,158,11,0.6)";
                        e.target.style.background = "rgba(245,158,11,0.04)";
                        e.target.style.boxShadow =
                          "0 0 0 3px rgba(245,158,11,0.08)";
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = "rgba(255,255,255,0.09)";
                        e.target.style.background = "rgba(255,255,255,0.03)";
                        e.target.style.boxShadow = "none";
                      }}
                    />
                  </div>
                </div>

                {/* Phone Number */}
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#9c97aa",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 8,
                    }}
                  >
                    Phone Number
                  </label>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      position: "relative",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        left: 14,
                        color: "#6b6880",
                        display: "flex",
                        alignItems: "center",
                        fontSize: 14,
                        pointerEvents: "none",
                      }}
                    >
                      📞
                    </span>
                    <input
                      type="text"
                      value={customerPhoneInput}
                      onChange={(e) => handlePhoneInputChange(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleCustomerModalSubmit()
                      }
                      placeholder="e.g. 9876543210"
                      autoComplete="off"
                      style={{
                        width: "100%",
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.09)",
                        borderRadius: 10,
                        padding: "12px 44px 12px 40px",
                        color: "#fff",
                        fontSize: 14,
                        outline: "none",
                        transition: "all 0.2s",
                        boxSizing: "border-box",
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = "rgba(245,158,11,0.6)";
                        e.target.style.background = "rgba(245,158,11,0.04)";
                        e.target.style.boxShadow =
                          "0 0 0 3px rgba(245,158,11,0.08)";
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = "rgba(255,255,255,0.09)";
                        e.target.style.background = "rgba(255,255,255,0.03)";
                        e.target.style.boxShadow = "none";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        handlePickContact((name, phone) => {
                          setCustomerPhoneInput(phone);
                          if (name) setCustomerNameInput(name);
                        })
                      }
                      style={{
                        position: "absolute",
                        right: 8,
                        background: "transparent",
                        border: "none",
                        color: "#f59e0b",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        height: 32,
                        width: 32,
                        borderRadius: 8,
                        transition: "all 0.2s",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                          "rgba(245,158,11,0.12)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                      }
                      title="Pick from Contacts"
                    >
                      <span style={{ fontSize: 15 }}>👤</span>
                    </button>
                  </div>
                </div>

                {/* Suggestions Dropdown */}
                {custSuggestions.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      background: "#1d1928",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 10,
                      marginTop: 6,
                      zIndex: 10,
                      maxHeight: 180,
                      overflowY: "auto",
                      boxShadow: "0 12px 32px rgba(0,0,0,0.7)",
                    }}
                  >
                    {custSuggestions.map((cust) => {
                      const khata = khataRecords.find(
                        (k) => k.customer_id === cust.id,
                      );
                      const due = khata ? khata.balance : 0;
                      return (
                        <div
                          key={cust.id}
                          onClick={() => handleSelectCustomer(cust)}
                          style={{
                            padding: "10px 16px",
                            cursor: "pointer",
                            borderBottom: "1px solid rgba(255,255,255,0.05)",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: 13,
                            transition: "background 0.15s",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background =
                              "rgba(255,255,255,0.04)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                        >
                          <div>
                            <span style={{ fontWeight: 600, color: "#fff" }}>
                              {cust.name}
                            </span>
                            <span
                              style={{
                                color: "#6b6880",
                                marginLeft: 8,
                                fontSize: 11,
                              }}
                            >
                              {cust.phone || "No Phone"}
                            </span>
                          </div>
                          {due > 0 ? (
                            <span
                              style={{
                                color: "#ef4444",
                                fontSize: 11,
                                fontWeight: 700,
                                background: "rgba(239,68,68,0.1)",
                                padding: "2px 7px",
                                borderRadius: 4,
                              }}
                            >
                              ₹{due.toFixed(0)} Due
                            </span>
                          ) : (
                            <span style={{ color: "#9c97aa", fontSize: 11 }}>
                              No Due
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Actions Row */}
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  onClick={handleCustomerModalSkip}
                  style={{
                    flex: 1,
                    padding: 12,
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8,
                    color: "#9c97aa",
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                    e.currentTarget.style.color = "#fff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "#9c97aa";
                  }}
                >
                  Skip
                </button>
                <button
                  onClick={handleCustomerModalSubmit}
                  style={{
                    flex: 2,
                    padding: 12,
                    background: "#f59e0b",
                    color: "#0b0a0f",
                    borderRadius: 8,
                    fontWeight: 800,
                    fontSize: 14,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    transition: "all 0.2s",
                    border: "none",
                    boxShadow: "0 4px 12px rgba(245,158,11,0.2)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#fbbf24";
                    e.currentTarget.style.boxShadow =
                      "0 6px 16px rgba(245,158,11,0.3)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#f59e0b";
                    e.currentTarget.style.boxShadow =
                      "0 4px 12px rgba(245,158,11,0.2)";
                  }}
                >
                  Start Billing <span style={{ fontSize: 16 }}>➔</span>
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Draft recovery prompt */}
      {draftRecoverable && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "rgba(245,158,11,0.15)",
            border: "1px solid #f59e0b",
            padding: "12px 20px",
            borderRadius: 12,
            marginBottom: 20,
          }}
        >
          <span style={{ fontSize: 14, color: "#f59e0b", fontWeight: 600 }}>
            Unsaved draft bill detected from previous session. Continue?
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={onRecoverDraft}
              style={{
                padding: "6px 12px",
                background: "#f59e0b",
                color: "#0b0a0f",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Continue Bill
            </button>
            <button
              onClick={onDiscardDraft}
              style={{
                padding: "6px 12px",
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "#fff",
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              Discard Draft
            </button>
          </div>
        </div>
      )}

      {/* Restructured Header Container */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          marginBottom: 20,
          width: "100%",
        }}
      >
        {/* Row 1: Heading & Back Arrow (each row two div) */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={onBack}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#121017",
                border: "1px solid #2b253b",
                width: 38,
                height: 38,
                borderRadius: 8,
                color: "#9c97aa",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
              title="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <h1
              style={{
                fontSize: isMobile ? 20 : 24,
                fontWeight: 800,
                margin: 0,
              }}
            >
              Billing Terminal
            </h1>
          </div>
          <div></div> {/* Empty second div for layout structure */}
        </div>

        {/* Row 2: History Button & Toggle (each row two div) */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
          }}
        >
          <div>
            <button
              onClick={onGoToHistory}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "#121017",
                border: "1px solid #2b253b",
                padding: "8px 14px",
                borderRadius: 8,
                color: "#9c97aa",
                cursor: "pointer",
                fontSize: 13,
                height: 38,
              }}
            >
              <FileText size={16} /> History
            </button>
          </div>
          <div>
            <div
              style={{
                display: "flex",
                background: "#121017",
                borderRadius: 20,
                padding: 3,
                border: "1px solid #2b253b",
                gap: 2,
                height: 38,
                alignItems: "center",
              }}
            >
              <button
                onClick={() => handleTogglePriceMode(false)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 16,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  background: !isWholesale
                    ? "linear-gradient(135deg, #f59e0b, #d97706)"
                    : "transparent",
                  color: !isWholesale ? "#0b0a0f" : "#9c97aa",
                  border: "none",
                  transition: "all 0.2s",
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                🏷️ MRP
              </button>
              <button
                onClick={() => handleTogglePriceMode(true)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 16,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  background: isWholesale
                    ? "linear-gradient(135deg, #14b8a6, #0d9488)"
                    : "transparent",
                  color: isWholesale ? "#fff" : "#9c97aa",
                  border: "none",
                  transition: "all 0.2s",
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                📦 Wholesale
              </button>
            </div>
          </div>
        </div>

        {/* Row 3: Customer Details (occupy full row one div) */}
        <div style={{ width: "100%" }}>
          <button
            onClick={() => {
              setCustomerNameInput(
                activeBill.customer_name === "Customer"
                  ? ""
                  : activeBill.customer_name,
              );
              setCustomerPhoneInput(
                activeBill.customer_phone === "NA"
                  ? ""
                  : activeBill.customer_phone,
              );
              setCustSuggestions([]);
              setShowCustomerModal(true);
            }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.25)",
              padding: "10px 16px",
              borderRadius: 8,
              color: "#f59e0b",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <User size={16} style={{ minWidth: 16 }} />
              <span style={{ textAlign: "left" }}>
                Customer: <b>{activeBill.customer_name || "Customer"}</b>
                {activeBill.customer_phone &&
                  activeBill.customer_phone !== "NA" &&
                  ` (${activeBill.customer_phone})`}
              </span>
            </div>
            <span
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                color: "#f59e0b",
                opacity: 0.8,
                whiteSpace: "nowrap",
              }}
            >
              Change Details ✏️
            </span>
          </button>
        </div>
      </div>

      {/* Outstanding Due Indicator */}
      {activeBill.customer_id &&
      khataRecords.find(
        (k: KhataRecord) => k.customer_id === activeBill.customer_id,
      )?.balance ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            padding: 10,
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 12,
            color: "#ef4444",
          }}
        >
          <AlertTriangle size={14} />
          <span>
            Outstanding Khata Due:{" "}
            <b>
              ₹
              {khataRecords
                .find(
                  (k: KhataRecord) => k.customer_id === activeBill.customer_id,
                )
                ?.balance.toFixed(2)}
            </b>
          </span>
        </div>
      ) : null}

      {/* ── MOBILE: single-page layout — mini cart on top, add-items below ── */}
      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Add-items panel on top */}
          {renderInputColumn()}

          {/* Compact live cart — below the add-items panel */}
          {activeBill.items.length > 0 && (
            <div className="pos-card" style={{ padding: 16 }}>
              <div
                style={{
                  borderBottom: "1px solid #2b253b",
                  paddingBottom: 8,
                  marginBottom: 10,
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 15 }}>
                  Cart ({activeBill.items.length})
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {activeBill.items.map((item: BillItem) => (
                  <MobileCartItemRow
                    key={`${item.product_id}-${item.unit}`}
                    item={item}
                    onEditItem={handleEditItem}
                    onRemoveItem={onRemoveItem}
                    getProductUnits={getProductUnits}
                  />
                ))}
              </div>
              {/* Plus Button to add custom item */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  marginTop: 6,
                  marginBottom: 6,
                }}
              >
                <button
                  onClick={handleAddCustomItem}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    background: "rgba(245,158,11,0.08)",
                    border: "1px solid rgba(245,158,11,0.2)",
                    borderRadius: 6,
                    color: "#f59e0b",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <Plus size={13} /> Add Custom Item
                </button>
              </div>
              {/* Discount + payment + checkout */}
              <div
                style={{
                  marginTop: 12,
                  borderTop: "1px solid #2b253b",
                  paddingTop: 10,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: "#9c97aa" }}>Subtotal:</span>
                  <span style={{ fontFamily: "monospace" }}>
                    ₹{activeBill.subtotal.toFixed(2)}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: "#9c97aa" }}>Discount (₹):</span>
                  <input
                    type="number"
                    value={activeBill.discount || ""}
                    onChange={(e) =>
                      onSetDiscount(parseFloat(e.target.value) || 0)
                    }
                    placeholder="0"
                    style={{
                      width: 72,
                      padding: "4px 6px",
                      textAlign: "right",
                      background: "#0b0a0f",
                      fontSize: 13,
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 16,
                    fontWeight: 800,
                    borderTop: "1px solid #2b253b",
                    paddingTop: 8,
                    marginTop: 2,
                    marginBottom: 4,
                  }}
                >
                  <span>Grand Total:</span>
                  <span style={{ color: "#f59e0b", fontFamily: "monospace" }}>
                    ₹{activeBill.grand_total.toFixed(2)}
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 8,
                  }}
                >
                  {["Cash", "UPI", "Credit"].map((mode) => (
                    <button
                      key={mode}
                      onClick={() => onSetPaymentMode(mode as any)}
                      style={{
                        padding: 9,
                        borderRadius: 7,
                        fontSize: 12,
                        fontWeight: 600,
                        background:
                          activeBill.payment_mode === mode
                            ? "rgba(245,158,11,0.15)"
                            : "#121017",
                        border:
                          activeBill.payment_mode === mode
                            ? "1px solid #f59e0b"
                            : "1px solid #2b253b",
                        color:
                          activeBill.payment_mode === mode ? "#f59e0b" : "#fff",
                      }}
                    >
                      {mode === "Credit" ? "Khata" : mode}
                    </button>
                  ))}
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <button
                    onClick={handleCheckoutSubmit}
                    style={{
                      padding: 14,
                      borderRadius: 8,
                      background: "#f59e0b",
                      color: "#0b0a0f",
                      fontSize: 15,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    <Printer size={17} /> Complete Bill &amp; Print
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const bill = await useStore
                          .getState()
                          .saveAndSkipPrint();
                        if (bill) {
                           setPrintedBill(bill);
                           triggerConfetti();
                        }
                      } catch (e: any) {
                        alert(e.message || "Failed to save bill.");
                      }
                    }}
                    style={{
                      padding: 11,
                      borderRadius: 8,
                      background: "rgba(20,184,166,0.08)",
                      border: "1px solid rgba(20,184,166,0.25)",
                      color: "#14b8a6",
                      fontSize: 13,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    💾 Save Without Printing
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── DESKTOP: two-column layout ── */
        <div className="billing-grid">
          {renderCartColumn()}
          {renderInputColumn()}
        </div>
      )}

      {/* ── PRINTER OFFLINE / RETRY MODAL ── Bill is already saved ── */}
      {showPrinterOfflineModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 110,
            padding: 20,
          }}
        >
          <div
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 390,
              background: "#121017",
              border: "1px solid #ef4444",
              padding: 28,
              borderRadius: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  background: "rgba(239,68,68,0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                }}
              >
                ⚠️
              </div>
              <div>
                <div
                  style={{ fontSize: 17, fontWeight: 800, color: "#ef4444" }}
                >
                  Print Failed
                </div>
                <div style={{ fontSize: 12, color: "#9c97aa", marginTop: 2 }}>
                  Device: {printerConfig.printer_name || "ATPOS H58BT"}
                </div>
              </div>
            </div>

            <div
              style={{
                background: "rgba(20,184,166,0.08)",
                border: "1px solid rgba(20,184,166,0.25)",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 16,
                fontSize: 13,
                color: "#14b8a6",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>✅</span>
              <span>
                <strong>Bill Saved.</strong> Inventory &amp; Khata updated. You
                can reprint anytime.
              </span>
            </div>

            <p
              style={{
                fontSize: 14,
                color: "#d1cee0",
                lineHeight: 1.6,
                marginBottom: 18,
              }}
            >
              The printer appears to be offline or disconnected. Please verify
              the thermal printer is powered ON and within Bluetooth range, then
              retry.
            </p>

            {retryPrintError && (
              <div
                style={{
                  fontSize: 12,
                  color: "#ef4444",
                  background: "rgba(239,68,68,0.1)",
                  padding: 10,
                  borderRadius: 6,
                  marginBottom: 16,
                }}
              >
                ❌ {retryPrintError}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                type="button"
                onClick={handleRetryPrint}
                style={{
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: 8,
                  background: "#f59e0b",
                  border: "none",
                  color: "#0b0a0f",
                  fontSize: 14,
                  cursor: "pointer",
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
                disabled={retryPrintLoading}
              >
                {retryPrintLoading ? (
                  <>
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        border: "2px solid #0b0a0f",
                        borderTopColor: "transparent",
                        borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                      }}
                      className="animate-spin"
                    ></div>
                    <span>Reprinting...</span>
                  </>
                ) : (
                  <>
                    <Printer size={16} />
                    <span>Retry Print</span>
                  </>
                )}
              </button>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={handleCancelAndEdit}
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    borderRadius: 8,
                    background: "transparent",
                    border: "1px solid #ef4444",
                    color: "#ef4444",
                    fontSize: 13,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                  disabled={retryPrintLoading}
                >
                  Cancel &amp; Edit
                </button>
                <button
                  type="button"
                  onClick={handleSaveWithoutPrinting}
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    borderRadius: 8,
                    background: "rgba(20,184,166,0.12)",
                    border: "1px solid rgba(20,184,166,0.3)",
                    color: "#14b8a6",
                    fontSize: 13,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                  disabled={retryPrintLoading}
                >
                  Save (No Print)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── NO PRINTER CONNECTED MODAL ── Bill is already saved ── */}
      {showNoPrinterModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 110,
            padding: 20,
          }}
        >
          <div
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 390,
              background: "#121017",
              border: "1px solid #f59e0b",
              padding: 28,
              borderRadius: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  background: "rgba(245,158,11,0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                }}
              >
                ⚠️
              </div>
              <div>
                <div
                  style={{ fontSize: 17, fontWeight: 800, color: "#f59e0b" }}
                >
                  No Printer Connected
                </div>
                <div style={{ fontSize: 12, color: "#9c97aa", marginTop: 2 }}>
                  No device is currently acting as printer host
                </div>
              </div>
            </div>

            <div
              style={{
                background: "rgba(20,184,166,0.08)",
                border: "1px solid rgba(20,184,166,0.25)",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 16,
                fontSize: 13,
                color: "#14b8a6",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>✅</span>
              <span>
                <strong>Bill Saved.</strong> Inventory &amp; Khata updated. You
                can print later from History.
              </span>
            </div>

            <p
              style={{
                fontSize: 14,
                color: "#d1cee0",
                lineHeight: 1.6,
                marginBottom: 18,
              }}
            >
              No device is connected to the Bluetooth printer. Reconnect this
              device as the printer host, or keep the saved bill without
              printing.
            </p>

            {retryPrintError && (
              <div
                style={{
                  fontSize: 12,
                  color: "#ef4444",
                  background: "rgba(239,68,68,0.1)",
                  padding: 10,
                  borderRadius: 6,
                  marginBottom: 16,
                }}
              >
                ❌ {retryPrintError}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                type="button"
                onClick={handleRetryPrint}
                style={{
                  width: "100%",
                  padding: "13px 0",
                  borderRadius: 8,
                  background: "#f59e0b",
                  border: "none",
                  color: "#0b0a0f",
                  fontSize: 14,
                  cursor: "pointer",
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
                disabled={retryPrintLoading}
              >
                {retryPrintLoading ? (
                  <>
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        border: "2px solid #0b0a0f",
                        borderTopColor: "transparent",
                        borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                      }}
                      className="animate-spin"
                    ></div>
                    <span>Reconnecting...</span>
                  </>
                ) : (
                  <>
                    <Printer size={16} />
                    <span>Reconnect Printer</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleSaveWithoutPrinting}
                style={{
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: 8,
                  background: "rgba(20,184,166,0.12)",
                  border: "1px solid rgba(20,184,166,0.3)",
                  color: "#14b8a6",
                  fontSize: 14,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
                disabled={retryPrintLoading}
              >
                Save Bill Without Printing
              </button>
            </div>
          </div>
        </div>
      )}
      {/* TICKET RECEIPT POPUP (SIMULATOR FOR ATPOS H58BT) */}
      {printedBill && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: 20,
          }}
        >
          <div
            className="pos-card ticket-print-animation"
            style={{
              width: "100%",
              maxWidth: 360,
              background: "#181520",
              padding: 24,
            }}
          >
            <div className="flex-between" style={{ marginBottom: 16 }}>
              <span
                style={{
                  fontWeight: 800,
                  color: "#14b8a6",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <CheckCircle size={18} /> Receipt Printed Successfully
              </span>
              <button
                onClick={() => setPrintedBill(null)}
                style={{ background: "transparent", color: "#9c97aa" }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Emulated printer roll */}
            <div
              style={{
                maxHeight: 400,
                overflowY: "auto",
                borderRadius: 6,
                margin: "12px 0",
                transform: isMobile ? "scale(0.9)" : "none",
                transformOrigin: "top center",
                display: "flex",
                justifyContent: "center",
                width: "100%",
              }}
              dangerouslySetInnerHTML={{
                __html: generateSimulatedReceipt(printedBill, printerConfig)
                  .html,
              }}
            />

            <button
              onClick={handleShareCurrentBillWhatsApp}
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 8,
                background: "#25D366",
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                border: "none",
                cursor: "pointer",
                marginTop: 16,
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="currentColor"
              >
                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.725 1.451 5.477 0 9.932-4.455 9.935-9.93.002-2.652-1.022-5.146-2.885-7.009-1.864-1.864-4.359-2.887-7.01-2.887-5.485 0-9.94 4.457-9.944 9.932-.001 1.62.428 3.205 1.242 4.616l-.975 3.56 3.657-.968zm11.666-4.63c-.312-.156-1.848-.912-2.129-1.015-.282-.102-.487-.156-.69.156-.204.311-.788 1.015-.966 1.22-.177.205-.355.23-.667.074-1.92-.958-3.178-1.957-4.323-3.92-.302-.518.302-.481.866-1.606.094-.188.047-.353-.024-.509-.071-.156-.69-1.666-.946-2.28-.248-.599-.5-.518-.69-.527-.18-.009-.387-.01-.594-.01s-.54.077-.822.387c-.282.311-1.077 1.051-1.077 2.562 0 1.511 1.098 2.972 1.248 3.179.15.205 2.162 3.303 5.239 4.629.732.316 1.303.504 1.748.646.735.234 1.405.201 1.933.123.589-.088 1.848-.756 2.11-1.45.263-.695.263-1.291.185-1.421-.078-.13-.282-.208-.595-.364z" />
              </svg>
              Share on WhatsApp
            </button>

            <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
              <button
                onClick={() => {
                  alert("Reprint command sent to ATPOS H58BT");
                }}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 8,
                  background: "#2b253b",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                Reprint Roll
              </button>
              <button
                onClick={() => setPrintedBill(null)}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 8,
                  background: "#f59e0b",
                  color: "#0b0a0f",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VOICE VARIANT SELECTION MODAL */}
      {showVoiceVariantsModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 102,
            padding: 20,
          }}
        >
          <div
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 440,
              background: "#121017",
              border: "1px solid #2b253b",
              padding: 24,
              borderRadius: 16,
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
            }}
          >
            <div className="flex-between" style={{ marginBottom: 16 }}>
              <div>
                <h3
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: "#f59e0b",
                    margin: 0,
                  }}
                >
                  Select Variant
                </h3>
                <span style={{ fontSize: 12, color: "#9c97aa" }}>
                  {voiceVariantsGroup}
                </span>
              </div>
              <button
                onClick={() => {
                  setShowVoiceVariantsModal(false);
                  setVoiceVariants([]);
                }}
                style={{
                  background: "transparent",
                  color: "#9c97aa",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                maxHeight: 350,
                overflowY: "auto",
                paddingRight: 4,
                margin: "16px 0",
              }}
            >
              {voiceVariants.map((variant) => {
                // Use the product's own primary unit (units[0]) for display — not scanned_unit which may be undefined
                const primaryUnit =
                  variant.units && variant.units.length > 0
                    ? variant.units[0].unit_name
                    : (variant as any).scanned_unit || "Piece";
                const resolution = resolveUnitAndPrice(variant, 1, primaryUnit);
                const dispPrice = isWholesale
                  ? resolution.resolvedWholesalePrice
                  : resolution.resolvedPrice;
                const dispUnit = resolution.resolvedUnit || primaryUnit;
                return (
                  <button
                    key={`${variant.id}-${primaryUnit}`}
                    onClick={() => handleSelectVoiceVariant(variant)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: 16,
                      borderRadius: 12,
                      background: "#1b1824",
                      border: "1px solid #2b253b",
                      color: "#fff",
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "all 0.2s",
                      outline: "none",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#2b253b";
                      e.currentTarget.style.borderColor = "#f59e0b";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "#1b1824";
                      e.currentTarget.style.borderColor = "#2b253b";
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 14 }}>
                        {variant.display_name}
                      </span>
                      {/* Unit badge */}
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 10px",
                          borderRadius: 20,
                          background: "rgba(245,158,11,0.15)",
                          border: "1px solid rgba(245,158,11,0.35)",
                          color: "#f59e0b",
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          width: "fit-content",
                        }}
                      >
                        {dispUnit}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 4,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 800,
                          color: "#14b8a6",
                          fontSize: 16,
                        }}
                      >
                        ₹{dispPrice}
                      </span>
                      <span style={{ fontSize: 11, color: "#9c97aa" }}>
                        per {dispUnit}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: 12,
              }}
            >
              <button
                onClick={() => {
                  setShowVoiceVariantsModal(false);
                  setVoiceVariants([]);
                }}
                style={{
                  padding: "10px 20px",
                  borderRadius: 8,
                  background: "#2b253b",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BARCODE MULTI-PRODUCT SELECTION MODAL */}
      {showBarcodeMatchesModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 102,
            padding: 20,
          }}
        >
          <div
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 440,
              background: "#121017",
              border: "1px solid #2b253b",
              padding: 24,
              borderRadius: 16,
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
            }}
          >
            <div className="flex-between" style={{ marginBottom: 16 }}>
              <div>
                <h3
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: "#f59e0b",
                    margin: 0,
                  }}
                >
                  Select Scanned Product
                </h3>
                <span style={{ fontSize: 12, color: "#9c97aa" }}>
                  Multiple products share this barcode
                </span>
              </div>
              <button
                onClick={() => {
                  setShowBarcodeMatchesModal(false);
                  setBarcodeMatches([]);
                }}
                style={{
                  background: "transparent",
                  color: "#9c97aa",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                maxHeight: 350,
                overflowY: "auto",
                paddingRight: 4,
                margin: "16px 0",
              }}
            >
              {barcodeMatches.map((prod) => {
                const primaryUnit =
                  prod.units && prod.units.length > 0
                    ? prod.units[0].unit_name
                    : (prod as any).scanned_unit || "Piece";
                const resolution = resolveUnitAndPrice(prod, 1, primaryUnit);
                const dispPrice = isWholesale
                  ? resolution.resolvedWholesalePrice
                  : resolution.resolvedPrice;
                const dispUnit = resolution.resolvedUnit || primaryUnit;
                return (
                  <button
                    key={prod.id}
                    onClick={() => handleSelectBarcodeMatchProduct(prod)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: 16,
                      borderRadius: 12,
                      background: "#1b1824",
                      border: "1px solid #2b253b",
                      color: "#fff",
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "all 0.2s",
                      outline: "none",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#2b253b";
                      e.currentTarget.style.borderColor = "#f59e0b";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "#1b1824";
                      e.currentTarget.style.borderColor = "#2b253b";
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 14 }}>
                        {prod.display_name}
                      </span>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 10px",
                          borderRadius: 20,
                          background: "rgba(20,184,166,0.15)",
                          border: "1px solid rgba(20,184,166,0.35)",
                          color: "#14b8a6",
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          width: "fit-content",
                        }}
                      >
                        {dispUnit}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 4,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 800,
                          color: "#f59e0b",
                          fontSize: 16,
                        }}
                      >
                        ₹{dispPrice}
                      </span>
                      <span style={{ fontSize: 11, color: "#9c97aa" }}>
                        per {dispUnit}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: 12,
              }}
            >
              <button
                onClick={() => {
                  setShowBarcodeMatchesModal(false);
                  setBarcodeMatches([]);
                }}
                style={{
                  padding: "10px 20px",
                  borderRadius: 8,
                  background: "#2b253b",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRODUCT NOT FOUND ADD MINI MODAL */}
      {showAddMiniModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 101,
            padding: 20,
          }}
        >
          <div
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 400,
              background: "#121017",
              border: "1px solid #2b253b",
              padding: 24,
              borderRadius: 12,
            }}
          >
            <div className="flex-between" style={{ marginBottom: 16 }}>
              <h3
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: "#ef4444",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <AlertTriangle size={20} /> Product Not Found
              </h3>
              <button
                onClick={() => setShowAddMiniModal(false)}
                style={{
                  background: "transparent",
                  color: "#9c97aa",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <X size={20} />
              </button>
            </div>

            <p
              style={{
                fontSize: 13,
                color: "#9c97aa",
                marginBottom: 16,
                lineHeight: 1.4,
              }}
            >
              {miniBarcode ? (
                <>
                  Barcode{" "}
                  <code
                    style={{
                      color: "#f59e0b",
                      background: "#1c1926",
                      padding: "2px 6px",
                      borderRadius: 4,
                      fontFamily: "monospace",
                    }}
                  >
                    {miniBarcode}
                  </code>{" "}
                  is not in the system.
                </>
              ) : (
                <>Product is not in the system.</>
              )}{" "}
              Add it now to complete billing immediately.
            </p>

            <form
              onSubmit={handleSaveMiniProduct}
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#9c97aa",
                    textTransform: "uppercase",
                  }}
                >
                  Barcode
                </label>
                <input
                  type="text"
                  value={miniBarcode || "N/A"}
                  disabled
                  style={{
                    background: "#1c1926",
                    border: "1px solid #2b253b",
                    color: "#6d687a",
                    cursor: "not-allowed",
                  }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#9c97aa",
                    textTransform: "uppercase",
                  }}
                >
                  Product Name
                </label>
                <input
                  type="text"
                  value={miniName}
                  onChange={(e) => setMiniName(e.target.value)}
                  placeholder="e.g. Nestle Maggi Masala Noodles"
                  required
                  autoFocus
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#9c97aa",
                      textTransform: "uppercase",
                    }}
                  >
                    MRP (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={miniRetail}
                    onChange={(e) => setMiniRetail(e.target.value)}
                    placeholder="14.00"
                    required
                  />
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#9c97aa",
                      textTransform: "uppercase",
                    }}
                  >
                    Wholesale Price (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={miniWholesale}
                    onChange={(e) => setMiniWholesale(e.target.value)}
                    placeholder="13.50"
                    required
                  />
                </div>
              </div>

              {miniError && (
                <div
                  style={{
                    fontSize: 13,
                    color: "#ef4444",
                    background: "rgba(239,68,68,0.1)",
                    padding: 10,
                    borderRadius: 8,
                  }}
                >
                  {miniError}
                </div>
              )}

              <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowAddMiniModal(false)}
                  style={{
                    flex: 1,
                    padding: 12,
                    borderRadius: 8,
                    background: "#2b253b",
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    flex: 2,
                    padding: 12,
                    borderRadius: 8,
                    background: "#f59e0b",
                    color: "#0b0a0f",
                    fontWeight: 700,
                  }}
                >
                  Save & Bill Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ── BILLING PRODUCT OPTIONS MODAL ───────────────────────── */}
      {selectedAddProduct && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 24,
          }}
        >
          <div
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 440,
              padding: 24,
              border: "1px solid #2b253b",
              background: "#121017",
            }}
          >
            <div className="flex-between" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: "#f59e0b" }}>
                Add to Cart
              </h3>
              <button
                onClick={() => setSelectedAddProduct(null)}
                style={{
                  background: "transparent",
                  color: "#9c97aa",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ marginBottom: 20 }}>
              <h4
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#fff",
                  marginBottom: 4,
                }}
              >
                {selectedAddProduct.display_name}
              </h4>
              <span style={{ fontSize: 13, color: "#9c97aa" }}>
                Base Price:{" "}
                <strong style={{ color: "#fff" }}>
                  ₹{selectedAddProduct.retail_price.toFixed(2)}
                </strong>
                {selectedAddProduct.notes && ` (${selectedAddProduct.notes})`}
              </span>
            </div>

            {/* Quick Overrides Buttons if present */}
            {selectedAddProduct.units &&
              selectedAddProduct.units.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#9c97aa",
                      textTransform: "uppercase",
                      display: "block",
                      marginBottom: 8,
                    }}
                  >
                    Quick Package Units
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {selectedAddProduct.units.map((u, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setAddUnit(u.unit_name);
                          setAddQuantity(1);
                        }}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 600,
                          background:
                            addUnit === u.unit_name
                              ? "rgba(245,158,11,0.2)"
                              : "#2b253b",
                          border:
                            addUnit === u.unit_name
                              ? "1px solid #f59e0b"
                              : "1px solid #2b253b",
                          color: addUnit === u.unit_name ? "#f59e0b" : "#fff",
                          cursor: "pointer",
                        }}
                      >
                        {u.unit_name} - ₹{u.price}
                      </button>
                    ))}
                  </div>
                </div>
              )}

            {/* Custom Conversions List info if present */}
            {selectedAddProduct.unit_conversions &&
              selectedAddProduct.unit_conversions.length > 0 && (
                <div
                  style={{
                    background: "#1c1926",
                    padding: 10,
                    borderRadius: 8,
                    marginBottom: 20,
                    fontSize: 12,
                    color: "#9c97aa",
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      color: "#f59e0b",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    Conversions:
                  </span>
                  {selectedAddProduct.unit_conversions.map((c, idx) => (
                    <div key={idx}>
                      1 {c.parent_unit} = {c.conversion_factor} {c.child_unit}
                    </div>
                  ))}
                </div>
              )}

            {/* Manual quantity & unit selector */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
                marginBottom: 24,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#9c97aa",
                    textTransform: "uppercase",
                  }}
                >
                  Quantity
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={addQuantity}
                  onChange={(e) =>
                    setAddQuantity(parseFloat(e.target.value) || 0)
                  }
                  required
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#9c97aa",
                    textTransform: "uppercase",
                  }}
                >
                  Quantity Type
                </label>
                {(() => {
                  // Compute smart unit options based on product category
                  const productCat = categories.find(
                    (c) => c.id === selectedAddProduct.category_id,
                  );
                  const categoryUnits = productCat?.default_units || [];
                  const productUnits =
                    selectedAddProduct.units?.map((u) => u.unit_name) || [];
                  // Merge: product-specific first, then category defaults, then generic fallbacks
                  const genericUnits = [
                    "Piece",
                    "Pudha",
                    "KG",
                    "Gram",
                    "Litre",
                    "ML",
                    "Bottle",
                  ];

                  return (
                    <select
                      value={addUnit}
                      onChange={(e) => setAddUnit(e.target.value)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: "1px solid #2b253b",
                        background: "#121017",
                        color: "#f3f1f6",
                        fontSize: 14,
                        width: "100%",
                        cursor: "pointer",
                        appearance: "auto",
                      }}
                    >
                      <option value="">— Select Unit —</option>
                      {productUnits.length > 0 && (
                        <optgroup
                          label={`📦 ${selectedAddProduct.display_name} Sizes`}
                        >
                          {productUnits.map((u) => (
                            <option key={`pu-${u}`} value={u}>
                              {u} — ₹
                              {selectedAddProduct.units
                                ?.find((uu) => uu.unit_name === u)
                                ?.price?.toFixed(2) || ""}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {categoryUnits.length > 0 && (
                        <optgroup
                          label={`${productCat?.measurement_type === "Weight" ? "⚖️" : productCat?.measurement_type === "Volume" ? "💧" : "📦"} ${productCat?.name || "Category"} Units`}
                        >
                          {categoryUnits
                            .filter((u) => !productUnits.includes(u))
                            .map((u) => (
                              <option key={`cu-${u}`} value={u}>
                                {u}
                              </option>
                            ))}
                        </optgroup>
                      )}
                      <optgroup label="📦 Other Units">
                        {genericUnits
                          .filter(
                            (u) =>
                              !productUnits.includes(u) &&
                              !categoryUnits.includes(u),
                          )
                          .map((u) => (
                            <option key={`gu-${u}`} value={u}>
                              {u}
                            </option>
                          ))}
                      </optgroup>
                    </select>
                  );
                })()}
                {(() => {
                  const productCat = categories.find(
                    (c) => c.id === selectedAddProduct.category_id,
                  );
                  if (!productCat) return null;
                  return (
                    <span
                      style={{ fontSize: 10, color: "#9c97aa", marginTop: 2 }}
                    >
                      Category: {productCat.name} •{" "}
                      {productCat.measurement_type === "Weight"
                        ? "⚖️"
                        : productCat.measurement_type === "Volume"
                          ? "💧"
                          : "📦"}{" "}
                      {productCat.measurement_type}
                    </span>
                  );
                })()}
              </div>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button
                type="button"
                onClick={() => setSelectedAddProduct(null)}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 8,
                  background: "#2b253b",
                  color: "#fff",
                  fontWeight: 700,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  handleAddItem(selectedAddProduct, addQuantity, addUnit);
                  setSelectedAddProduct(null);
                }}
                style={{
                  flex: 2,
                  padding: 12,
                  borderRadius: 8,
                  background: "#f59e0b",
                  color: "#0b0a0f",
                  fontWeight: 700,
                }}
              >
                Add to Cart
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PRINTING PROGRESS MODAL ── */}
      {showPrintingProgressModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 110,
            padding: 20,
          }}
        >
          <div
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 350,
              background: "#121017",
              border: "1px solid #2b253b",
              padding: 28,
              borderRadius: 14,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                position: "relative",
                width: 64,
                height: 64,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {printingStatusText !== "Success" ? (
                <>
                  <div
                    style={{
                      position: "absolute",
                      width: "100%",
                      height: "100%",
                      border: "4px solid rgba(245,158,11,0.1)",
                      borderRadius: "50%",
                    }}
                  ></div>
                  <div
                    style={{
                      position: "absolute",
                      width: "100%",
                      height: "100%",
                      border: "4px solid #f59e0b",
                      borderTopColor: "transparent",
                      borderRadius: "50%",
                      animation: "spin 1s linear infinite",
                    }}
                  ></div>
                  <span style={{ fontSize: 24 }}>🖨️</span>
                </>
              ) : (
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    background: "rgba(20,184,166,0.15)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 32,
                  }}
                >
                  ✅
                </div>
              )}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color:
                    printingStatusText === "Success" ? "#14b8a6" : "#f59e0b",
                }}
              >
                {printingStatusText}
              </div>
              <div
                style={{ fontSize: 12, color: "#9c97aa", textAlign: "center" }}
              >
                {printingStatusText === "Connecting..." &&
                  "Reaching printer host..."}
                {printingStatusText === "Printing..." &&
                  "Sending receipt to thermal printer..."}
                {printingStatusText === "Success" &&
                  "Receipt printed successfully!"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// SCREEN 6: PRODUCTS MANAGER
// ----------------------------------------------------

const WEIGHT_SUBUNITS = [
  { label: "500g", ratio: 0.5 },
  { label: "250g", ratio: 0.25 },
  { label: "100g", ratio: 0.1 },
];
const VOLUME_SUBUNITS = [
  { label: "500ml", ratio: 0.5 },
  { label: "250ml", ratio: 0.25 },
  { label: "100ml", ratio: 0.1 },
];

type MeasurementTypeValue =
  | "Weight"
  | "Volume"
  | "Carton"
  | "Bag"
  | "Tray"
  | "Sheet"
  | "";

const MEASUREMENT_TYPES_LIST: {
  value: MeasurementTypeValue;
  label: string;
  emoji: string;
  desc: string;
}[] = [
  { value: "Weight", label: "Weight", emoji: "⚖️", desc: "KG / Gram" },
  { value: "Volume", label: "Volume", emoji: "💧", desc: "Litre / ML" },
  { value: "Carton", label: "Carton", emoji: "📦", desc: "Carton" },
  { value: "Bag", label: "Bag", emoji: "🛍️", desc: "Bag" },
  { value: "Tray", label: "Tray", emoji: "🥚", desc: "Tray / Egg" },
  { value: "Sheet", label: "Sheet", emoji: "📄", desc: "Sheet" },
];

const SUB_UNIT_OPTIONS: Record<string, string[]> = {
  Weight: ["KG", "Gram"],
  Volume: ["Litre", "ML"],
  Carton: ["Carton", "Pudha", "Piece"],
  Bag: ["Bag", "Piece"],
  Tray: ["Tray", "Piece"],
  Sheet: ["Sheet", "Piece"],
};

// Maps measurement type <-> category_id for billing terminal compatibility
const MEASUREMENT_TO_CAT_ID: Record<string, number> = {
  Weight: 1,
  Volume: 2,
  Carton: 3,
  Bag: 4,
  Tray: 5,
  Sheet: 7,
};
const CAT_ID_TO_MEASUREMENT: Record<number, MeasurementTypeValue> = {
  1: "Weight",
  2: "Volume",
  3: "Carton",
  4: "Bag",
  5: "Tray",
  7: "Sheet",
};

function ProductsManager({
  products,
  categories: _categories,
  onBack,
}: {
  products: Product[];
  categories: Category[];
  onBack: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"list" | "create">("list");
  const [name, setName] = useState("");
  const [retail, setRetail] = useState("");
  const [wholesale, setWholesale] = useState("");
  const [aliases, setAliases] = useState("");
  const [aliasLoading, setAliasLoading] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [lastLookedUpCode, setLastLookedUpCode] = useState("");

  // Choice states for barcode registry scan/lookup conflicts
  const [showRegistryConflictModal, setShowRegistryConflictModal] = useState(false);
  const [conflictBarcode, setConflictBarcode] = useState("");
  const [conflictProducts, setConflictProducts] = useState<Product[]>([]);

  // Extra barcodes states
  const [additionalBarcodes, setAdditionalBarcodes] = useState<string[]>([]);
  const [showAddExtraBarcodeModal, setShowAddExtraBarcodeModal] = useState(false);
  const [extraBarcodeValue, setExtraBarcodeValue] = useState("");
  const [extraBarcodeScannerActive, setExtraBarcodeScannerActive] = useState(false);

  // Catalog search, sort, and filters
  const [catalogSearch, setCatalogSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("All");
  const [filterBarcode, setFilterBarcode] = useState<
    "All" | "Barcode" | "Loose"
  >("All");
  const [catalogSort, setCatalogSort] = useState<string>("name-asc");
  const [currentPage, setCurrentPage] = useState(1);

  // Reset page on filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [catalogSearch, filterType, filterBarcode, catalogSort]);


  // New: Measurement Type system (replaces old category + baseUnit)
  const [measurementType, setMeasurementType] =
    useState<MeasurementTypeValue>("");
  const [subUnit, setSubUnit] = useState(""); // e.g. KG, Gram, Litre, ML, Carton, Bag …
  const [quantity, setQuantity] = useState("1");
  const [subUnitPrices, setSubUnitPrices] = useState<
    Record<string, { retail: string; wholesale: string }>
  >({}); // label -> price override

  // Quick Voice Parser
  const [voiceLoadText, setVoiceLoadText] = useState("");
  const [voiceMicActive, setVoiceMicActive] = useState(false);
  const [voiceRecognition, setVoiceRecognition] = useState<any>(null);

  const isMobile = useIsMobile();

  const [cameraActive, setCameraActive] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);

  const [catalogCameraActive, setCatalogCameraActive] = useState(false);

  const startCatalogCameraScanner = async () => {
    setError("");
    setInfoMessage("");
    setCatalogCameraActive(true);
    await stopCameraScanner();

    await startBarcodeScanner(
      "catalog-scanner-viewfinder",
      async (decodedText: string) => {
        const cleanCode = decodedText.trim();
        await stopCatalogCameraScanner();

        const matches = await db.findProductsByBarcode(cleanCode);
        if (matches && matches.length > 0) {
          setConflictBarcode(cleanCode);
          setConflictProducts(matches);
          setShowRegistryConflictModal(true);
        } else {
          resetForm();
          setActiveTab("create");
          setBarcode(cleanCode);
          setInfoMessage(
            `🆕 New barcode "${cleanCode}". Pre-filled registration form.`,
          );
          handleBarcodeFieldLookup(cleanCode);
        }
      },
      (err: string) => {
        setError(err);
        setCatalogCameraActive(false);
      },
    );
  };

  const stopCatalogCameraScanner = async () => {
    await stopBarcodeScanner();
    setCatalogCameraActive(false);
  };

  const startExtraBarcodeScanner = async () => {
    setError("");
    setInfoMessage("");
    setExtraBarcodeScannerActive(true);
    await stopCameraScanner();
    await stopCatalogCameraScanner();

    await startBarcodeScanner(
      "extra-barcode-scanner-viewfinder",
      async (decodedText: string) => {
        const clean = decodedText.trim();
        setExtraBarcodeValue(clean);
        await stopExtraBarcodeScanner();
      },
      (err: string) => {
        console.error(err);
        setExtraBarcodeScannerActive(false);
      }
    );
  };

  const stopExtraBarcodeScanner = async () => {
    await stopBarcodeScanner();
    setExtraBarcodeScannerActive(false);
  };

  const autoFlashTimeoutRef = useRef<any>(null);
  const cameraActiveRef = useRef(false);
  const flashOnRef = useRef(false);

  useEffect(() => {
    return () => {
      stopCameraScanner();
      stopCatalogCameraScanner();
      stopExtraBarcodeScanner();
    };
  }, []);

  const handleMeasurementTypeChange = (type: MeasurementTypeValue) => {
    setMeasurementType(type);
    const opts = type ? SUB_UNIT_OPTIONS[type] || [] : [];
    setSubUnit(opts.length > 0 ? opts[0] : "");
    setQuantity("1");
    setSubUnitPrices({});
  };

  const handleSubUnitChange = (unit: string) => {
    setSubUnit(unit);
    setQuantity("1");
    setSubUnitPrices({});
  };

  const handleSyncAllProductAliases = async () => {
    setError("");
    setInfoMessage("");
    const targets = products.filter(
      (p) => !p.aliases || p.aliases.length === 0,
    );
    if (targets.length === 0) {
      setInfoMessage("All products already have voice search aliases!");
      return;
    }
    const geminiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || "";
    const groqKey = (import.meta as any).env?.VITE_GROQ_API_KEY || "";
    if (!geminiKey && !groqKey) {
      setError(
        "Please configure VITE_GEMINI_API_KEY or VITE_GROQ_API_KEY in the .env file to generate AI aliases.",
      );
      return;
    }
    setSyncLoading(true);
    let successCount = 0;
    try {
      for (const prod of targets) {
        try {
          const generated = await generateProductAliases(prod.display_name);
          if (generated && generated.length > 0) {
            await db.saveProduct({ ...prod, aliases: generated });
            successCount++;
          }
        } catch (e) {
          console.error(
            `Failed to generate aliases for ${prod.display_name}:`,
            e,
          );
        }
      }
      if (successCount > 0) {
        setInfoMessage(
          `Successfully generated AI aliases for ${successCount} products!`,
        );
        useStore.getState().loadStoreData();
        useStore.getState().triggerSync();
      } else {
        setError(
          "Failed to generate aliases. Please check internet connection or API settings.",
        );
      }
    } catch (err: any) {
      setError(err.message || "Error syncing aliases.");
    } finally {
      setSyncLoading(false);
    }
  };

  const resetForm = () => {
    setName("");
    setRetail("");
    setWholesale("");
    setBarcode("");
    setAdditionalBarcodes([]);
    setShowAddExtraBarcodeModal(false);
    setExtraBarcodeValue("");
    setExtraBarcodeScannerActive(false);
    setAliases("");
    setError("");
    setInfoMessage("");
    setLastLookedUpCode("");
    setEditingProductId(null);
    setMeasurementType("");
    setSubUnit("");
    setQuantity("1");
    setSubUnitPrices({});
    setCatalogCameraActive(false);
    stopBarcodeScanner().catch(() => {});
  };

  const handleEditClick = (originalProd: Product) => {
    const suffixes = [
      " piece",
      " pieces",
      " pc",
      " pcs",
      " bag",
      " bags",
      " carton",
      " cartons",
      " cartoon",
      " cartoons",
      " tray",
      " trays",
      " sheet",
      " sheets",
      " pudha",
      " pudhas",
      " puda",
      " pudas",
      " box",
      " boxes",
      " packet",
      " packets",
    ];
    let prod = originalProd;
    const nameLower = originalProd.display_name.toLowerCase();
    for (const suffix of suffixes) {
      if (nameLower.endsWith(suffix)) {
        const strippedName = originalProd.display_name
          .slice(0, -suffix.length)
          .trim();
        if (strippedName) {
          const mainProd = products.find(
            (p) =>
              p.id !== originalProd.id &&
              p.display_name.toLowerCase() === strippedName.toLowerCase(),
          );
          if (mainProd) {
            prod = mainProd;
            break;
          }
        }
      }
    }

    setEditingProductId(prod.id);
    setName(prod.display_name);
    setRetail(String(prod.retail_price));
    setWholesale(String(prod.wholesale_price));
    const primaryBc = prod.barcode || (prod.barcodes && prod.barcodes[0]) || "";
    setBarcode(primaryBc);
    if (prod.barcodes) {
      setAdditionalBarcodes(prod.barcodes.filter(b => b !== primaryBc && b !== ""));
    } else {
      setAdditionalBarcodes([]);
    }
    setAliases(prod.aliases?.join(", ") || "");

    // Reconstruct measurement type from category_id or first stored unit
    let mt: MeasurementTypeValue = "";
    if (prod.category_id && CAT_ID_TO_MEASUREMENT[prod.category_id]) {
      mt = CAT_ID_TO_MEASUREMENT[prod.category_id];
    }

    const storedUnits = [...(prod.units || [])];

    // Find all family products in the DB to load their prices as unit pricing variants
    const currentBase = getBaseBrandName(prod.display_name);
    const familyProducts = products.filter(
      (p) =>
        p.id !== prod.id && getBaseBrandName(p.display_name) === currentBase,
    );

    familyProducts.forEach((fp) => {
      fp.units?.forEach((u) => {
        if (
          !storedUnits.some(
            (su) => su.unit_name.toLowerCase() === u.unit_name.toLowerCase(),
          )
        ) {
          storedUnits.push(u);
        }
      });
    });

    if (storedUnits.length > 0) {
      const firstUnit = storedUnits[0].unit_name;
      setQuantity(String(storedUnits[0].quantity || 1));
      if (!mt) {
        if (["KG", "Gram"].includes(firstUnit)) mt = "Weight";
        else if (["Litre", "ML"].includes(firstUnit)) mt = "Volume";
        else if (["Carton", "Pudha"].includes(firstUnit)) mt = "Carton";
        else if (["Bag"].includes(firstUnit)) mt = "Bag";
        else if (["Tray"].includes(firstUnit)) mt = "Tray";
        else if (["Sheet"].includes(firstUnit)) mt = "Sheet";
        else mt = "Carton";
      }
      setMeasurementType(mt);
      setSubUnit(firstUnit);
      const overrides: Record<string, { retail: string; wholesale: string }> =
        {};
      storedUnits.slice(1).forEach((u) => {
        const familyMatch = findProductInFamilyForUnit(
          [prod, ...familyProducts],
          u.unit_name,
        );

        let retailVal = "";
        if (u.price !== undefined && u.price !== null && u.price !== 0) {
          retailVal = String(u.price);
        } else if (familyMatch) {
          retailVal = String(familyMatch.retail_price);
        }

        let wholesaleVal = "";
        if (
          u.wholesale_price !== undefined &&
          u.wholesale_price !== null &&
          u.wholesale_price !== 0
        ) {
          wholesaleVal = String(u.wholesale_price);
        } else if (familyMatch) {
          wholesaleVal = String(familyMatch.wholesale_price);
        }

        overrides[u.unit_name] = {
          retail: retailVal,
          wholesale: wholesaleVal,
        };
      });
      setSubUnitPrices(overrides);
    } else {
      setMeasurementType(mt);
      const opts = mt ? SUB_UNIT_OPTIONS[mt] || [] : [];
      setSubUnit(opts.length > 0 ? opts[0] : "");
      setQuantity("1");
      setSubUnitPrices({});
    }
    setActiveTab("create");
  };

  const handleSuggestAliases = async (
    productName: string,
    fallbackAliases?: string[],
  ) => {
    if (!productName.trim()) return;
    setAliasLoading(true);
    setError("");
    try {
      const suggested = await generateProductAliases(productName);
      if (suggested && suggested.length > 0) {
        setAliases(suggested.join(", "));
      } else if (fallbackAliases) {
        setAliases(fallbackAliases.join(", "));
      }
    } catch (err) {
      console.error(err);
      if (fallbackAliases) {
        setAliases(fallbackAliases.join(", "));
      } else {
        setError("Failed to suggest AI aliases.");
      }
    } finally {
      setAliasLoading(false);
    }
  };

  const [deleteConfirmProduct, setDeleteConfirmProduct] =
    useState<Product | null>(null);

  const handleDeleteProduct = (prod: Product) => {
    setDeleteConfirmProduct(prod);
  };

  const confirmDeleteAction = async () => {
    if (!deleteConfirmProduct) return;
    const prod = deleteConfirmProduct;
    try {
      // Delete the main product
      await db.deleteProduct(prod.id);

      // Also delete all packaging variants of the same brand family
      const currentBase = getBaseBrandName(prod.display_name);
      const familyVariants = products.filter(
        (p) =>
          p.id !== prod.id &&
          getBaseBrandName(p.display_name) === currentBase &&
          p.display_name
            .toLowerCase()
            .includes(prod.display_name.toLowerCase()),
      );
      for (const v of familyVariants) {
        await db.deleteProduct(v.id);
      }

      setInfoMessage(
        `Successfully deleted "${prod.display_name}" and its variants.`,
      );
      useStore.getState().loadStoreData();
      useStore.getState().triggerSync();
    } catch (err: any) {
      setError(err.message || "Failed to delete product.");
    } finally {
      setDeleteConfirmProduct(null);
    }
  };

  const handleBarcodeFieldLookup = async (code: string, force = false) => {
    const cleanCode = code.trim();
    if (!cleanCode) return;
    if (!force && cleanCode === lastLookedUpCode) return;
    setLastLookedUpCode(cleanCode);
    setLookupLoading(true);
    setError("");
    setInfoMessage("");
    try {
      const matches = await db.findProductsByBarcode(cleanCode);
      if (matches && matches.length > 0) {
        setConflictBarcode(cleanCode);
        setConflictProducts(matches);
        setShowRegistryConflictModal(true);
      } else {
        setEditingProductId(null);
        const apiResult = await db.apiBarcodeLookup(cleanCode);
        if (apiResult) {
          const fullName =
            `${apiResult.brand} ${apiResult.product_name} ${apiResult.quantity}`.trim();
          setName(fullName);
          setInfoMessage(
            `Product found online. Please enter retail and wholesale prices.`,
          );

          setAliases("");
          const fallbacks = [apiResult.product_name, apiResult.brand].filter(
            Boolean,
          );
          handleSuggestAliases(fullName, fallbacks);
        } else {
          setError(`Barcode "${cleanCode}" not found. Enter details manually.`);
        }
      }
    } catch (err) {
      console.error(err);
      setError("Lookup failed. Enter details manually.");
    } finally {
      setLookupLoading(false);
    }
  };

  const handleToggleFlash = async () => {
    const nextState = !flashOn;
    const success = await setTorch(nextState);
    if (success) {
      setFlashOn(nextState);
      flashOnRef.current = nextState;
      if (autoFlashTimeoutRef.current) {
        clearTimeout(autoFlashTimeoutRef.current);
        autoFlashTimeoutRef.current = null;
      }
    } else {
      setError("Flash/Torch is not supported on this camera/device.");
    }
  };

  const startCameraScanner = async () => {
    setError("");
    setInfoMessage("");
    setCameraActive(true);
    setFlashOn(false);
    cameraActiveRef.current = true;
    flashOnRef.current = false;

    if (autoFlashTimeoutRef.current) clearTimeout(autoFlashTimeoutRef.current);
    autoFlashTimeoutRef.current = setTimeout(async () => {
      if (cameraActiveRef.current && !flashOnRef.current) {
        const success = await setTorch(true);
        if (success) {
          setFlashOn(true);
          flashOnRef.current = true;
        }
      }
    }, 3500);

    await startBarcodeScanner(
      "product-scanner-viewfinder",
      async (decodedText: string) => {
        const cleanCode = decodedText.trim();
        setBarcode(cleanCode);
        await stopCameraScanner();
        await handleBarcodeFieldLookup(cleanCode);
      },
      (err: string) => {
        setError(err);
        setCameraActive(false);
        cameraActiveRef.current = false;
        if (autoFlashTimeoutRef.current) {
          clearTimeout(autoFlashTimeoutRef.current);
          autoFlashTimeoutRef.current = null;
        }
      },
    );
  };

  const stopCameraScanner = async () => {
    if (autoFlashTimeoutRef.current) {
      clearTimeout(autoFlashTimeoutRef.current);
      autoFlashTimeoutRef.current = null;
    }
    await stopBarcodeScanner();
    setCameraActive(false);
    cameraActiveRef.current = false;
    setFlashOn(false);
    flashOnRef.current = false;
  };

  const handleVoiceCreateAI = async (inputText?: string) => {
    setError("");
    setInfoMessage("");
    const textToParse = inputText !== undefined ? inputText : voiceLoadText;
    if (!textToParse.trim()) return;
    try {
      setAliasLoading(true);
      const parsed = await parseProductCreationVoiceCommand(textToParse);
      setName(parsed.display_name);
      setRetail(String(parsed.retail_price || ""));
      setWholesale(String(parsed.wholesale_price || ""));

      const catToMt: Record<string, MeasurementTypeValue> = {
        weight: "Weight",
        volume: "Volume",
        cartoon: "Carton",
        bag: "Bag",
        tray: "Tray",
        sheet: "Sheet",
      };
      if (parsed.category) {
        const mt = catToMt[parsed.category.toLowerCase()] || "Carton";
        setMeasurementType(mt);
        const opts = SUB_UNIT_OPTIONS[mt] || [];
        const parsedUnit =
          parsed.unit && opts.includes(parsed.unit)
            ? parsed.unit
            : opts[0] || "Piece";
        setSubUnit(parsedUnit);
        setQuantity(String(parsed.quantity || 1));
      }
      if (parsed.overrides && parsed.overrides.length > 0) {
        const overridesObj: Record<
          string,
          { retail: string; wholesale: string }
        > = {};
        parsed.overrides.forEach((o: any) => {
          overridesObj[o.unit_name] = {
            retail: String(o.price || ""),
            wholesale: "",
          };
        });
        setSubUnitPrices(overridesObj);
      } else {
        setSubUnitPrices({});
      }

      // Auto-generate rich AI aliases using the dedicated generateProductAliases service
      let finalAliases = parsed.aliases || [];
      if (parsed.display_name) {
        try {
          const suggested = await generateProductAliases(parsed.display_name);
          if (suggested && suggested.length > 0) {
            finalAliases = Array.from(new Set([...finalAliases, ...suggested]));
          }
        } catch (err) {
          console.error(
            "Failed to auto-generate AI aliases inside voice create:",
            err,
          );
        }
      }
      setAliases(finalAliases.join(", ") || "");

      setInfoMessage("✅ Quick Voice Parser successfully populated the form!");
      setVoiceLoadText("");
    } catch (err: any) {
      console.error(err);
      setError("Failed to parse voice command. Enter details manually.");
    } finally {
      setAliasLoading(false);
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || !retail || !wholesale) {
      setError("Please fill in Display Name, MRP, and Wholesale Price.");
      return;
    }
    if (!measurementType) {
      setError(
        "Please select a Measurement Type (Weight, Volume, Carton, etc.).",
      );
      return;
    }
    if (!subUnit) {
      setError("Please select a Sub Unit (KG, Gram, Litre, ML, Carton, etc.).");
      return;
    }

    const cleanName = name.trim();
    const rawProducts = await db.getAllProductsRaw();

    // ── 1. BARCODE COLLISION CHECK ──
    const allFormBarcodes = [barcode, ...additionalBarcodes].map(b => b.trim()).filter(b => b && b !== "SYS-PENDING");
    const barcodeMatch = rawProducts.find(
      (p) =>
        p.id !== editingProductId &&
        !(p as any).is_deleted &&
        allFormBarcodes.some(fb => p.barcode === fb || p.barcodes?.includes(fb))
    );

    if (barcodeMatch) {
      const collidedBarcode = allFormBarcodes.find(fb => barcodeMatch.barcode === fb || barcodeMatch.barcodes?.includes(fb));
      const keepBoth = window.confirm(
        `Warning: The barcode '${collidedBarcode || ""}' is already associated with '${barcodeMatch.display_name}'.\n\nDo you want to assign this barcode to both products?`
      );
      if (!keepBoth) {
        return;
      }
    }

    // ── 2. NAME MATCH CHECK (RESTORE / MERGE STOCK) ──
    const nameMatch = rawProducts.find(
      (p) =>
        p.id !== editingProductId &&
        !(p as any).is_deleted &&
        p.display_name.toLowerCase() === cleanName.toLowerCase(),
    );
    if (nameMatch) {
      alert(
        `Product '${nameMatch.display_name}' already exists in the catalog.`,
      );
      return;
    }

    const basePrice = parseFloat(retail);
    const qty = parseFloat(quantity) || 1.0;
    const resolvedSubUnit = subUnit || "Piece";

    const computedUnits: any[] = [
      {
        unit_name: resolvedSubUnit,
        quantity: qty,
        price: basePrice,
        wholesale_price: parseFloat(wholesale),
      },
    ];

    if (measurementType === "Weight" && resolvedSubUnit === "KG") {
      WEIGHT_SUBUNITS.forEach((su) => {
        const ov = subUnitPrices[su.label];
        if (
          ov &&
          ((ov.retail !== undefined && ov.retail !== "") ||
            (ov.wholesale !== undefined && ov.wholesale !== ""))
        ) {
          const price =
            ov.retail !== undefined && ov.retail !== ""
              ? parseFloat(ov.retail)
              : parseFloat(((basePrice * su.ratio) / qty).toFixed(2));
          const wPrice =
            ov.wholesale !== undefined && ov.wholesale !== ""
              ? parseFloat(ov.wholesale)
              : parseFloat(
                  ((parseFloat(wholesale) * su.ratio) / qty).toFixed(2),
                );
          computedUnits.push({
            unit_name: su.label,
            quantity: su.ratio,
            price,
            wholesale_price: wPrice,
          });
        }
      });
    } else if (measurementType === "Volume" && resolvedSubUnit === "Litre") {
      VOLUME_SUBUNITS.forEach((su) => {
        const ov = subUnitPrices[su.label];
        if (
          ov &&
          ((ov.retail !== undefined && ov.retail !== "") ||
            (ov.wholesale !== undefined && ov.wholesale !== ""))
        ) {
          const price =
            ov.retail !== undefined && ov.retail !== ""
              ? parseFloat(ov.retail)
              : parseFloat(((basePrice * su.ratio) / qty).toFixed(2));
          const wPrice =
            ov.wholesale !== undefined && ov.wholesale !== ""
              ? parseFloat(ov.wholesale)
              : parseFloat(
                  ((parseFloat(wholesale) * su.ratio) / qty).toFixed(2),
                );
          computedUnits.push({
            unit_name: su.label,
            quantity: su.ratio,
            price,
            wholesale_price: wPrice,
          });
        }
      });
    } else if (
      measurementType &&
      measurementType !== "Weight" &&
      measurementType !== "Volume"
    ) {
      const opts = activeSubunits;
      opts.forEach((su) => {
        const ov = subUnitPrices[su.label];
        const retailVal = ov?.retail;
        const wholesaleVal = ov?.wholesale;
        if (
          (retailVal !== undefined && retailVal !== "") ||
          (wholesaleVal !== undefined && wholesaleVal !== "")
        ) {
          computedUnits.push({
            unit_name: su.label,
            quantity: 1.0,
            price: retailVal ? parseFloat(retailVal) : basePrice,
            wholesale_price: wholesaleVal
              ? parseFloat(wholesaleVal)
              : parseFloat(wholesale),
          });
        }
      });
    }

    const catId = measurementType
      ? MEASUREMENT_TO_CAT_ID[measurementType]
      : undefined;
    const mainProd = await db.saveProduct({
      id: editingProductId || undefined,
      display_name: name.trim(),
      category_id: catId,
      retail_price: basePrice,
      wholesale_price: parseFloat(wholesale),
      barcode:
        barcode === "SYS-PENDING" ? undefined : barcode.trim() || undefined,
      barcodes: [barcode, ...additionalBarcodes].map(b => b.trim()).filter(b => b && b !== "SYS-PENDING"),
      aliases: aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
      unit_conversions: [],
      units: computedUnits,
    });

    // Automatically create / update / delete separate products in the database for packaging variant units
    const UNIT_TO_CAT_ID: Record<string, number> = {
      carton: 3,
      bag: 4,
      tray: 5,
      box: 6,
      packet: 6,
      pudha: 6,
      sheet: 7,
    };

    const activeVariantUnits = computedUnits.filter(
      (u) => u.unit_name.toLowerCase() !== resolvedSubUnit.toLowerCase(),
    );
    const allProds = await db.getProducts();

    // 1. Create or Update variants
    for (const u of activeVariantUnits) {
      const variantCatId = UNIT_TO_CAT_ID[u.unit_name.toLowerCase()] || catId;
      const capUnitName =
        u.unit_name.charAt(0).toUpperCase() +
        u.unit_name.slice(1).toLowerCase();
      const variantName = name.toLowerCase().includes(u.unit_name.toLowerCase())
        ? name.trim()
        : `${name.trim()} ${capUnitName}`;

      const existingVariant = allProds.find(
        (p) =>
          p.id !== mainProd.id &&
          (p.display_name.toLowerCase() === variantName.toLowerCase() ||
            (getBaseBrandName(p.display_name) === getBaseBrandName(name) &&
              p.category_id === variantCatId)),
      );

      const variantAliases = aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean)
        .map((a) =>
          a.toLowerCase().includes(u.unit_name.toLowerCase())
            ? a
            : `${a} ${u.unit_name.toLowerCase()}`,
        );

      await db.saveProduct({
        id: existingVariant?.id || undefined,
        display_name: variantName,
        category_id: variantCatId,
        retail_price: u.price,
        wholesale_price: u.wholesale_price || u.price,
        barcode: mainProd.barcode || undefined, // Share barcode with all family members
        aliases: variantAliases,
        unit_conversions: [],
        units: [
          {
            unit_name: capUnitName,
            quantity: 1.0,
            price: u.price,
            wholesale_price: u.wholesale_price,
          },
        ],
      });
    }

    // 2. Delete obsolete variants (e.g. if the user cleared a price override from the form)
    const activeVariantNames = activeVariantUnits.map((u) =>
      u.unit_name.toLowerCase(),
    );
    const obsoleteVariants = allProds.filter(
      (p) =>
        p.id !== mainProd.id &&
        getBaseBrandName(p.display_name) === getBaseBrandName(name) &&
        p.category_id !== undefined &&
        [3, 4, 5, 6, 7].includes(p.category_id) &&
        !activeVariantNames.includes(
          CAT_ID_TO_MEASUREMENT[p.category_id]?.toLowerCase(),
        ),
    );

    for (const ov of obsoleteVariants) {
      await db.deleteProduct(ov.id);
    }

    // ── 3. Barcode migration: ensure exactly ONE active barcode record exists for the shared barcode ──
    // We assign the shared barcode only to the main product, and deactivate it for all other variant products
    // to satisfy Supabase's unique constraint.
    {
      const allProdsAfter = await db.getProducts();
      const allBarcodesAfter = db.getRawList<DbBarcode>("sr_barcodes"); // fetch all including deleted

      const familyBase = getBaseBrandName(name);
      const currentFamilyMembers = allProdsAfter.filter(
        (p) => getBaseBrandName(p.display_name) === familyBase,
      );

      if (currentFamilyMembers.length > 0) {
        // Find the owner member (mainProd)
        const sortedMembers = [...currentFamilyMembers].sort((a, b) => {
          const aIsMain =
            !/\b(piece|pieces|pc|pcs|bag|bags|carton|cartons|cartoon|cartoons|tray|trays|sheet|sheets|pudha|pudhas|puda|pudas)\b/i.test(
              a.display_name,
            );
          const bIsMain =
            !/\b(piece|pieces|pc|pcs|bag|bags|carton|cartons|cartoon|cartoons|tray|trays|sheet|sheets|pudha|pudhas|puda|pudas)\b/i.test(
              b.display_name,
            );
          if (aIsMain && !bIsMain) return -1;
          if (!aIsMain && bIsMain) return 1;
          return (a.retail_price || 0) - (b.retail_price || 0);
        });
        const owner = sortedMembers[0] || mainProd;

        // Find all barcodes for any of the family members
        const memberIds = currentFamilyMembers.map((fm) => fm.id);
        const familyBarcodes = allBarcodesAfter.filter((b) =>
          memberIds.includes(b.product_id),
        );

        // Determine the shared barcode string to use
        let sharedBarcode = familyBarcodes.find(
          (b) =>
            !b.is_deleted &&
            b.is_active &&
            !b.is_system &&
            !b.barcode.toLowerCase().startsWith("sys-"),
        )?.barcode;
        if (!sharedBarcode) {
          sharedBarcode = familyBarcodes.find(
            (b) =>
              !b.is_deleted &&
              b.is_active &&
              b.barcode.startsWith("SYS-") &&
              !b.barcode.includes("-", 4),
          )?.barcode;
        }
        if (!sharedBarcode) {
          sharedBarcode = familyBarcodes.find(
            (b) => !b.is_deleted && b.is_active,
          )?.barcode;
        }
        if (!sharedBarcode && mainProd.barcode) {
          sharedBarcode = mainProd.barcode;
        }

        if (sharedBarcode) {
          // We must ensure the owner has the shared barcode, and all other records with this barcode string are deactivated.
          let primaryRecord = allBarcodesAfter.find(
            (b) => b.product_id === owner.id && b.barcode === sharedBarcode,
          );
          let updatedBarcodesList = [...allBarcodesAfter];
          let changed = false;

          if (!primaryRecord) {
            // Find if any record with this barcode string exists (even if mapped to someone else)
            const duplicate = allBarcodesAfter.find(
              (b) => b.barcode === sharedBarcode,
            );
            if (duplicate) {
              // Update this existing record to point to owner.id!
              const idx = updatedBarcodesList.findIndex(
                (b) => b.id === duplicate.id,
              );
              if (idx !== -1) {
                updatedBarcodesList[idx] = {
                  ...updatedBarcodesList[idx],
                  product_id: owner.id,
                  is_active: true,
                  is_deleted: false,
                  updated_at: new Date().toISOString(),
                  version: (updatedBarcodesList[idx].version || 1) + 1,
                };
                db.addToSyncQueue(
                  "barcodes",
                  String(duplicate.id),
                  "UPDATE",
                  updatedBarcodesList[idx],
                );
                primaryRecord = updatedBarcodesList[idx];
                changed = true;
              }
            } else {
              // Create new record for the owner
              const devId = db.getSetting("device_id") || "unknown";
              const newId =
                updatedBarcodesList.reduce(
                  (max, item) => (item.id > max ? item.id : max),
                  0,
                ) + 1;
              const newB = {
                id: newId,
                product_id: owner.id,
                barcode: sharedBarcode,
                barcode_type: "Code-128",
                unit: owner.units?.[0]?.unit_name || "Piece",
                is_system: sharedBarcode.toLowerCase().startsWith("sys-"),
                is_active: true,
                is_deleted: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                version: 1,
                updated_by: devId,
              };
              updatedBarcodesList.push(newB);
              db.addToSyncQueue("barcodes", String(newId), "INSERT", newB);
              primaryRecord = newB;
              changed = true;
            }
          } else {
            // Ensure primaryRecord is active & not deleted
            const idx = updatedBarcodesList.findIndex(
              (b) => b.id === primaryRecord!.id,
            );
            if (
              idx !== -1 &&
              (!updatedBarcodesList[idx].is_active ||
                updatedBarcodesList[idx].is_deleted)
            ) {
              updatedBarcodesList[idx] = {
                ...updatedBarcodesList[idx],
                is_active: true,
                is_deleted: false,
                updated_at: new Date().toISOString(),
                version: (updatedBarcodesList[idx].version || 1) + 1,
              };
              db.addToSyncQueue(
                "barcodes",
                String(primaryRecord.id),
                "UPDATE",
                updatedBarcodesList[idx],
              );
              changed = true;
            }
          }

          // Deactivate all OTHER barcode records in the family that have the same barcode string OR are system barcodes
          familyBarcodes.forEach((b) => {
            if (primaryRecord && b.id === primaryRecord.id) return;
            const isDuplicateBarcodeString = b.barcode === sharedBarcode;
            const isSystemBarcode =
              b.is_system || b.barcode.toLowerCase().startsWith("sys-");
            if (isDuplicateBarcodeString || isSystemBarcode) {
              const idx = updatedBarcodesList.findIndex((x) => x.id === b.id);
              if (
                idx !== -1 &&
                (updatedBarcodesList[idx].is_active ||
                  !updatedBarcodesList[idx].is_deleted)
              ) {
                const prev = updatedBarcodesList[idx];
                updatedBarcodesList[idx] = {
                  ...prev,
                  is_active: false,
                  is_deleted: true,
                  barcode: prev.barcode.includes("-deleted-")
                    ? prev.barcode
                    : `${prev.barcode}-deleted-${prev.id}`,
                  updated_at: new Date().toISOString(),
                  version: (prev.version || 1) + 1,
                };
                db.addToSyncQueue(
                  "barcodes",
                  String(b.id),
                  "UPDATE",
                  updatedBarcodesList[idx],
                );
                changed = true;
              }
            }
          });

          if (changed) {
            db.saveList("sr_barcodes", updatedBarcodesList);
            await db.rebuildProductsCache();
          }
        }
      }
    }

    // If the user requested a system barcode generation
    if (barcode === "SYS-PENDING") {
      try {
        const allBarcodes = await db.getBarcodes();
        const productBarcodes = allBarcodes.filter(
          (b) => b.product_id === mainProd.id,
        );
        let maxIndex = 0;
        productBarcodes.forEach((b) => {
          const parts = b.barcode.split("-");
          if (parts.length >= 3) {
            const idx = parseInt(parts[2], 10);
            if (!isNaN(idx) && idx > maxIndex) {
              maxIndex = idx;
            }
          }
        });
        const nextIndex = maxIndex + 1;
        const barcodeCode = `SYS-${mainProd.id}-${nextIndex}`;
        const unitNameForBarcode =
          measurementType === "Weight" || measurementType === "Volume"
            ? `${qty} ${resolvedSubUnit}`
            : resolvedSubUnit;

        await db.addBarcode(
          mainProd.id,
          barcodeCode,
          "Code-128",
          unitNameForBarcode,
          true,
        );

        // Trigger auto-print preview of the newly generated barcode label
        if ((window as any)._setBarcodePreview) {
          (window as any)._setBarcodePreview({
            barcode: barcodeCode,
            productName: mainProd.display_name,
            unitName: unitNameForBarcode,
          });
        }
      } catch (err) {
        console.error(
          "Failed to auto-generate system barcode on product save:",
          err,
        );
      }
    }

    await useStore.getState().loadStoreData();
    resetForm();
    setActiveTab("list");
    setInfoMessage("Product saved successfully!");

    // Trigger background sync instantly
    useStore.getState().triggerSync();
  };

  const getSubUnitPrice = (
    label: string,
    ratio: number,
    priceType: "retail" | "wholesale",
  ) => {
    const ov = subUnitPrices[label];
    const val = priceType === "retail" ? ov?.retail : ov?.wholesale;
    if (val !== undefined && val !== "") return val;
    if (measurementType === "Weight" || measurementType === "Volume") {
      const bp =
        priceType === "retail"
          ? parseFloat(retail) || 0
          : parseFloat(wholesale) || 0;
      const qty = parseFloat(quantity) || 1.0;
      return bp > 0 && qty > 0 ? ((bp * ratio) / qty).toFixed(2) : "";
    }
    return "";
  };

  const showSubUnitOverrides = !!measurementType;
  const ALL_PACKAGING_UNITS = [
    "Piece",
    "Bag",
    "Carton",
    "Tray",
    "Sheet",
    "Pudha",
  ];
  const activeSubunits =
    measurementType === "Weight"
      ? WEIGHT_SUBUNITS
      : measurementType === "Volume"
        ? VOLUME_SUBUNITS
        : ALL_PACKAGING_UNITS.filter((u) => u !== subUnit).map((u) => ({
            label: u,
            ratio: 1,
          }));

  // Filter and sort products
  const processedProducts = React.useMemo(() => {
    let list = [...products];

    // Search filter
    const query = catalogSearch.toLowerCase().trim();
    if (query) {
      list = list.filter(
        (p) =>
          p.display_name.toLowerCase().includes(query) ||
          p.barcode?.toLowerCase().includes(query) ||
          p.aliases?.some((a) => a.toLowerCase().includes(query)),
      );
    }

    // Measurement Type filter
    if (filterType !== "All") {
      list = list.filter((p) => {
        const mt = p.category_id ? CAT_ID_TO_MEASUREMENT[p.category_id] : null;
        return mt === filterType;
      });
    }

    // Barcode status filter
    if (filterBarcode === "Barcode") {
      list = list.filter((p) => !!p.barcode || (p.barcodes && p.barcodes.length > 0));
    } else if (filterBarcode === "Loose") {
      list = list.filter((p) => !p.barcode && (!p.barcodes || p.barcodes.length === 0));
    }

    // Filter out variant products if their base product exists in the list
    list = list.filter((p) => {
      if (p.category_id && [3, 4, 5, 6, 7].includes(p.category_id)) {
        const baseName = getBaseBrandName(p.display_name);
        const hasBaseProd = products.some(
          (other) =>
            other.id !== p.id &&
            getBaseBrandName(other.display_name) === baseName &&
            p.display_name
              .toLowerCase()
              .includes(other.display_name.toLowerCase()) &&
            p.display_name.length > other.display_name.length,
        );
        if (hasBaseProd) {
          return false;
        }
      }
      return true;
    });

    // Sorting
    list.sort((a, b) => {
      switch (catalogSort) {
        case "name-asc":
          return a.display_name.localeCompare(b.display_name);
        case "name-desc":
          return b.display_name.localeCompare(a.display_name);
        case "mrp-asc":
          return a.retail_price - b.retail_price;
        case "mrp-desc":
          return b.retail_price - a.retail_price;
        case "wholesale-asc":
          return a.wholesale_price - b.wholesale_price;
        case "wholesale-desc":
          return b.wholesale_price - a.wholesale_price;
        default:
          return 0;
      }
    });

    return list;
  }, [products, catalogSearch, filterType, filterBarcode, catalogSort]);

  const ITEMS_PER_PAGE = 50;
  const paginatedProducts = React.useMemo(() => {
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    return processedProducts.slice(startIdx, startIdx + ITEMS_PER_PAGE);
  }, [processedProducts, currentPage]);

  const totalPages = Math.ceil(processedProducts.length / ITEMS_PER_PAGE);


  return (
    <div
      style={{ maxWidth: 880, margin: "0 auto" }}
      className="animate-slide-up"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <button
          onClick={onBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "#121017",
            border: "1px solid #2b253b",
            padding: "8px 12px",
            borderRadius: 8,
            color: "#9c97aa",
            cursor: "pointer",
          }}
        >
          <ArrowLeft size={16} /> Back
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>Product Catalog</h1>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            background: "#121017",
            borderRadius: 8,
            padding: 4,
            width: isMobile ? "100%" : 300,
          }}
        >
          <button
            onClick={() => {
              setActiveTab("list");
              resetForm();
            }}
            style={{
              flex: 1,
              padding: 8,
              borderRadius: 6,
              background: activeTab === "list" ? "#2b253b" : "transparent",
              color: activeTab === "list" ? "#fff" : "#9c97aa",
              fontSize: 13,
            }}
          >
            Catalog List
          </button>
          <button
            onClick={() => {
              setActiveTab("create");
              resetForm();
            }}
            style={{
              flex: 1,
              padding: 8,
              borderRadius: 6,
              background: activeTab === "create" ? "#2b253b" : "transparent",
              color: activeTab === "create" ? "#fff" : "#9c97aa",
              fontSize: 13,
            }}
          >
            Add Product
          </button>
        </div>
        {activeTab === "list" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={
                catalogCameraActive
                  ? stopCatalogCameraScanner
                  : startCatalogCameraScanner
              }
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                background: catalogCameraActive
                  ? "#ef4444"
                  : "rgba(167,139,250,0.1)",
                border: catalogCameraActive
                  ? "1px solid #ef4444"
                  : "1px solid #a78bfa",
                color: catalogCameraActive ? "#fff" : "#a78bfa",
                fontSize: 13,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              <Barcode size={14} />
              {catalogCameraActive ? "Stop Scanner" : "Scan Barcode for Edits"}
            </button>
            <button
              onClick={handleSyncAllProductAliases}
              disabled={syncLoading}
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                background: "rgba(245,158,11,0.1)",
                border: "1px solid #f59e0b",
                color: "#f59e0b",
                fontSize: 13,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {syncLoading ? (
                <RefreshCw className="animate-spin" size={14} />
              ) : (
                <Zap size={14} />
              )}
              {syncLoading ? "Syncing Aliases..." : "Sync AI Aliases"}
            </button>
          </div>
        )}
      </div>

      {activeTab === "list" && catalogCameraActive && (
        <div
          className="pos-card animate-scale-up"
          style={{
            padding: 16,
            marginBottom: 16,
            border: "1px solid #a78bfa",
            background: "#121017",
          }}
        >
          <div className="flex-between" style={{ marginBottom: 12 }}>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#a78bfa",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Barcode size={16} /> Scan Barcode for Edit/Register
            </span>
            <button
              onClick={stopCatalogCameraScanner}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                background: "#ef4444",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
          <div
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "4/3",
              maxHeight: 260,
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid #2b253b",
            }}
          >
            <div
              id="catalog-scanner-viewfinder"
              style={{ width: "100%", height: "100%", background: "#000" }}
            ></div>
          </div>
        </div>
      )}

      {activeTab === "list" && (
        <div
          className="pos-card"
          style={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            gap: 12,
            padding: 16,
            marginBottom: 16,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {/* Search Box */}
          <div
            style={{
              position: "relative",
              flex: 1,
              minWidth: isMobile ? "100%" : 220,
            }}
          >
            <input
              type="text"
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
              placeholder="Search by name, barcode, or alias..."
              style={{
                width: "100%",
                paddingLeft: 34,
                fontSize: 13,
                background: "#121017",
                border: "1px solid #2b253b",
                borderRadius: 8,
                color: "#fff",
              }}
            />
            <Search
              size={15}
              style={{
                position: "absolute",
                left: 12,
                top: 13,
                color: "#9c97aa",
              }}
            />
          </div>

          {/* Filter: Type */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              width: isMobile ? "100%" : "auto",
            }}
          >
            <span
              style={{ fontSize: 12, color: "#9c97aa", whiteSpace: "nowrap" }}
            >
              Type:
            </span>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              style={{
                padding: "6px 10px",
                fontSize: 13,
                background: "#121017",
                border: "1px solid #2b253b",
                borderRadius: 6,
                color: "#fff",
                minWidth: 110,
              }}
            >
              <option value="All">All Types</option>
              <option value="Weight">⚖️ Weight</option>
              <option value="Volume">💧 Volume</option>
              <option value="Bag">🛍️ Bag</option>
              <option value="Carton">📦 Carton</option>
              <option value="Tray">📥 Tray</option>
              <option value="Sheet">📄 Sheet</option>
            </select>
          </div>

          {/* Filter: Barcode Status */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              width: isMobile ? "100%" : "auto",
            }}
          >
            <span
              style={{ fontSize: 12, color: "#9c97aa", whiteSpace: "nowrap" }}
            >
              Barcode:
            </span>
            <select
              value={filterBarcode}
              onChange={(e) => setFilterBarcode(e.target.value as any)}
              style={{
                padding: "6px 10px",
                fontSize: 13,
                background: "#121017",
                border: "1px solid #2b253b",
                borderRadius: 6,
                color: "#fff",
                minWidth: 120,
              }}
            >
              <option value="All">All Items</option>
              <option value="Barcode">Barcode only</option>
              <option value="Loose">Loose only</option>
            </select>
          </div>

          {/* Sort Selector */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              width: isMobile ? "100%" : "auto",
              marginLeft: isMobile ? 0 : "auto",
            }}
          >
            <span
              style={{ fontSize: 12, color: "#9c97aa", whiteSpace: "nowrap" }}
            >
              Sort:
            </span>
            <select
              value={catalogSort}
              onChange={(e) => setCatalogSort(e.target.value)}
              style={{
                padding: "6px 10px",
                fontSize: 13,
                background: "#121017",
                border: "1px solid #2b253b",
                borderRadius: 6,
                color: "#fff",
                minWidth: 140,
              }}
            >
              <option value="name-asc">Name (A-Z)</option>
              <option value="name-desc">Name (Z-A)</option>
              <option value="mrp-asc">MRP: Low to High</option>
              <option value="mrp-desc">MRP: High to Low</option>
              <option value="wholesale-asc">Wholesale: Low to High</option>
              <option value="wholesale-desc">Wholesale: High to Low</option>
            </select>
          </div>
        </div>
      )}

      {infoMessage && (
        <div
          style={{
            color: "#10b981",
            fontSize: 13,
            background: "rgba(16,185,129,0.1)",
            padding: 10,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          {infoMessage}
        </div>
      )}
      {error && (
        <div
          style={{
            color: "#ef4444",
            fontSize: 13,
            background: "rgba(239,68,68,0.1)",
            padding: 10,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {activeTab === "list" ? (
        isMobile ? (
          <div className="mobile-card-list animate-fade-in">
            {paginatedProducts.length === 0 ? (
              <div
                style={{ textAlign: "center", padding: 40, color: "#9c97aa" }}
              >
                No matching products found.
              </div>
            ) : (
              paginatedProducts.map((prod) => {
                const currentBase = getBaseBrandName(prod.display_name);
                const family = products.filter(
                  (p) => getBaseBrandName(p.display_name) === currentBase,
                );
                family.sort((a, b) => a.retail_price - b.retail_price);

                return (
                  <div key={prod.id} className="mobile-card">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: 15,
                            color: "#fff",
                          }}
                        >
                          {prod.display_name}
                        </span>
                        {(() => {
                          const mt = prod.category_id
                            ? CAT_ID_TO_MEASUREMENT[prod.category_id]
                            : null;
                          const info = mt
                            ? MEASUREMENT_TYPES_LIST.find((m) => m.value === mt)
                            : null;
                          if (!info) return null;
                          return (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                padding: "1px 6px",
                                borderRadius: 4,
                                marginTop: 4,
                                background:
                                  mt === "Weight"
                                    ? "rgba(20,184,166,0.1)"
                                    : mt === "Volume"
                                      ? "rgba(59,130,246,0.1)"
                                      : "rgba(245,158,11,0.1)",
                                color:
                                  mt === "Weight"
                                    ? "#14b8a6"
                                    : mt === "Volume"
                                      ? "#3b82f6"
                                      : "#f59e0b",
                                alignSelf: "flex-start",
                                              }}
                            >
                              {info.emoji} {info.label}
                            </span>
                          );
                        })()}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          gap: 4,
                          }}
                      >
                        {family.map((f) => {
                          const unitLabel =
                            f.id === prod.id
                              ? prod.units?.[0]?.unit_name || "Piece"
                              : f.units?.[0]?.unit_name || "Unit";
                          return (
                            <div
                              key={f.id}
                              style={{ display: "flex", gap: 6, fontSize: 11 }}
                            >
                              <span
                                style={{ color: "#9c97aa", fontWeight: 600 }}
                              >
                                {unitLabel}:
                              </span>
                              <span
                                style={{
                                  background: "rgba(20,184,166,0.1)",
                                  color: "#14b8a6",
                                  fontWeight: 700,
                                  padding: "1px 4px",
                                  borderRadius: 4,
                                  fontFamily: "monospace",
                                }}
                              >
                                M: ₹{f.retail_price.toFixed(0)}
                              </span>
                              <span
                                style={{
                                  background: "rgba(245,158,11,0.1)",
                                  color: "#f59e0b",
                                  fontWeight: 700,
                                  padding: "1px 4px",
                                  borderRadius: 4,
                                  fontFamily: "monospace",
                                }}
                              >
                                W: ₹{f.wholesale_price.toFixed(0)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        fontSize: 12,
                        borderTop: "1px solid #2b253b",
                        paddingTop: 8,
                        marginTop: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ color: "#9c97aa" }}>Barcode:</span>
                        <span
                          style={{ color: "#f3f1f6", fontFamily: "monospace" }}
                        >
                          {prod.barcode || (prod.barcodes && prod.barcodes[0]) || "Loose Item"}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "flex-end",
                          gap: 8,
                          marginTop: 8,
                          borderTop: "1px dashed #2b253b",
                          paddingTop: 8,
                        }}
                      >
                        <button
                          onClick={() => handleEditClick(prod)}
                          style={{
                            padding: "4px 10px",
                            background: "rgba(245,158,11,0.15)",
                            border: "1px solid #f59e0b",
                            color: "#f59e0b",
                            fontSize: 11,
                            borderRadius: 6,
                            fontWeight: 700,
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(prod)}
                          style={{
                            padding: "4px 10px",
                            background: "rgba(239,68,68,0.15)",
                            border: "1px solid #ef4444",
                            color: "#ef4444",
                            fontSize: 11,
                            borderRadius: 6,
                            fontWeight: 700,
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            
            {/* Mobile Pagination Controls */}
            {totalPages > 1 && (
              <div style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: 12,
                marginTop: 20,
                padding: "8px 0",
              }}>
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    background: currentPage === 1 ? "transparent" : "rgba(167,139,250,0.15)",
                    border: "1px solid #2b253b",
                    color: currentPage === 1 ? "#4b4855" : "#a78bfa",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: currentPage === 1 ? "not-allowed" : "pointer",
                  }}
                >
                  Prev
                </button>
                <span style={{ fontSize: 13, color: "#9c97aa", fontWeight: 600 }}>
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    background: currentPage === totalPages ? "transparent" : "rgba(167,139,250,0.15)",
                    border: "1px solid #2b253b",
                    color: currentPage === totalPages ? "#4b4855" : "#a78bfa",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        ) : (
          <div
            className="pos-card animate-fade-in"
            style={{ padding: 0, overflow: "hidden" }}
          >
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 640 }}>
                {/* Table Header */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 1fr 1fr 1fr 1.2fr 0.8fr",
                    background: "#121017",
                    padding: "12px 20px",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#9c97aa",
                    borderBottom: "1px solid #2b253b",
                  }}
                >
                  <span>Name</span>
                  <span>Units</span>
                  <span>Purchase Price</span>
                  <span>Retail Price</span>
                  <span>Barcodes</span>
                  <span style={{ textAlign: "right" }}>Actions</span>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    maxHeight: 440,
                    overflowY: "auto",
                  }}
                >
                  {paginatedProducts.length === 0 ? (
                    <div
                      style={{
                        textAlign: "center",
                        padding: 40,
                        color: "#9c97aa",
                      }}
                    >
                      No matching products found.
                    </div>
                  ) : (
                    paginatedProducts.map((prod) => {
                      const currentBase = getBaseBrandName(prod.display_name);
                      const family = products.filter(
                        (p) => getBaseBrandName(p.display_name) === currentBase,
                      );
                      family.sort((a, b) => a.retail_price - b.retail_price);

                      return (
                        <div
                          key={prod.id}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "2fr 1fr 1fr 1fr 1.2fr 0.8fr",
                            padding: "14px 20px",
                            fontSize: 14,
                            borderBottom: "1px solid #2b253b",
                            alignItems: "center",
                          }}
                        >
                          <span style={{ fontWeight: 700 }}>
                            {prod.display_name}
                          </span>
                          <span style={{ fontSize: 11 }}>
                            {(() => {
                              // Show the actual units this product family is sold in (e.g. "Piece / Bag")
                              const familyUnits = family.map(
                                (f) => f.units?.[0]?.unit_name || "Piece",
                              );
                              const uniqueUnits = Array.from(
                                new Set(familyUnits),
                              );
                              const mt = prod.category_id
                                ? CAT_ID_TO_MEASUREMENT[prod.category_id]
                                : null;
                              const unitColor =
                                mt === "Weight"
                                  ? "#14b8a6"
                                  : mt === "Volume"
                                    ? "#3b82f6"
                                    : "#f59e0b";
                              return (
                                <span
                                  style={{ color: unitColor, fontWeight: 600 }}
                                >
                                  {uniqueUnits.join(" / ")}
                                </span>
                              );
                            })()}
                          </span>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 2,
                            }}
                          >
                            {family.map((f) => {
                              const unitLabel =
                                f.id === prod.id
                                  ? prod.units?.[0]?.unit_name || "Piece"
                                  : f.units?.[0]?.unit_name || "Unit";
                              return (
                                <span
                                  key={f.id}
                                  style={{
                                    fontFamily: "monospace",
                                    fontSize: 12,
                                  }}
                                >
                                  {unitLabel}: ₹{f.retail_price.toFixed(2)}
                                </span>
                              );
                            })}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 2,
                            }}
                          >
                            {family.map((f) => {
                              const unitLabel =
                                f.id === prod.id
                                  ? prod.units?.[0]?.unit_name || "Piece"
                                  : f.units?.[0]?.unit_name || "Unit";
                              return (
                                <span
                                  key={f.id}
                                  style={{
                                    fontFamily: "monospace",
                                    fontSize: 12,
                                    color: "#f59e0b",
                                  }}
                                >
                                  {unitLabel}: ₹{f.wholesale_price.toFixed(2)}
                                </span>
                              );
                            })}
                          </div>

                          <span
                            style={{
                              color: "#9c97aa",
                              fontSize: 12,
                              fontFamily: "monospace",
                            }}
                          >
                            {prod.barcode || (prod.barcodes && prod.barcodes[0]) || "Loose Item"}
                          </span>
                          <div
                            style={{
                              textAlign: "right",
                              display: "flex",
                              justifyContent: "flex-end",
                              gap: 8,
                            }}
                          >
                            <button
                              onClick={() => handleEditClick(prod)}
                              style={{
                                padding: "4px 10px",
                                background: "rgba(245,158,11,0.15)",
                                border: "1px solid #f59e0b",
                                color: "#f59e0b",
                                fontSize: 12,
                                borderRadius: 6,
                                fontWeight: 700,
                              }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteProduct(prod)}
                              style={{
                                padding: "4px 10px",
                                background: "rgba(239,68,68,0.15)",
                                border: "1px solid #ef4444",
                                color: "#ef4444",
                                fontSize: 12,
                                borderRadius: 6,
                                fontWeight: 700,
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                
                {/* Desktop Pagination Controls */}
                {totalPages > 1 && (
                  <div style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 20px",
                    background: "#121017",
                    borderTop: "1px solid #2b253b",
                  }}>
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 6,
                        background: currentPage === 1 ? "transparent" : "rgba(167,139,250,0.15)",
                        border: "1px solid #2b253b",
                        color: currentPage === 1 ? "#4b4855" : "#a78bfa",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: currentPage === 1 ? "not-allowed" : "pointer",
                      }}
                    >
                      Prev
                    </button>
                    <span style={{ fontSize: 13, color: "#9c97aa", fontWeight: 600 }}>
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 6,
                        background: currentPage === totalPages ? "transparent" : "rgba(167,139,250,0.15)",
                        border: "1px solid #2b253b",
                        color: currentPage === totalPages ? "#4b4855" : "#a78bfa",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                      }}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      ) : (
        <div
          style={{ maxWidth: 640, margin: "0 auto" }}
          className="animate-fade-in"
        >
          {/* ── PRODUCT REGISTRATION FORM ───────────────────────── */}
          <div className="pos-card" style={{ padding: isMobile ? 16 : 24 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
                {editingProductId
                  ? "✏️ Edit Product"
                  : "➕ Register New Product"}
              </h3>
              <button
                type="button"
                onClick={async () => {
                  if (voiceMicActive) {
                    if (Capacitor.isNativePlatform()) {
                      try {
                        await SpeechPlugin.stopListening();
                      } catch {}
                    } else {
                      voiceRecognition?.stop();
                    }
                    setVoiceMicActive(false);
                    setVoiceRecognition(null);
                    return;
                  }

                  if (Capacitor.isNativePlatform()) {
                    setVoiceMicActive(true);
                    setVoiceRecognition(null);
                    try {
                      const result = await SpeechPlugin.startListening();
                      const speechText = pickBestSpeechTranscript(result);
                      if (speechText) handleVoiceCreateAI(speechText);
                    } catch (err: any) {
                      setError(
                        err?.message || "Native speech recognition failed.",
                      );
                    } finally {
                      setVoiceMicActive(false);
                      setVoiceRecognition(null);
                    }
                    return;
                  }

                  const SR =
                    (window as any).SpeechRecognition ||
                    (window as any).webkitSpeechRecognition;
                  if (!SR) {
                    setError(
                      "Speech recognition not supported on this browser.",
                    );
                    return;
                  }
                  const rec = new SR();
                  rec.continuous = false;
                  rec.interimResults = false;
                  rec.onresult = (ev: any) => {
                    const speechText = ev.results[0][0].transcript;
                    handleVoiceCreateAI(speechText);
                    setVoiceMicActive(false);
                    setVoiceRecognition(null);
                  };
                  rec.onerror = () => {
                    setVoiceMicActive(false);
                    setVoiceRecognition(null);
                  };
                  rec.onend = () => {
                    setVoiceMicActive(false);
                    setVoiceRecognition(null);
                  };
                  rec.start();
                  setVoiceMicActive(true);
                  setVoiceRecognition(rec);
                }}
                style={{
                  background: voiceMicActive
                    ? "#ef4444"
                    : "rgba(245,158,11,0.15)",
                  color: voiceMicActive ? "#fff" : "#f59e0b",
                  border: voiceMicActive
                    ? "none"
                    : "1px solid rgba(245,158,11,0.3)",
                  borderRadius: "50%",
                  width: 36,
                  height: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
                  transition: "all 0.2s",
                  flexShrink: 0,
                }}
                title="Voice Create Product"
              >
                {voiceMicActive ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
            </div>

            {voiceMicActive && (
              <div
                style={{
                  background: "rgba(245,158,11,0.1)",
                  border: "1px solid rgba(245,158,11,0.25)",
                  padding: 10,
                  borderRadius: 8,
                  marginBottom: 12,
                  fontSize: 12,
                  color: "#f59e0b",
                  textAlign: "center",
                  fontWeight: 600,
                }}
                className="animate-pulse"
              >
                🎙️ Listening... Speak product details (e.g., "Sugar weight 1 kg
                retail 40 wholesale 38")
              </div>
            )}

            <form
              onSubmit={handleSaveProduct}
              style={{ display: "flex", flexDirection: "column", gap: 18 }}
            >
              {/* PRODUCT NAME */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#9c97aa",
                    textTransform: "uppercase",
                  }}
                >
                  Product Display Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Salt, Sugar, Tata Salt 1kg"
                  required
                  onBlur={() => {
                    if (!aliases.trim() && name.trim())
                      handleSuggestAliases(name);
                  }}
                />
              </div>

              {/* BARCODE */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#9c97aa",
                    textTransform: "uppercase",
                  }}
                >
                  Barcode (Optional)
                </label>
                <div
                  style={{
                    display: "flex",
                    flexDirection: isMobile ? "column" : "row",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", gap: 8, flex: 1 }}>
                    <input
                      type="text"
                      value={barcode}
                      onChange={(e) => setBarcode(e.target.value)}
                      placeholder="Scan or type barcode number"
                      disabled={barcode === "SYS-PENDING"}
                      style={{
                        flex: 1,
                        cursor:
                          barcode === "SYS-PENDING" ? "not-allowed" : "text",
                        opacity: barcode === "SYS-PENDING" ? 0.7 : 1,
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleBarcodeFieldLookup(barcode);
                        }
                      }}
                      onBlur={(e) => {
                        if (barcode !== "SYS-PENDING")
                          handleBarcodeFieldLookup(e.target.value);
                      }}
                    />
                    {barcode.trim() && barcode !== "SYS-PENDING" && (
                      <button
                        type="button"
                        onClick={() => {
                          setExtraBarcodeValue("");
                          setExtraBarcodeScannerActive(false);
                          setShowAddExtraBarcodeModal(true);
                        }}
                        style={{
                          padding: "0 14px",
                          background: "#059669",
                          border: "1px solid #059669",
                          borderRadius: 8,
                          color: "#fff",
                          fontSize: 18,
                          fontWeight: 700,
                          cursor: "pointer",
                          height: isMobile ? 44 : 40,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        title="Add multiple barcodes for this product"
                      >
                        +
                      </button>
                    )}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      width: isMobile ? "100%" : "auto",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handleBarcodeFieldLookup(barcode, true)}
                      disabled={
                        lookupLoading ||
                        !barcode.trim() ||
                        barcode === "SYS-PENDING"
                      }
                      style={{
                        flex: isMobile ? 1 : "initial",
                        padding: isMobile ? "12px 16px" : "0 16px",
                        background: "#2b253b",
                        border: "1px solid #2b253b",
                        borderRadius: 8,
                        color: "#f59e0b",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor:
                          barcode.trim() && barcode !== "SYS-PENDING"
                            ? "pointer"
                            : "not-allowed",
                        opacity:
                          barcode.trim() && barcode !== "SYS-PENDING" ? 1 : 0.5,
                        height: isMobile ? 44 : 40,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {lookupLoading ? (
                        <RefreshCw className="animate-spin" size={14} />
                      ) : (
                        "Check"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={
                        cameraActive ? stopCameraScanner : startCameraScanner
                      }
                      style={{
                        flex: isMobile ? 1 : "initial",
                        padding: isMobile ? "12px 16px" : "0 16px",
                        background: cameraActive ? "#ef4444" : "#2b253b",
                        border: cameraActive
                          ? "1px solid #ef4444"
                          : "1px solid #2b253b",
                        borderRadius: 8,
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        height: isMobile ? 44 : 40,
                      }}
                    >
                      <Barcode size={15} /> {cameraActive ? "Stop" : "Scan"}
                    </button>
                    {cameraActive && (
                      <button
                        type="button"
                        onClick={handleToggleFlash}
                        style={{
                          padding: "0 12px",
                          background: flashOn
                            ? "rgba(245,158,11,0.2)"
                            : "#2b253b",
                          border: flashOn
                            ? "1px solid #f59e0b"
                            : "1px solid #2b253b",
                          borderRadius: 8,
                          color: flashOn ? "#f59e0b" : "#9c97aa",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          height: isMobile ? 44 : 40,
                          cursor: "pointer",
                        }}
                      >
                        <Zap size={15} fill={flashOn ? "#f59e0b" : "none"} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setBarcode(
                          barcode === "SYS-PENDING" ? "" : "SYS-PENDING",
                        )
                      }
                      style={{
                        flex: isMobile ? 1 : "initial",
                        padding: isMobile ? "12px 16px" : "0 16px",
                        background: "#2b253b",
                        border: "1px solid #2b253b",
                        borderRadius: 8,
                        color:
                          barcode === "SYS-PENDING" ? "#ef4444" : "#a78bfa",
                        fontSize: 13,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        height: isMobile ? 44 : 40,
                        whiteSpace: "nowrap",
                        cursor: "pointer",
                      }}
                    >
                      <Plus size={14} />{" "}
                      {barcode === "SYS-PENDING" ? "Cancel" : "Generate"}
                    </button>
                  </div>
                </div>
                {(barcode.trim() || additionalBarcodes.length > 0) && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      marginTop: 6,
                    }}
                  >
                    {barcode.trim() && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          background: "#1c1926",
                          border: "1px solid #7c3aed",
                          padding: "4px 10px",
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                      >
                        <span style={{ color: "#a78bfa", fontWeight: 700 }}>Primary:</span>
                        <code style={{ color: "#f3f1f6", fontFamily: "monospace" }}>{barcode}</code>
                      </div>
                    )}
                    {additionalBarcodes.map((bc, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          background: "#1c1926",
                          border: "1px solid #2b253b",
                          padding: "4px 10px",
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                      >
                        <code style={{ color: "#f59e0b", fontFamily: "monospace" }}>{bc}</code>
                        <button
                          type="button"
                          onClick={() => {
                            setAdditionalBarcodes(prev => prev.filter((_, i) => i !== idx));
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            color: "#ef4444",
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {barcode === "SYS-PENDING" && (
                  <p
                    style={{
                      fontSize: 12,
                      color: "#a78bfa",
                      marginTop: 4,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <CheckCircle size={14} /> System Barcode will be generated &
                    printed automatically when you save.
                  </p>
                )}
                {cameraActive && (
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      aspectRatio: "4/3",
                      maxHeight: 260,
                      borderRadius: 8,
                      overflow: "hidden",
                      border: "1px solid #2b253b",
                      marginTop: 8,
                    }}
                  >
                    <div
                      id="product-scanner-viewfinder"
                      style={{
                        width: "100%",
                        height: "100%",
                        background: "#000",
                      }}
                    ></div>
                  </div>
                )}

                {editingProductId && (
                  <div
                    style={{
                      padding: "12px 16px",
                      background: "rgba(167,139,250,0.05)",
                      border: "1px dashed rgba(167,139,250,0.2)",
                      borderRadius: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      marginTop: 12,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        color: "#f3f1f6",
                        fontWeight: 700,
                      }}
                    >
                      System Barcode Generator
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#9c97aa",
                        lineHeight: 1.4,
                      }}
                    >
                      Create a custom Code-128 barcode label linking this
                      product to a specific unit.
                    </span>
                    <div>
                      <button
                        type="button"
                        onClick={() => {
                          const targetProd = products.find(
                            (p) => p.id === editingProductId,
                          );
                          if (
                            targetProd &&
                            (window as any)._openGenSystemBarcode
                          ) {
                            (window as any)._openGenSystemBarcode(targetProd);
                          }
                        }}
                        style={{
                          padding: "8px 12px",
                          background: "#a78bfa",
                          color: "#181520",
                          borderRadius: 8,
                          border: "none",
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <Barcode size={13} /> Generate Barcode Label
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* MEASUREMENT TYPE */}
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#9c97aa",
                    textTransform: "uppercase",
                  }}
                >
                  Measurement Type
                </label>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile
                      ? "repeat(3, 1fr)"
                      : "repeat(6, 1fr)",
                    gap: 8,
                  }}
                >
                  {MEASUREMENT_TYPES_LIST.map((mt) => (
                    <button
                      key={mt.value}
                      type="button"
                      onClick={() =>
                        handleMeasurementTypeChange(
                          mt.value as MeasurementTypeValue,
                        )
                      }
                      style={{
                        padding: isMobile ? "10px 4px" : "12px 6px",
                        borderRadius: 10,
                        background:
                          measurementType === mt.value
                            ? "rgba(245,158,11,0.15)"
                            : "#121017",
                        border:
                          measurementType === mt.value
                            ? "2px solid #f59e0b"
                            : "1px solid #2b253b",
                        color:
                          measurementType === mt.value ? "#f59e0b" : "#9c97aa",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 4,
                        fontSize: isMobile ? 10 : 11,
                        fontWeight: 700,
                        transition: "all 0.15s ease",
                        textAlign: "center",
                        lineHeight: 1.2,
                      }}
                    >
                      <span style={{ fontSize: isMobile ? 20 : 24 }}>
                        {mt.emoji}
                      </span>
                      <span>{mt.label}</span>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 400,
                          color:
                            measurementType === mt.value
                              ? "#f59e0b80"
                              : "#4a4560",
                        }}
                      >
                        {mt.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* SUB UNIT + QUANTITY — shown only when measurement type is selected */}
              {measurementType && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                    gap: 16,
                    background: "rgba(20,184,166,0.05)",
                    padding: 16,
                    borderRadius: 12,
                    border: "1px solid rgba(20,184,166,0.2)",
                  }}
                >
                  {/* Sub Unit */}
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    <label
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#14b8a6",
                        textTransform: "uppercase",
                      }}
                    >
                      Sub Unit
                    </label>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {(SUB_UNIT_OPTIONS[measurementType] || []).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => handleSubUnitChange(opt)}
                          style={{
                            padding: "8px 14px",
                            borderRadius: 6,
                            background:
                              subUnit === opt
                                ? "rgba(20,184,166,0.2)"
                                : "#0b0a0f",
                            border:
                              subUnit === opt
                                ? "1px solid #14b8a6"
                                : "1px solid #2b253b",
                            color: subUnit === opt ? "#14b8a6" : "#9c97aa",
                            cursor: "pointer",
                            fontSize: 13,
                            fontWeight: 700,
                            transition: "all 0.1s ease",
                          }}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                    <span style={{ fontSize: 10, color: "#9c97aa" }}>
                      {subUnit === "KG"
                        ? "Selling by Kilogram"
                        : subUnit === "Gram"
                          ? "Selling by Gram"
                          : subUnit === "Litre"
                            ? "Selling by Litre"
                            : subUnit === "ML"
                              ? "Selling by Millilitre"
                              : subUnit
                                ? `Selling per ${subUnit}`
                                : "Select a sub unit above"}
                    </span>
                  </div>

                  {/* Quantity */}
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    <label
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#14b8a6",
                        textTransform: "uppercase",
                      }}
                    >
                      Quantity {subUnit ? `(${subUnit})` : ""}
                    </label>
                    <input
                      type="number"
                      step={
                        measurementType === "Weight" ||
                        measurementType === "Volume"
                          ? "0.001"
                          : "1"
                      }
                      min={
                        measurementType === "Weight" ||
                        measurementType === "Volume"
                          ? "0.001"
                          : "1"
                      }
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder="1"
                      required
                    />
                    <span style={{ fontSize: 10, color: "#9c97aa" }}>
                      {subUnit === "KG"
                        ? `Price below is for ${quantity || 1} KG`
                        : subUnit === "Gram"
                          ? `Price below is for ${quantity || 1} Grams`
                          : subUnit === "Litre"
                            ? `Price below is for ${quantity || 1} Litre`
                            : subUnit === "ML"
                              ? `Price below is for ${quantity || 1} ML`
                              : subUnit
                                ? `Price below is for ${quantity || 1} × ${subUnit}`
                                : ""}
                    </span>
                  </div>
                </div>
              )}

              {/* PRICE ENTRY */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                  gap: 12,
                }}
              >
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#9c97aa",
                      textTransform: "uppercase",
                    }}
                  >
                    MRP (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={retail}
                    onChange={(e) => setRetail(e.target.value)}
                    placeholder="40.00"
                    required
                  />
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#9c97aa",
                      textTransform: "uppercase",
                    }}
                  >
                    Wholesale Price (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={wholesale}
                    onChange={(e) => setWholesale(e.target.value)}
                    placeholder="38.00"
                    required
                  />
                </div>
              </div>

              {/* VOICE ALIASES */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: isMobile ? "column" : "row",
                    alignItems: isMobile ? "flex-start" : "center",
                    justifyContent: "space-between",
                    gap: isMobile ? 6 : 0,
                    marginBottom: 4,
                  }}
                >
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#9c97aa",
                      textTransform: "uppercase",
                    }}
                  >
                    Voice Aliases (Comma Separated)
                  </label>
                  <button
                    type="button"
                    onClick={() => handleSuggestAliases(name)}
                    disabled={aliasLoading || !name.trim()}
                    style={{
                      background: "rgba(245,158,11,0.15)",
                      border: "1px solid #f59e0b",
                      color: "#f59e0b",
                      borderRadius: 4,
                      padding: isMobile ? "6px 12px" : "2px 8px",
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: name.trim() ? "pointer" : "not-allowed",
                      opacity: name.trim() ? 1 : 0.5,
                      alignSelf: isMobile ? "flex-end" : "auto",
                    }}
                  >
                    {aliasLoading ? "Generating..." : "⚡ Suggest AI Aliases"}
                  </button>
                </div>
                <input
                  type="text"
                  value={aliases}
                  onChange={(e) => setAliases(e.target.value)}
                  placeholder="e.g. చక్కెర, chakkera, Sugar Loose"
                />
              </div>

              {/* SUB-UNIT PRICE OVERRIDES — only for Weight+KG or Volume+Litre */}
              {showSubUnitOverrides && (
                <div
                  style={{
                    background: "#121017",
                    padding: 16,
                    borderRadius: 12,
                    border: "1px solid rgba(245,158,11,0.2)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 14,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#f59e0b",
                        textTransform: "uppercase",
                      }}
                    >
                      {measurementType === "Weight"
                        ? "⚖️ Sub-Weight Prices"
                        : measurementType === "Volume"
                          ? "💧 Sub-Volume Prices"
                          : "📦 Sub-Unit Prices"}
                    </span>
                    <span style={{ fontSize: 10, color: "#9c97aa" }}>
                      Auto-calculated · tap to override
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 14,
                      maxHeight: 300,
                      overflowY: "auto",
                      paddingRight: 4,
                    }}
                  >
                    {activeSubunits.map((su) => (
                      <div
                        key={su.label}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          borderBottom: "1px solid #2b253b",
                          paddingBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: "#f3f1f6",
                          }}
                        >
                          {su.label} Override
                        </span>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 10,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 10,
                                color: "#9c97aa",
                                textTransform: "uppercase",
                                fontWeight: 600,
                              }}
                            >
                              MRP (₹)
                            </span>
                            <input
                              type="number"
                              step="0.01"
                              value={
                                subUnitPrices[su.label]?.retail !== undefined
                                  ? subUnitPrices[su.label].retail
                                  : ""
                              }
                              placeholder={getSubUnitPrice(
                                su.label,
                                su.ratio,
                                "retail",
                              )}
                              onChange={(e) =>
                                setSubUnitPrices((prev) => ({
                                  ...prev,
                                  [su.label]: {
                                    ...(prev[su.label] || {
                                      retail: "",
                                      wholesale: "",
                                    }),
                                    retail: e.target.value,
                                  },
                                }))
                              }
                              style={{ padding: "6px 10px", fontSize: 13 }}
                            />
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 10,
                                color: "#9c97aa",
                                textTransform: "uppercase",
                                fontWeight: 600,
                              }}
                            >
                              Wholesale (₹)
                            </span>
                            <input
                              type="number"
                              step="0.01"
                              value={
                                subUnitPrices[su.label]?.wholesale !== undefined
                                  ? subUnitPrices[su.label].wholesale
                                  : ""
                              }
                              placeholder={getSubUnitPrice(
                                su.label,
                                su.ratio,
                                "wholesale",
                              )}
                              onChange={(e) =>
                                setSubUnitPrices((prev) => ({
                                  ...prev,
                                  [su.label]: {
                                    ...(prev[su.label] || {
                                      retail: "",
                                      wholesale: "",
                                    }),
                                    wholesale: e.target.value,
                                  },
                                }))
                              }
                              style={{ padding: "6px 10px", fontSize: 13 }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="submit"
                style={{
                  padding: 14,
                  background: "#f59e0b",
                  color: "#0b0a0f",
                  borderRadius: 8,
                  fontWeight: 700,
                  marginTop: 4,
                  fontSize: 15,
                }}
              >
                {editingProductId ? "✅ Update Product" : "💾 Save Product"}
              </button>
              {editingProductId && (
                <button
                  type="button"
                  onClick={resetForm}
                  style={{
                    padding: 10,
                    background: "transparent",
                    border: "1px solid #2b253b",
                    color: "#9c97aa",
                    borderRadius: 8,
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  Cancel / New Product
                </button>
              )}
            </form>
          </div>
        </div>
      )}

      {deleteConfirmProduct &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(11, 10, 15, 0.8)",
              backdropFilter: "blur(8px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              padding: 20,
            }}
          >
            <div
              className="pos-card animate-scale-up"
              style={{
                maxWidth: 420,
                width: "100%",
                padding: 28,
                borderRadius: 14,
                background: "#181520",
                border: "1px solid #ef4444",
                boxShadow:
                  "0 20px 25px -5px rgba(0,0,0,0.5), 0 10px 10px -5px rgba(0,0,0,0.4)",
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  color: "#ef4444",
                }}
              >
                <Trash2 size={24} />
                <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>
                  Confirm Delete
                </h3>
              </div>
              <p
                style={{
                  fontSize: 14,
                  color: "#f3f1f6",
                  lineHeight: 1.5,
                  margin: 0,
                }}
              >
                Are you sure you want to delete{" "}
                <strong>{deleteConfirmProduct.display_name}</strong> and all its
                packaging variants? This action cannot be undone.
              </p>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 10,
                  marginTop: 8,
                }}
              >
                <button
                  onClick={() => setDeleteConfirmProduct(null)}
                  style={{
                    padding: "10px 18px",
                    background: "#121017",
                    border: "1px solid #2b253b",
                    borderRadius: 8,
                    color: "#9c97aa",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteAction}
                  style={{
                    padding: "10px 18px",
                    background: "#ef4444",
                    border: "none",
                    borderRadius: 8,
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {showRegistryConflictModal &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              background: "rgba(0, 0, 0, 0.75)",
              backdropFilter: "blur(4px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              padding: 20,
            }}
          >
            <div
              className="pos-card animate-scale-up"
              style={{
                maxWidth: 480,
                width: "100%",
                padding: 28,
                borderRadius: 14,
                background: "#181520",
                border: "1px solid #7c3aed",
                boxShadow:
                  "0 20px 25px -5px rgba(0,0,0,0.5), 0 10px 10px -5px rgba(0,0,0,0.4)",
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  color: "#a78bfa",
                }}
              >
                <Barcode size={24} />
                <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>
                  Barcode Conflict Detected
                </h3>
              </div>
              <p
                style={{
                  fontSize: 14,
                  color: "#f3f1f6",
                  lineHeight: 1.5,
                  margin: 0,
                }}
              >
                The barcode <strong style={{ color: "#a78bfa" }}>{conflictBarcode}</strong> is already assigned to the following product(s):
              </p>

              <div
                style={{
                  maxHeight: 240,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  margin: "8px 0",
                  paddingRight: 4,
                }}
              >
                {conflictProducts.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      background: "#121017",
                      border: "1px solid #2b253b",
                      borderRadius: 8,
                      padding: 12,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 14,
                          color: "#fff",
                          marginBottom: 4,
                        }}
                      >
                        {p.display_name}
                      </div>
                      <div style={{ fontSize: 12, color: "#9c97aa" }}>
                        Retail: ₹{p.retail_price} | Wholesale: ₹{p.wholesale_price}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        handleEditClick(p);
                        setShowRegistryConflictModal(false);
                      }}
                      style={{
                        padding: "6px 12px",
                        background: "#7c3aed",
                        border: "none",
                        borderRadius: 6,
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Edit Details
                    </button>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  marginTop: 8,
                }}
              >
                <button
                  onClick={() => {
                    resetForm();
                    setBarcode(conflictBarcode);
                    setActiveTab("create");
                    setShowRegistryConflictModal(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "12px",
                    background: "#059669",
                    border: "none",
                    borderRadius: 8,
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    textAlign: "center",
                  }}
                >
                  ➕ Create New Product for this Barcode
                </button>
                <button
                  onClick={() => setShowRegistryConflictModal(false)}
                  style={{
                    width: "100%",
                    padding: "10px",
                    background: "#121017",
                    border: "1px solid #2b253b",
                    borderRadius: 8,
                    color: "#9c97aa",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    textAlign: "center",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {showAddExtraBarcodeModal &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              background: "rgba(0, 0, 0, 0.75)",
              backdropFilter: "blur(4px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              padding: 20,
            }}
          >
            <div
              className="pos-card animate-scale-up"
              style={{
                maxWidth: 400,
                width: "100%",
                padding: 28,
                borderRadius: 14,
                background: "#181520",
                border: "1px solid #7c3aed",
                boxShadow:
                  "0 20px 25px -5px rgba(0,0,0,0.5), 0 10px 10px -5px rgba(0,0,0,0.4)",
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  color: "#a78bfa",
                }}
              >
                <Barcode size={24} />
                <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>
                  Add Extra Barcode
                </h3>
              </div>

              <p
                style={{
                  fontSize: 13,
                  color: "#9c97aa",
                  lineHeight: 1.4,
                  margin: 0,
                }}
              >
                Associate an additional barcode with this product. Scanning this barcode at the terminal will also match this product.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#9c97aa",
                    textTransform: "uppercase",
                  }}
                >
                  Barcode Number
                </label>
                <input
                  type="text"
                  value={extraBarcodeValue}
                  onChange={(e) => setExtraBarcodeValue(e.target.value)}
                  placeholder="e.g. 8901058001234"
                  autoFocus
                  style={{ width: "100%" }}
                />
              </div>

              {extraBarcodeScannerActive && (
                <div
                  id="extra-barcode-scanner-viewfinder"
                  style={{
                    width: "100%",
                    aspectRatio: "4/3",
                    background: "#000",
                    borderRadius: 8,
                    overflow: "hidden",
                    border: "1px solid #2b253b",
                  }}
                ></div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={
                    extraBarcodeScannerActive
                      ? stopExtraBarcodeScanner
                      : startExtraBarcodeScanner
                  }
                  style={{
                    flex: 1,
                    padding: "10px",
                    background: extraBarcodeScannerActive ? "#ef4444" : "#2b253b",
                    border: "none",
                    borderRadius: 8,
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <Barcode size={14} />
                  {extraBarcodeScannerActive ? "Stop Scanner" : "Scan Barcode"}
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 10,
                  marginTop: 8,
                  borderTop: "1px solid #2b253b",
                  paddingTop: 16,
                }}
              >
                <button
                  type="button"
                  onClick={async () => {
                    if (extraBarcodeScannerActive) {
                      await stopExtraBarcodeScanner();
                    }
                    setShowAddExtraBarcodeModal(false);
                  }}
                  style={{
                    padding: "10px 18px",
                    background: "#121017",
                    border: "1px solid #2b253b",
                    borderRadius: 8,
                    color: "#9c97aa",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const clean = extraBarcodeValue.trim();
                    if (!clean) return;
                    if (clean === barcode.trim()) {
                      alert("This barcode is already the primary barcode.");
                      return;
                    }
                    if (additionalBarcodes.includes(clean)) {
                      alert("This barcode is already in the list.");
                      return;
                    }
                    setAdditionalBarcodes((prev) => [...prev, clean]);
                    if (extraBarcodeScannerActive) {
                      await stopExtraBarcodeScanner();
                    }
                    setShowAddExtraBarcodeModal(false);
                  }}
                  style={{
                    padding: "10px 18px",
                    background: "#7c3aed",
                    border: "none",
                    borderRadius: 8,
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// ----------------------------------------------------
// SCREEN 7: BARCODE ASSOCIATION (BARCODE MANAGER)
// ----------------------------------------------------
function BarcodeAssociation({
  products,
  onBack,
}: {
  products: Product[];
  onBack: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const isMobile = useIsMobile();

  // Scanner States
  const [cameraActive, setCameraActive] = useState(false);
  const [activeScanType, setActiveScanType] = useState<"add" | "edit" | null>(
    null,
  );
  const [scanTargetProductId, setScanTargetProductId] = useState<number | null>(
    null,
  );
  const [scanOldBarcode, setScanOldBarcode] = useState<string | null>(null);
  const [flashOn, setFlashOn] = useState(false);

  const handleToggleFlash = async () => {
    const nextState = !flashOn;
    const success = await setTorch(nextState);
    if (success) {
      setFlashOn(nextState);
    } else {
      setError("Flash/Torch is not supported on this camera/device.");
    }
  };

  // Manual input fallback states
  const [manualInputActive, setManualInputActive] = useState(false);
  const [manualBarcodeText, setManualBarcodeText] = useState("");

  // Conflict / Warning Modals
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [reassignData, setReassignData] = useState<{
    barcode: string;
    targetProductId: number;
    sourceProductName: string;
  } | null>(null);

  const [showApiSuggestModal, setShowApiSuggestModal] = useState(false);
  const [apiSuggestData, setApiSuggestData] = useState<{
    barcode: string;
    product_name: string;
    brand: string;
    quantity: string;
  } | null>(null);

  useEffect(() => {
    return () => {
      stopBarcodeScanner();
    };
  }, []);

  const startCameraScanner = async (
    type: "add" | "edit",
    productId: number,
    oldBarcode?: string,
  ) => {
    setSuccess("");
    setError("");
    setActiveScanType(type);
    setScanTargetProductId(productId);
    if (oldBarcode) setScanOldBarcode(oldBarcode);
    setCameraActive(true);
    setFlashOn(false);
    await startBarcodeScanner(
      "manager-scanner-viewfinder",
      async (decodedText: string) => {
        setCameraActive(false);
        await handleBarcodeResolved(decodedText.trim());
      },
      (err: string) => {
        setError(err);
        setCameraActive(false);
      },
    );
  };

  const stopCameraScanner = async () => {
    await stopBarcodeScanner();
    setCameraActive(false);
    setActiveScanType(null);
    setScanTargetProductId(null);
    setScanOldBarcode(null);
    setFlashOn(false);
  };

  const handleBarcodeResolved = async (code: string) => {
    // Check barcode conflict reassignments
    const conflict = products.find(
      (p) => p.barcodes?.includes(code) || p.barcode === code,
    );
    if (conflict) {
      if (conflict.id === scanTargetProductId) {
        setError(`Barcode "${code}" is already associated with this product.`);
        return;
      }
      setReassignData({
        barcode: code,
        targetProductId: scanTargetProductId!,
        sourceProductName: conflict.display_name,
      });
      setShowReassignModal(true);
      return;
    }

    // Call Mock API to see if catalog has it
    try {
      const apiResult = await db.apiBarcodeLookup(code);
      if (apiResult) {
        setApiSuggestData(apiResult);
        setShowApiSuggestModal(true);
      } else {
        await executeBarcodeAssignment(code);
      }
    } catch (err) {
      await executeBarcodeAssignment(code);
    }
  };

  const executeBarcodeAssignment = async (code: string) => {
    try {
      if (activeScanType === "edit" && scanOldBarcode) {
        await db.deleteBarcode(scanOldBarcode);
      }
      await db.addBarcode(scanTargetProductId!, code);
      setSuccess(`Barcode "${code}" successfully associated.`);
      useStore.getState().loadStoreData();
      useStore.getState().triggerSync();
      setShowApiSuggestModal(false);
      setApiSuggestData(null);
    } catch (err: any) {
      setError(err.message || "Failed to save barcode.");
    }
  };

  const handleConfirmReassign = async () => {
    if (!reassignData) return;
    try {
      if (activeScanType === "edit" && scanOldBarcode) {
        await db.deleteBarcode(scanOldBarcode, scanTargetProductId!);
      }
      await db.reassignBarcode(
        reassignData.barcode,
        reassignData.targetProductId,
      );
      setSuccess(
        `Barcode "${reassignData.barcode}" reassigned from "${reassignData.sourceProductName}" to this product.`,
      );
      setShowReassignModal(false);
      setReassignData(null);
      useStore.getState().loadStoreData();
      useStore.getState().triggerSync();
    } catch (err: any) {
      setError(err.message || "Failed to reassign barcode.");
    }
  };

  const handleAssignToBoth = async () => {
    if (!reassignData) return;
    try {
      if (activeScanType === "edit" && scanOldBarcode) {
        await db.deleteBarcode(scanOldBarcode, scanTargetProductId!);
      }
      await db.addBarcode(reassignData.targetProductId, reassignData.barcode);
      setSuccess(
        `Barcode "${reassignData.barcode}" assigned to this product and kept on "${reassignData.sourceProductName}".`,
      );
      setShowReassignModal(false);
      setReassignData(null);
      useStore.getState().loadStoreData();
      useStore.getState().triggerSync();
    } catch (err: any) {
      setError(err.message || "Failed to assign barcode to both products.");
    }
  };

  const handleAcceptApiSuggest = async () => {
    if (!apiSuggestData) return;
    await executeBarcodeAssignment(apiSuggestData.barcode);
  };

  const handleImportAndRename = async () => {
    if (!apiSuggestData || !scanTargetProductId) return;
    try {
      const targetProduct = products.find((p) => p.id === scanTargetProductId);
      if (targetProduct) {
        targetProduct.display_name = `${apiSuggestData.brand} ${apiSuggestData.product_name} ${apiSuggestData.quantity}`;
        await db.saveProduct(targetProduct);
      }
      await executeBarcodeAssignment(apiSuggestData.barcode);
    } catch (err: any) {
      setError(err.message || "Failed to update product name and assign.");
    }
  };

  const handleDeleteBarcode = async (code: string, productId: number) => {
    if (
      window.confirm(
        `Are you sure you want to delete barcode "${code}" for this product? The product itself remains in catalog.`,
      )
    ) {
      await db.deleteBarcode(code, productId);
      setSuccess(`Barcode "${code}" deleted for this product.`);
      useStore.getState().loadStoreData();
      useStore.getState().triggerSync();
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualBarcodeText.trim() || !scanTargetProductId) return;
    const code = manualBarcodeText.trim();
    setManualInputActive(false);
    setManualBarcodeText("");
    handleBarcodeResolved(code);
  };

  // Filter products by display name or search query
  const filteredProducts = products.filter(
    (p) =>
      p.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.barcodes?.some((b) => b.includes(searchQuery)),
  );

  return (
    <div
      style={{ maxWidth: 800, margin: "0 auto" }}
      className="animate-slide-up"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <button
          onClick={onBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "#121017",
            border: "1px solid #2b253b",
            padding: "8px 12px",
            borderRadius: 8,
            color: "#9c97aa",
          }}
        >
          <ArrowLeft size={16} /> Back
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>Barcode Manager</h1>
      </div>

      {success && (
        <div
          style={{
            fontSize: 14,
            color: "#14b8a6",
            background: "rgba(20,184,166,0.1)",
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          {success}
        </div>
      )}
      {error && (
        <div
          style={{
            fontSize: 14,
            color: "#ef4444",
            background: "rgba(239,68,68,0.1)",
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {/* Global camera viewfinder overlay when active */}
      {cameraActive &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.85)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 110,
              padding: 20,
            }}
          >
            <div
              className="pos-card animate-scale-up"
              style={{
                width: "100%",
                maxWidth: 400,
                background: "#121017",
                border: "1px solid #2b253b",
                padding: 24,
                borderRadius: 12,
                textAlign: "center",
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
                {activeScanType === "edit"
                  ? "Scan Replacement Barcode"
                  : "Scan New Barcode"}
              </h3>
              <div
                id="manager-scanner-viewfinder"
                style={{
                  width: "100%",
                  aspectRatio: "4/3",
                  maxHeight: 280,
                  background: "#000",
                  borderRadius: 8,
                  overflow: "hidden",
                  border: "1px solid #2b253b",
                  marginBottom: 16,
                }}
              ></div>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  onClick={() => {
                    setManualInputActive(true);
                    stopCameraScanner();
                  }}
                  style={{
                    flex: 1,
                    padding: 10,
                    background: "#2b253b",
                    color: "#fff",
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                >
                  Type Code
                </button>
                <button
                  type="button"
                  onClick={handleToggleFlash}
                  style={{
                    padding: "10px 12px",
                    background: flashOn ? "rgba(245,158,11,0.2)" : "#2b253b",
                    border: flashOn ? "1px solid #f59e0b" : "1px solid #2b253b",
                    borderRadius: 8,
                    color: flashOn ? "#f59e0b" : "#a78bfa",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Zap size={15} fill={flashOn ? "#f59e0b" : "none"} />
                </button>
                <button
                  onClick={stopCameraScanner}
                  style={{
                    flex: 1,
                    padding: 10,
                    background: "#ef4444",
                    color: "#fff",
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Manual Input Fallback modal */}
      {manualInputActive &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 111,
              padding: 20,
            }}
          >
            <div
              className="pos-card animate-scale-up"
              style={{
                width: "100%",
                maxWidth: 360,
                background: "#121017",
                border: "1px solid #2b253b",
                padding: 24,
                borderRadius: 12,
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
                Type Barcode Manually
              </h3>
              <form
                onSubmit={handleManualSubmit}
                style={{ display: "flex", flexDirection: "column", gap: 14 }}
              >
                <input
                  type="text"
                  value={manualBarcodeText}
                  onChange={(e) => setManualBarcodeText(e.target.value)}
                  placeholder="e.g. 8901058001234"
                  required
                  autoFocus
                />
                <div style={{ display: "flex", gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setManualInputActive(false)}
                    style={{
                      flex: 1,
                      padding: 10,
                      background: "#2b253b",
                      color: "#fff",
                      borderRadius: 8,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{
                      flex: 1,
                      padding: 10,
                      background: "#f59e0b",
                      color: "#0b0a0f",
                      borderRadius: 8,
                      fontWeight: 700,
                    }}
                  >
                    Confirm
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}

      {/* Search Input bar */}
      <div style={{ position: "relative", marginBottom: 20 }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search products by name or barcode..."
          style={{ width: "100%", paddingLeft: 44 }}
        />
        <Search
          size={18}
          style={{ position: "absolute", left: 16, top: 13, color: "#9c97aa" }}
        />
      </div>

      {/* Catalog items list containing barcodes */}
      {isMobile ? (
        <div className="mobile-card-list animate-fade-in">
          {filteredProducts.map((prod) => (
            <div key={prod.id} className="mobile-card">
              <div>
                <span
                  style={{ fontWeight: 700, display: "block", fontSize: 15 }}
                >
                  {prod.display_name}
                </span>
                <span style={{ color: "#9c97aa", fontSize: 11 }}>
                  MRP: ₹{prod.retail_price} | Wholesale: ₹{prod.wholesale_price}
                </span>
              </div>

              <div
                style={{
                  borderTop: "1px solid #2b253b",
                  paddingTop: 8,
                  marginTop: 4,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    color: "#9c97aa",
                    fontWeight: 700,
                    textTransform: "uppercase",
                  }}
                >
                  Barcodes
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {prod.barcodes && prod.barcodes.length > 0 ? (
                    prod.barcodes.map((b) => (
                      <div
                        key={b}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          background: "#1c1926",
                          border: "1px solid #2b253b",
                          padding: "4px 8px",
                          borderRadius: 6,
                        }}
                      >
                        <code
                          style={{
                            fontSize: 12,
                            fontFamily: "monospace",
                            color: "#f59e0b",
                          }}
                        >
                          {b}
                        </code>
                        <button
                          onClick={() => startCameraScanner("edit", prod.id, b)}
                          style={{
                            fontSize: 10,
                            color: "#9c97aa",
                            background: "transparent",
                            padding: 0,
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteBarcode(b, prod.id)}
                          style={{
                            fontSize: 10,
                            color: "#ef4444",
                            background: "transparent",
                            padding: 0,
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ))
                  ) : (
                    <span
                      style={{
                        color: "#9c97aa",
                        fontSize: 12,
                        fontStyle: "italic",
                      }}
                    >
                      No Barcodes Associated
                    </span>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  borderTop: "1px solid #2b253b",
                  paddingTop: 8,
                  marginTop: 4,
                }}
              >
                <button
                  onClick={() => startCameraScanner("add", prod.id)}
                  style={{
                    padding: "6px 12px",
                    background: "#f59e0b",
                    color: "#0b0a0f",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Plus size={12} /> Add Barcode
                </button>
                <button
                  onClick={() => {
                    if ((window as any)._openGenSystemBarcode) {
                      (window as any)._openGenSystemBarcode(prod);
                    }
                  }}
                  style={{
                    padding: "6px 12px",
                    background: "#a78bfa",
                    color: "#181520",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    marginLeft: 8,
                  }}
                >
                  <Plus size={12} /> Gen Barcode
                </button>
              </div>
            </div>
          ))}
          {filteredProducts.length === 0 && (
            <div
              style={{
                padding: 24,
                textTransform: "uppercase",
                fontSize: 12,
                color: "#9c97aa",
                textAlign: "center",
                letterSpacing: 1,
              }}
            >
              No products found matching query.
            </div>
          )}
        </div>
      ) : (
        <div
          className="pos-card animate-fade-in"
          style={{ padding: 0, overflow: "hidden" }}
        >
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 600 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 2fr 1fr",
                  background: "#121017",
                  padding: "14px 20px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#9c97aa",
                  borderBottom: "1px solid #2b253b",
                }}
              >
                <span>Product Name</span>
                <span>Associated Barcode(s)</span>
                <span style={{ textAlign: "right" }}>Actions</span>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  maxHeight: 500,
                  overflowY: "auto",
                }}
              >
                {filteredProducts.map((prod) => (
                  <div
                    key={prod.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 2fr 1fr",
                      padding: "16px 20px",
                      borderBottom: "1px solid #2b253b",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontWeight: 700,
                          display: "block",
                          fontSize: 14,
                        }}
                      >
                        {prod.display_name}
                      </span>
                      <span style={{ color: "#9c97aa", fontSize: 11 }}>
                        MRP: ₹{prod.retail_price} | Wholesale: ₹
                        {prod.wholesale_price}
                      </span>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      {prod.barcodes && prod.barcodes.length > 0 ? (
                        prod.barcodes.map((b) => (
                          <div
                            key={b}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              background: "#1c1926",
                              border: "1px solid #2b253b",
                              padding: "4px 8px",
                              borderRadius: 6,
                              width: "fit-content",
                            }}
                          >
                            <code
                              style={{
                                fontSize: 12,
                                fontFamily: "monospace",
                                color: "#f59e0b",
                              }}
                            >
                              {b}
                            </code>
                            <button
                              onClick={() =>
                                startCameraScanner("edit", prod.id, b)
                              }
                              style={{
                                fontSize: 10,
                                color: "#9c97aa",
                                background: "transparent",
                                padding: 0,
                              }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteBarcode(b, prod.id)}
                              style={{
                                fontSize: 10,
                                color: "#ef4444",
                                background: "transparent",
                                padding: 0,
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ))
                      ) : (
                        <span
                          style={{
                            color: "#9c97aa",
                            fontSize: 12,
                            fontStyle: "italic",
                          }}
                        >
                          No Barcodes Associated
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        textAlign: "right",
                        display: "flex",
                        gap: 8,
                        justifyContent: "flex-end",
                      }}
                    >
                      <button
                        onClick={() => startCameraScanner("add", prod.id)}
                        style={{
                          padding: "6px 12px",
                          background: "#f59e0b",
                          color: "#0b0a0f",
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 700,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <Plus size={12} /> Add Barcode
                      </button>
                      <button
                        onClick={() => {
                          if ((window as any)._openGenSystemBarcode) {
                            (window as any)._openGenSystemBarcode(prod);
                          }
                        }}
                        style={{
                          padding: "6px 12px",
                          background: "#a78bfa",
                          color: "#181520",
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 700,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <Plus size={12} /> Gen Barcode
                      </button>
                    </div>
                  </div>
                ))}
                {filteredProducts.length === 0 && (
                  <div
                    style={{
                      padding: 24,
                      textTransform: "uppercase",
                      fontSize: 12,
                      color: "#9c97aa",
                      textAlign: "center",
                      letterSpacing: 1,
                    }}
                  >
                    No products found matching query.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* REASSIGN BARCODE CONFIRMATION MODAL */}
      {showReassignModal &&
        reassignData &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.85)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 120,
              padding: 20,
            }}
          >
            <div
              className="pos-card animate-scale-up"
              style={{
                width: "100%",
                maxWidth: 380,
                background: "#121017",
                border: "1px solid #2b253b",
                padding: 24,
                borderRadius: 12,
              }}
            >
              <h3
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: "#ef4444",
                  marginBottom: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <AlertTriangle size={20} /> Barcode Conflict
              </h3>
              <p
                style={{
                  fontSize: 13,
                  color: "#9c97aa",
                  lineHeight: 1.4,
                  marginBottom: 20,
                }}
              >
                Barcode{" "}
                <code
                  style={{
                    color: "#f59e0b",
                    background: "#1c1926",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  {reassignData.barcode}
                </code>{" "}
                is currently assigned to{" "}
                <strong>{reassignData.sourceProductName}</strong>.
                <br />
                <br />
                Do you want to reassign/move it to this product?
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button
                  onClick={handleAssignToBoth}
                  style={{
                    width: "100%",
                    padding: 12,
                    borderRadius: 8,
                    background: "#059669",
                    color: "#fff",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Keep on Both Products
                </button>
                <button
                  onClick={handleConfirmReassign}
                  style={{
                    width: "100%",
                    padding: 12,
                    borderRadius: 8,
                    background: "#ef4444",
                    color: "#fff",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Move to This Product (Replace)
                </button>
                <button
                  onClick={() => {
                    setShowReassignModal(false);
                    setReassignData(null);
                  }}
                  style={{
                    width: "100%",
                    padding: 10,
                    borderRadius: 8,
                    background: "#2b253b",
                    color: "#fff",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* API SUGGESTION MODAL */}
      {showApiSuggestModal &&
        apiSuggestData &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.85)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 120,
              padding: 20,
            }}
          >
            <div
              className="pos-card animate-scale-up"
              style={{
                width: "100%",
                maxWidth: 400,
                background: "#121017",
                border: "1px solid #2b253b",
                padding: 24,
                borderRadius: 12,
              }}
            >
              <h3
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: "#f59e0b",
                  marginBottom: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Barcode size={20} /> Barcode Details Found
              </h3>
              <p
                style={{
                  fontSize: 13,
                  color: "#9c97aa",
                  lineHeight: 1.4,
                  marginBottom: 16,
                }}
              >
                The scanned barcode matches a product in our API registry:
                <br />
                <br />
                <strong>Name:</strong> {apiSuggestData.product_name}
                <br />
                <strong>Brand:</strong> {apiSuggestData.brand}
                <br />
                <strong>Quantity:</strong> {apiSuggestData.quantity}
                <br />
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  onClick={handleImportAndRename}
                  style={{
                    padding: 12,
                    background: "#f59e0b",
                    color: "#0b0a0f",
                    borderRadius: 8,
                    fontWeight: 700,
                  }}
                >
                  Accept & Rename Product
                </button>
                <button
                  onClick={handleAcceptApiSuggest}
                  style={{
                    padding: 12,
                    background: "#2b253b",
                    color: "#fff",
                    borderRadius: 8,
                    fontWeight: 700,
                  }}
                >
                  Link Barcode Only
                </button>
                <button
                  onClick={() => {
                    setShowApiSuggestModal(false);
                    setApiSuggestData(null);
                  }}
                  style={{
                    padding: 12,
                    background: "transparent",
                    color: "#9c97aa",
                    border: "none",
                  }}
                >
                  Ignore / Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// ----------------------------------------------------
// SCREEN 8: SALES HISTORY
// ----------------------------------------------------
function HistoryScreen({
  onBack,
  handlePickContact,
}: {
  onBack: () => void;
  handlePickContact: (onSelect: (name: string, phone: string) => void) => void;
}) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const isMobile = useIsMobile();
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const day = String(new Date().getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedDate]);

  // Edit States
  const [isEditing, setIsEditing] = useState(false);
  const [editCustomerName, setEditCustomerName] = useState("");
  const [editCustomerPhone, setEditCustomerPhone] = useState("");
  const [editCustomerId, setEditCustomerId] = useState<number | undefined>(
    undefined,
  );
  const [editItems, setEditItems] = useState<BillItem[]>([]);
  const [editDiscount, setEditDiscount] = useState(0);
  const [editPaymentMode, setEditPaymentMode] = useState<
    "Cash" | "UPI" | "Credit"
  >("Cash");
  const [custSuggestions, setCustSuggestions] = useState<Customer[]>([]);
  const [prodQuery, setProdQuery] = useState("");
  const [showLinkCustomerModal, setShowLinkCustomerModal] = useState(false);
  const [linkBill, setLinkBill] = useState<Bill | null>(null);
  const [linkCustomerQuery, setLinkCustomerQuery] = useState("");
  const [linkCustSuggestions, setLinkCustSuggestions] = useState<Customer[]>(
    [],
  );
  const [selectedLinkCustomer, setSelectedLinkCustomer] =
    useState<Customer | null>(null);
  const [createLinkCustName, setCreateLinkCustName] = useState("");
  const [createLinkCustPhone, setCreateLinkCustPhone] = useState("");
  const [cancelConfirmBill, setCancelConfirmBill] = useState<Bill | null>(null);
  const [undoConfirmBill, setUndoConfirmBill] = useState<Bill | null>(null);
  const [deleteConfirmBill, setDeleteConfirmBill] = useState<Bill | null>(null);

  const products = useStore((state) => state.products);
  const customers = useStore((state) => state.customers);
  const manualSync = useStore((state) => state.manualSync);
  const isSyncing = useStore((state) => state.isSyncing);

  useEffect(() => {
    db.getBills().then(setBills);
    db.getCategories().then(setCategories);
  }, []);

  useEffect(() => {
    const preselected = localStorage.getItem("preselected_bill_number");
    if (preselected && bills.length > 0) {
      const match = bills.find(
        (b) => b.bill_number === parseInt(preselected, 10),
      );
      if (match) {
        setSelectedBill(match);
        setIsEditing(false);
      }
      localStorage.removeItem("preselected_bill_number");
    }
  }, [bills]);

  const handleReprint = async (b: Bill) => {
    const config = useStore.getState().printerConfig;
    const status = useStore.getState().printerStatus;

    try {
      const {
        isThisDeviceHost,
        getMyDeviceId,
        claimPrinterHost,
        printDirectAsHost,
        getPrinterHostAvailability,
        submitPrintJob,
        waitForPrintJobResult,
      } = await import("./utils/printerHostManager");
      const { bluetoothPrinter } = await import("./utils/printerService");

      // Auto-connect if this device is connected to the printer in configuration and not currently Connected
      if (config.printer_mac && status !== "Connected") {
        try {
          await useStore
            .getState()
            .connectPrinter(config.printer_mac, config.printer_name);
        } catch (e) {
          console.error("Failed auto-connect inside handleReprint:", e);
        }
      }

      if (!isThisDeviceHost() && bluetoothPrinter.isConnected()) {
        await claimPrinterHost(getMyDeviceId(), config.printer_mac);
      }

      if (isThisDeviceHost()) {
        // Direct print path (Host)
        const printStatus = await printDirectAsHost(b, config);
        if (printStatus === "PRINT_SUCCESS") {
          alert(
            `Reprint request for Bill #${b.bill_number} sent to ATPOS H58BT printer.`,
          );
        } else {
          alert(
            "Failed to send print command. Please check if the printer is connected.",
          );
        }
      } else {
        // Shared print path (Non-Host client)
        const hostAvailability = await getPrinterHostAvailability(350);
        if (!hostAvailability.isAvailable) {
          alert(
            "No printer host is online. Connect the main terminal device to the printer first.",
          );
          return;
        }

        // Submit the print job to the queue
        const job = await submitPrintJob(b);
        if (!job.id) {
          throw new Error("Failed to generate print job ID.");
        }

        // Poll for results
        const printStatus = await waitForPrintJobResult(job.id, 10000);
        if (printStatus === "PRINT_SUCCESS") {
          alert(
            `Reprint request for Bill #${b.bill_number} completed via printer host.`,
          );
        } else {
          alert("Reprint failed. The printer host returned a print failure.");
        }
      }
    } catch (e: any) {
      alert(e.message || "Reprint failed.");
    }
  };

  const handleShareHistoryBillWhatsApp = async () => {
    if (!selectedBill) return;

    const storeName = useStore.getState().storeName;
    const pdfBlob = generateBillPDF(selectedBill, storeName);

    const itemsList = selectedBill.items
      .map(
        (itm, idx) =>
          `${idx + 1}. ${itm.product_name} x ${itm.quantity} ${itm.unit} @ Rs.${itm.price.toFixed(0)} = Rs.${itm.total.toFixed(0)}`,
      )
      .join("\n");

    const summary = `🧾 *${storeName.toUpperCase()} - BILL RECEIPT*
----------------------------------------
*Bill No:* #${selectedBill.bill_number}
*Date:* ${new Date(selectedBill.created_at).toLocaleDateString()}
*Customer:* ${selectedBill.customer_name || "Guest"} (${selectedBill.customer_phone || "NA"})
*Payment Mode:* ${selectedBill.payment_mode}

*Items:*
${itemsList}

----------------------------------------
*Subtotal:* Rs. ${selectedBill.subtotal.toFixed(2)}
*Discount:* Rs. ${selectedBill.discount.toFixed(2)}
*Grand Total:* Rs. ${selectedBill.grand_total.toFixed(2)}

Thank you for shopping with us! 🙏`;

    await shareViaWhatsApp(
      selectedBill.customer_phone || "NA",
      summary,
      pdfBlob,
      `Bill_${selectedBill.bill_number}.pdf`,
    );
  };

  const handleCancelBill = (b: Bill) => {
    // Show custom in-app confirmation (window.confirm is blocked in PWA/mobile)
    setCancelConfirmBill(b);
  };

  const handleConfirmCancelBill = async () => {
    if (!cancelConfirmBill) return;
    await useStore.getState().cancelBill(cancelConfirmBill.id);
    const updated = await db.getBills();
    setBills(updated);
    setSelectedBill(null);
    setCancelConfirmBill(null);
  };

  const handleUndoBill = (b: Bill) => setUndoConfirmBill(b);

  const handleConfirmUndoBill = async () => {
    if (!undoConfirmBill) return;
    await db.undoBill(undoConfirmBill.id);
    const updated = await db.getBills();
    setBills(updated);
    const refreshed = updated.find((b) => b.id === undoConfirmBill.id) || null;
    setSelectedBill(refreshed);
    setUndoConfirmBill(null);
  };

  const handleDeleteBillPermanently = (b: Bill) => setDeleteConfirmBill(b);

  const handleConfirmDeleteBill = async () => {
    if (!deleteConfirmBill) return;
    await db.deleteBillPermanently(deleteConfirmBill.id);
    const updated = await db.getBills();
    setBills(updated);
    setSelectedBill(null);
    setDeleteConfirmBill(null);
  };

  const handleConvertToCredit = async (b: Bill) => {
    const activeCustomer = b.customer_id
      ? customers.find((c) => c.id === b.customer_id)
      : null;

    if (
      activeCustomer &&
      b.customer_phone !== "NA" &&
      b.customer_name !== "Customer"
    ) {
      const confirm = window.confirm(
        `Convert Bill #${b.bill_number} to Khata Credit for customer "${activeCustomer.name}"?`,
      );
      if (!confirm) return;

      await performCreditConversion(b, activeCustomer);
    } else {
      setLinkBill(b);
      setLinkCustomerQuery("");
      setLinkCustSuggestions([]);
      setSelectedLinkCustomer(null);
      setCreateLinkCustName("");
      setCreateLinkCustPhone("");
      setShowLinkCustomerModal(true);
    }
  };

  const performCreditConversion = async (b: Bill, c: Customer) => {
    const updatedBill: Bill = {
      ...b,
      customer_id: c.id,
      customer_name: c.name,
      customer_phone: c.phone || "NA",
      payment_mode: "Credit",
    };

    try {
      await useStore.getState().updateBill(updatedBill);

      await db.addKhataTransaction(
        c.id,
        updatedBill.grand_total,
        "Credit",
        `Credit Conversion - Bill #${updatedBill.bill_number}`,
        undefined,
        updatedBill.created_at,
      );

      const allBills = await db.getBills();
      setBills(allBills);
      setSelectedBill(updatedBill);
      setShowLinkCustomerModal(false);

      await useStore.getState().loadStoreData();
      useStore.getState().triggerSync();
      alert(
        `Successfully converted Bill #${b.bill_number} to Credit for "${c.name}".`,
      );
    } catch (err: any) {
      alert(`Failed to convert bill: ${err.message || err}`);
    }
  };

  const handleStartEdit = () => {
    if (!selectedBill) return;
    setEditCustomerName(selectedBill.customer_name || "");
    setEditCustomerPhone(selectedBill.customer_phone || "");
    setEditCustomerId(selectedBill.customer_id);
    setEditItems([...selectedBill.items]);
    setEditDiscount(selectedBill.discount || 0);
    setEditPaymentMode(selectedBill.payment_mode || "Cash");
    setProdQuery("");
    setCustSuggestions([]);
    setIsEditing(true);
  };

  const handleSaveChanges = async () => {
    if (!selectedBill) return;

    // Check credit validation
    if (editPaymentMode === "Credit") {
      if (
        !editCustomerName.trim() ||
        editCustomerName === "Customer" ||
        editCustomerPhone === "NA" ||
        !editCustomerPhone.trim()
      ) {
        alert(
          "Customer details (name and phone) are required for Credit (Khata) billing.",
        );
        return;
      }
    }

    if (editCustomerPhone.trim() && editCustomerPhone.trim() !== "NA") {
      const existing = customers.find(
        (c) => c.phone === editCustomerPhone.trim() && c.id !== editCustomerId,
      );
      if (existing) {
        const confirmSave = window.confirm(
          `A customer named "${existing.name}" is already registered with this phone number. Do you want to continue with the same number?`,
        );
        if (!confirmSave) return; // go back
      }
    }

    const sub = editItems.reduce((sum, itm) => sum + itm.total, 0);
    const grand = Math.max(0, sub - editDiscount);

    const updated: Bill = {
      ...selectedBill,
      customer_name: editCustomerName.trim() || "Customer",
      customer_phone: editCustomerPhone.trim() || "NA",
      customer_id: editCustomerId,
      items: editItems,
      subtotal: sub,
      discount: editDiscount,
      grand_total: grand,
      payment_mode: editPaymentMode,
    };

    try {
      await useStore.getState().updateBill(updated);
      const allBills = await db.getBills();
      setBills(allBills);
      setSelectedBill(updated);
      setIsEditing(false);
    } catch (err: any) {
      alert(`Error updating bill: ${err.message || err}`);
    }
  };

  const getProductUnits = (productId: number) => {
    if (productId < 0) {
      return ["Piece", "NA", "Pudha", "KG", "Gram", "Litre", "ML"];
    }
    const prod = products.find((p) => p.id === productId);
    if (!prod) return ["Piece"];

    const cat = prod.category_id
      ? categories.find((c) => c.id === prod.category_id)
      : null;
    const isWeight =
      cat?.measurement_type === "Weight" ||
      cat?.name.toLowerCase() === "weight";
    const isVolume =
      cat?.measurement_type === "Volume" ||
      cat?.name.toLowerCase() === "volume";

    const unitsSet = new Set<string>();

    // 1. Add base units for Weight / Volume
    if (isWeight) {
      unitsSet.add("KG");
      unitsSet.add("Gram");
    } else if (isVolume) {
      unitsSet.add("Litre");
      unitsSet.add("ML");
    }

    // 2. Add current product's own units
    if (prod.units && prod.units.length > 0) {
      prod.units.forEach((u) => {
        if (u.unit_name) unitsSet.add(u.unit_name);
      });
    } else if (!isWeight && !isVolume) {
      // Resolve its default unit based on display name keywords
      const nameLower = prod.display_name.toLowerCase();
      let defaultUnit = "Piece";
      if (nameLower.includes("bag")) defaultUnit = "Bag";
      else if (nameLower.includes("carton") || nameLower.includes("cartoon"))
        defaultUnit = "Carton";
      else if (nameLower.includes("pudha") || nameLower.includes("puda"))
        defaultUnit = "Pudha";
      else if (nameLower.includes("tray")) defaultUnit = "Tray";
      else if (nameLower.includes("sheet")) defaultUnit = "Sheet";
      unitsSet.add(defaultUnit);
    }

    // 3. Find related products with the same base brand name to include their units
    const currentBase = getBaseBrandName(prod.display_name);
    const relatedProducts = products.filter(
      (p) => getBaseBrandName(p.display_name) === currentBase,
    );

    relatedProducts.forEach((p) => {
      p.units?.forEach((u) => {
        if (u.unit_name) unitsSet.add(u.unit_name);
      });
    });

    // 4. Fallbacks if set is empty
    if (unitsSet.size <= 1) {
      if (prod.category_id) {
        const cat = categories.find((c) => c.id === prod.category_id);
        if (cat?.default_units) {
          cat.default_units.forEach((u) => unitsSet.add(u));
        }
      }
    }
    if (unitsSet.size === 0) {
      unitsSet.add("Piece");
    }
    return Array.from(unitsSet);
  };

  // Sort descending: "last bill top order"
  const sortedAllBills = [...bills].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  // Search filter
  const filteredBills = sortedAllBills.filter((b) => {
    // Filter by selectedDate if set
    if (selectedDate) {
      const date = new Date(b.created_at);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const billDateStr = `${year}-${month}-${day}`;
      if (billDateStr !== selectedDate) return false;
    }

    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;

    // 1. Bill number
    if (
      String(b.bill_number).includes(q) ||
      `#${b.bill_number}`.toLowerCase().includes(q)
    )
      return true;

    // 2. Customer Name
    if (b.customer_name?.toLowerCase().includes(q)) return true;

    // 3. Customer Phone
    if (b.customer_phone?.toLowerCase().includes(q)) return true;

    // 4. Grand Total
    if (
      String(b.grand_total).includes(q) ||
      String(Math.round(b.grand_total)).includes(q)
    )
      return true;

    // 5. Date
    const dateStr = new Date(b.created_at).toLocaleDateString().toLowerCase();
    const isoStr = b.created_at.toLowerCase();
    if (dateStr.includes(q) || isoStr.includes(q)) return true;

    return false;
  });

  const ITEMS_PER_PAGE = 50;
  const paginatedBills = React.useMemo(() => {
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredBills.slice(startIdx, startIdx + ITEMS_PER_PAGE);
  }, [filteredBills, currentPage]);

  const totalPages = Math.ceil(filteredBills.length / ITEMS_PER_PAGE);

  const showList = !isMobile || !selectedBill;
  const showDetails = !isMobile || selectedBill;

  return (
    <div
      style={{ maxWidth: 880, margin: "0 auto" }}
      className="animate-slide-up"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={
              isMobile && selectedBill
                ? () => {
                    setSelectedBill(null);
                    setIsEditing(false);
                  }
                : onBack
            }
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: "#121017",
              border: "1px solid #2b253b",
              padding: "8px 12px",
              borderRadius: 8,
              color: "#9c97aa",
              cursor: "pointer",
            }}
          >
            <ArrowLeft size={16} />{" "}
            {isMobile && selectedBill ? "Back to Bills" : "Back"}
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>
            {isMobile && selectedBill
              ? isEditing
                ? "Edit Bill"
                : "Bill Details"
              : "Billing History"}
          </h1>
        </div>

        {/* Sync Button on History Screen */}
        {(!isMobile || !selectedBill) && (
          <button
            onClick={async () => {
              await manualSync();
              // Reload list
              const billsData = await db.getBills();
              setBills(billsData);
            }}
            disabled={isSyncing}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.2)",
              padding: "8px 16px",
              borderRadius: 20,
              color: "#f59e0b",
              cursor: isSyncing ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            <RefreshCw size={13} className={isSyncing ? "animate-spin" : ""} />
            <span>{isSyncing ? "Syncing..." : "Sync Bills"}</span>
          </button>
        )}
      </div>

      <div className="history-grid">
        {/* Bills List */}
        {showList && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Search Input and Date Selector Bar */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by Bill No, Customer, Total..."
                  style={{
                    width: "100%",
                    padding: "10px 12px 10px 38px",
                    borderRadius: 8,
                    background: "#121017",
                    border: "1px solid #2b253b",
                    color: "#fff",
                    fontSize: 13,
                  }}
                />
                <Search
                  size={16}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: 13,
                    color: "#9c97aa",
                  }}
                />
              </div>

              {/* Date selection input */}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: "#121017",
                    border: "1px solid #2b253b",
                    color: "#fff",
                    fontSize: 13,
                    colorScheme: "dark",
                    outline: "none",
                  }}
                />
                {selectedDate && (
                  <button
                    onClick={() => setSelectedDate("")}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "#2b253b",
                      border: "1px solid #3d3550",
                      color: "#a78bfa",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Show All
                  </button>
                )}
              </div>
            </div>

            {isMobile ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  maxHeight: 440,
                  overflowY: "auto",
                  padding: 2,
                }}
              >
                {paginatedBills.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: 40,
                      color: "#9c97aa",
                    }}
                  >
                    No matching billing history found.
                  </div>
                ) : (
                  paginatedBills.map((b) => (
                    <div
                      key={b.id}
                      onClick={() => {
                        setSelectedBill(b);
                        setIsEditing(false);
                      }}
                      style={{
                        background:
                          selectedBill?.id === b.id
                            ? "var(--bg-card-hover)"
                            : "#121017",
                        border:
                          selectedBill?.id === b.id
                            ? "1px solid #f59e0b"
                            : "1px solid #2b253b",
                        borderRadius: 12,
                        padding: 14,
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        textDecoration:
                          b.status === "Cancelled" ? "line-through" : "none",
                        opacity: b.status === "Cancelled" ? 0.6 : 1,
                        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 800,
                              color: "#a78bfa",
                            }}
                          >
                            #{b.bill_number}
                          </span>
                          <span style={{ fontSize: 11, color: "#9c97aa" }}>
                            {new Date(b.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        {b.payment_mode && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              background:
                                b.payment_mode === "Cash"
                                  ? "rgba(20,184,166,0.1)"
                                  : b.payment_mode === "UPI"
                                    ? "rgba(59,130,246,0.1)"
                                    : "rgba(239,68,68,0.1)",
                              color:
                                b.payment_mode === "Cash"
                                  ? "#14b8a6"
                                  : b.payment_mode === "UPI"
                                    ? "#3b82f6"
                                    : "#ef4444",
                              padding: "2px 6px",
                              borderRadius: 4,
                            }}
                          >
                            {b.payment_mode.toUpperCase()}
                          </span>
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#fff",
                        }}
                      >
                        👤 {b.customer_name || "Walk-in Customer"}
                      </span>
                      {b.customer_phone && (
                        <span style={{ fontSize: 11, color: "#9c97aa" }}>
                          📞 {b.customer_phone}
                        </span>
                      )}
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          borderTop: "1px dashed #221c33",
                          paddingTop: 8,
                          marginTop: 2,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            color:
                              b.status === "Cancelled" ? "#ef4444" : "#14b8a6",
                            fontWeight: 700,
                          }}
                        >
                          {b.status}
                        </span>
                        <span
                          style={{
                            fontSize: 16,
                            fontWeight: 800,
                            color: "#f59e0b",
                            fontFamily: "monospace",
                          }}
                        >
                          ₹{b.grand_total.toFixed(0)}
                        </span>
                      </div>
                    </div>
                  ))
                )}

                {/* Mobile Pagination Controls */}
                {totalPages > 1 && (
                  <div style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: 12,
                    marginTop: 16,
                    padding: "8px 0",
                  }}>
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 6,
                        background: currentPage === 1 ? "transparent" : "rgba(167,139,250,0.15)",
                        border: "1px solid #2b253b",
                        color: currentPage === 1 ? "#4b4855" : "#a78bfa",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: currentPage === 1 ? "not-allowed" : "pointer",
                      }}
                    >
                      Prev
                    </button>
                    <span style={{ fontSize: 13, color: "#9c97aa", fontWeight: 600 }}>
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 6,
                        background: currentPage === totalPages ? "transparent" : "rgba(167,139,250,0.15)",
                        border: "1px solid #2b253b",
                        color: currentPage === totalPages ? "#4b4855" : "#a78bfa",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                      }}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div
                className="pos-card"
                style={{ padding: 0, overflow: "hidden" }}
              >
                <div style={{ overflowX: "auto" }}>
                  <div style={{ minWidth: 480 }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1.5fr 1fr 1fr",
                        background: "#121017",
                        padding: "12px 20px",
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#9c97aa",
                        borderBottom: "1px solid #2b253b",
                      }}
                    >
                      <span>Bill No.</span>
                      <span>Customer</span>
                      <span>Mode</span>
                      <span style={{ textAlign: "right" }}>Total</span>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        maxHeight: 440,
                        overflowY: "auto",
                      }}
                    >
                      {paginatedBills.length === 0 ? (
                        <div
                          style={{
                            textAlign: "center",
                            padding: 40,
                            color: "#9c97aa",
                          }}
                        >
                          No matching billing history found.
                        </div>
                      ) : (
                        paginatedBills.map((b) => (
                          <div
                            key={b.id}
                            onClick={() => {
                              setSelectedBill(b);
                              setIsEditing(false);
                            }}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1.5fr 1fr 1fr",
                              padding: "14px 20px",
                              fontSize: 14,
                              borderBottom: "1px solid #2b253b",
                              alignItems: "center",
                              cursor: "pointer",
                              background:
                                selectedBill?.id === b.id
                                  ? "var(--bg-card-hover)"
                                  : "transparent",
                              textDecoration:
                                b.status === "Cancelled"
                                  ? "line-through"
                                  : "none",
                              opacity: b.status === "Cancelled" ? 0.5 : 1,
                            }}
                          >
                            <span style={{ fontWeight: 700 }}>
                              #{b.bill_number}
                            </span>
                            <span>{b.customer_name}</span>
                            <span>{b.payment_mode}</span>
                            <span
                              style={{
                                textAlign: "right",
                                fontWeight: 700,
                                fontFamily: "monospace",
                              }}
                            >
                              ₹{b.grand_total.toFixed(0)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Desktop Pagination Controls */}
                {totalPages > 1 && (
                  <div style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 20px",
                    background: "#121017",
                    borderTop: "1px solid #2b253b",
                  }}>
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 6,
                        background: currentPage === 1 ? "transparent" : "rgba(167,139,250,0.15)",
                        border: "1px solid #2b253b",
                        color: currentPage === 1 ? "#4b4855" : "#a78bfa",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: currentPage === 1 ? "not-allowed" : "pointer",
                      }}
                    >
                      Prev
                    </button>
                    <span style={{ fontSize: 13, color: "#9c97aa", fontWeight: 600 }}>
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 6,
                        background: currentPage === totalPages ? "transparent" : "rgba(167,139,250,0.15)",
                        border: "1px solid #2b253b",
                        color: currentPage === totalPages ? "#4b4855" : "#a78bfa",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                      }}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Selected Bill details preview OR Editor */}
        {showDetails && (
          <div>
            {selectedBill ? (
              isEditing ? (
                /* Detailed Bill Editor */
                <div
                  className="pos-card animate-slide-up"
                  style={{ padding: 24 }}
                >
                  <div className="flex-between" style={{ marginBottom: 16 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 800 }}>
                      Edit Bill Details #{selectedBill.bill_number}
                    </h3>
                    <button
                      onClick={() => setIsEditing(false)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#9c97aa",
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      Cancel
                    </button>
                  </div>

                  {/* Customer Section */}
                  <div
                    style={{
                      background: "#181520",
                      padding: 16,
                      borderRadius: 8,
                      marginBottom: 16,
                      border: "1px solid #2b253b",
                      position: "relative",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#9c97aa",
                        textTransform: "uppercase",
                        display: "block",
                        marginBottom: 10,
                      }}
                    >
                      Customer Details
                    </span>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                        gap: 12,
                        marginBottom: 8,
                      }}
                    >
                      <div>
                        <label
                          style={{
                            display: "block",
                            fontSize: 11,
                            color: "#9c97aa",
                            marginBottom: 4,
                          }}
                        >
                          Name
                        </label>
                        <input
                          type="text"
                          value={editCustomerName}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditCustomerName(val);
                            if (!val.trim()) {
                              setCustSuggestions([]);
                            } else {
                              const matches = customers.filter((c) =>
                                c.name
                                  .toLowerCase()
                                  .includes(val.toLowerCase()),
                              );
                              setCustSuggestions(matches);
                            }
                          }}
                          placeholder="Ramesh Kumar"
                          style={{
                            width: "100%",
                            fontSize: 13,
                            background: "#121017",
                            border: "1px solid #2b253b",
                            borderRadius: 6,
                            color: "#fff",
                            padding: "6px 10px",
                          }}
                        />
                      </div>
                      <div>
                        <label
                          style={{
                            display: "block",
                            fontSize: 11,
                            color: "#9c97aa",
                            marginBottom: 4,
                          }}
                        >
                          Phone
                        </label>
                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <input
                            type="text"
                            value={editCustomerPhone}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditCustomerPhone(val);
                              if (!val.trim()) {
                                setCustSuggestions([]);
                              } else {
                                const matches = customers.filter(
                                  (c) => c.phone && c.phone.includes(val),
                                );
                                setCustSuggestions(matches);
                              }
                            }}
                            placeholder="9876543210"
                            style={{
                              flex: 1,
                              fontSize: 13,
                              background: "#121017",
                              border: "1px solid #2b253b",
                              borderRadius: 6,
                              color: "#fff",
                              padding: "6px 10px",
                            }}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handlePickContact((name, phone) => {
                                setEditCustomerPhone(phone);
                                if (name) setEditCustomerName(name);
                              })
                            }
                            style={{
                              background: "#121017",
                              border: "1px solid #2b253b",
                              borderRadius: 6,
                              padding: "6px 8px",
                              color: "#f59e0b",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              height: 32,
                            }}
                            title="Pick from Contacts"
                          >
                            👤
                          </button>
                        </div>
                      </div>
                    </div>

                    {custSuggestions.length > 0 && (
                      <div
                        style={{
                          position: "absolute",
                          top: "100%",
                          left: 16,
                          right: 16,
                          background: "#181520",
                          border: "1px solid #2b253b",
                          borderRadius: 8,
                          marginTop: 4,
                          zIndex: 10,
                          maxHeight: 120,
                          overflowY: "auto",
                          boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                        }}
                      >
                        {custSuggestions.map((cust) => (
                          <div
                            key={cust.id}
                            onClick={() => {
                              setEditCustomerName(cust.name);
                              setEditCustomerPhone(cust.phone || "NA");
                              setEditCustomerId(cust.id);
                              setCustSuggestions([]);
                            }}
                            style={{
                              padding: "8px 12px",
                              cursor: "pointer",
                              borderBottom: "1px solid #2b253b",
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 12,
                            }}
                          >
                            <span style={{ fontWeight: 600 }}>{cust.name}</span>
                            <span style={{ color: "#9c97aa" }}>
                              {cust.phone || "No Phone"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {(editCustomerName || editCustomerPhone) && (
                      <button
                        onClick={() => {
                          setEditCustomerName("");
                          setEditCustomerPhone("");
                          setEditCustomerId(undefined);
                          setCustSuggestions([]);
                        }}
                        style={{
                          padding: "4px 8px",
                          background: "rgba(239, 68, 68, 0.1)",
                          color: "#ef4444",
                          border: "1px solid rgba(239, 68, 68, 0.2)",
                          borderRadius: 4,
                          fontSize: 11,
                          cursor: "pointer",
                          marginTop: 6,
                        }}
                      >
                        Remove Customer
                      </button>
                    )}
                  </div>

                  {/* Items Section */}
                  <div style={{ marginBottom: 16 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#9c97aa",
                        textTransform: "uppercase",
                        display: "block",
                        marginBottom: 10,
                      }}
                    >
                      Bill Items
                    </span>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        maxHeight: 200,
                        overflowY: "auto",
                        paddingRight: 4,
                        marginBottom: 12,
                      }}
                    >
                      {editItems.length === 0 ? (
                        <div
                          style={{
                            color: "#9c97aa",
                            fontSize: 13,
                            textAlign: "center",
                            padding: 20,
                          }}
                        >
                          No items in the bill. Add items below.
                        </div>
                      ) : (
                        editItems.map((item, index) => {
                          const prodUnits = getProductUnits(item.product_id);
                          return isMobile ? (
                            <div
                              key={index}
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                                background: "#121017",
                                padding: 12,
                                borderRadius: 8,
                                border: "1px solid #2b253b",
                                position: "relative",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  gap: 8,
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 700,
                                    color: "#fff",
                                    wordBreak: "break-all",
                                  }}
                                >
                                  {item.product_name}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditItems((prev) =>
                                      prev.filter((_, idx) => idx !== index),
                                    );
                                  }}
                                  style={{
                                    background: "rgba(239,68,68,0.1)",
                                    border: "none",
                                    color: "#ef4444",
                                    borderRadius: "50%",
                                    width: 24,
                                    height: 24,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                  }}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>

                              <div
                                style={{
                                  display: "flex",
                                  gap: 6,
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  borderTop: "1px dashed #221c33",
                                  paddingTop: 8,
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    gap: 4,
                                    alignItems: "center",
                                  }}
                                >
                                  <input
                                    type="number"
                                    step="any"
                                    value={
                                      item.quantity === 0 ? "" : item.quantity
                                    }
                                    onChange={(e) => {
                                      const val =
                                        parseFloat(e.target.value) || 0;
                                      setEditItems((prev) =>
                                        prev.map((itm, idx) =>
                                          idx === index
                                            ? {
                                                ...itm,
                                                quantity: val,
                                                total: +(
                                                  val * itm.price
                                                ).toFixed(2),
                                              }
                                            : itm,
                                        ),
                                      );
                                    }}
                                    style={{
                                      width: 50,
                                      padding: "5px",
                                      background: "#0b0a0f",
                                      border: "1px solid #2b253b",
                                      borderRadius: 4,
                                      color: "#fff",
                                      fontSize: 11,
                                      textAlign: "center",
                                    }}
                                    placeholder="Qty"
                                  />
                                  <select
                                    value={item.unit}
                                    onChange={(e) => {
                                      const unitVal = e.target.value;
                                      const prod = products.find(
                                        (p) => p.id === item.product_id,
                                      );
                                      let newPrice = item.price;
                                      let newQty = item.quantity;
                                      if (prod) {
                                        const { resolvedPrice } =
                                          resolveUnitAndPrice(prod, 1, unitVal);
                                        const ratio =
                                          prod.retail_price > 0
                                            ? prod.wholesale_price /
                                              prod.retail_price
                                            : 1;
                                        const isOriginallyWholesale =
                                          selectedBill.subtotal > 0 &&
                                          selectedBill.items.some((i) => {
                                            const originalProd = products.find(
                                              (prodVar) =>
                                                prodVar.id === i.product_id,
                                            );
                                            if (
                                              originalProd &&
                                              originalProd.retail_price > 0 &&
                                              i.price <
                                                originalProd.retail_price
                                            ) {
                                              return true;
                                            }
                                            return false;
                                          });
                                        newPrice = isOriginallyWholesale
                                          ? +(resolvedPrice * ratio).toFixed(2)
                                          : +resolvedPrice.toFixed(2);

                                        if (
                                          prod.category_id === 1 ||
                                          prod.category_id === 2
                                        ) {
                                          const origQtyInBase =
                                            getUnitBaseQuantity(
                                              item.unit,
                                              prod,
                                            );
                                          const destQtyInBase =
                                            getUnitBaseQuantity(unitVal, prod);
                                          if (
                                            origQtyInBase > 0 &&
                                            destQtyInBase > 0
                                          ) {
                                            newQty =
                                              item.quantity *
                                              (origQtyInBase / destQtyInBase);
                                          }
                                        }
                                      }
                                      setEditItems((prev) =>
                                        prev.map((itm, idx) =>
                                          idx === index
                                            ? {
                                                ...itm,
                                                unit: unitVal,
                                                quantity: newQty,
                                                price: newPrice,
                                                total: +(
                                                  newQty * newPrice
                                                ).toFixed(2),
                                              }
                                            : itm,
                                        ),
                                      );
                                    }}
                                    style={{
                                      width: 55,
                                      padding: "5px 2px",
                                      background: "#0b0a0f",
                                      border: "1px solid #2b253b",
                                      borderRadius: 4,
                                      color: "#fff",
                                      fontSize: 11,
                                    }}
                                  >
                                    {prodUnits.map((u) => (
                                      <option key={u} value={u}>
                                        {formatUnitShort(u)}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    gap: 4,
                                    alignItems: "center",
                                  }}
                                >
                                  <span
                                    style={{ fontSize: 10, color: "#9c97aa" }}
                                  >
                                    Price:
                                  </span>
                                  <input
                                    type="number"
                                    step="any"
                                    value={item.price === 0 ? "" : item.price}
                                    onChange={(e) => {
                                      const val =
                                        parseFloat(e.target.value) || 0;
                                      setEditItems((prev) =>
                                        prev.map((itm, idx) =>
                                          idx === index
                                            ? {
                                                ...itm,
                                                price: val,
                                                total: +(
                                                  itm.quantity * val
                                                ).toFixed(2),
                                              }
                                            : itm,
                                        ),
                                      );
                                    }}
                                    style={{
                                      width: 55,
                                      padding: "5px",
                                      background: "#0b0a0f",
                                      border: "1px solid #2b253b",
                                      borderRadius: 4,
                                      color: "#fff",
                                      fontSize: 11,
                                      textAlign: "center",
                                    }}
                                    placeholder="Price"
                                  />
                                </div>

                                <span
                                  style={{
                                    fontFamily: "monospace",
                                    fontWeight: 700,
                                    fontSize: 12,
                                    color: "#f59e0b",
                                  }}
                                >
                                  ₹{item.total.toFixed(1)}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div
                              key={index}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "2fr 1.2fr 1fr 1.2fr auto",
                                gap: 6,
                                alignItems: "center",
                                background: "#181520",
                                padding: 8,
                                borderRadius: 6,
                                border: "1px solid #2b253b",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={item.product_name}
                              >
                                {item.product_name}
                              </span>

                              {/* Qty Input */}
                              <input
                                type="number"
                                step="any"
                                value={item.quantity === 0 ? "" : item.quantity}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setEditItems((prev) =>
                                    prev.map((itm, idx) =>
                                      idx === index
                                        ? {
                                            ...itm,
                                            quantity: val,
                                            total: +(val * itm.price).toFixed(
                                              2,
                                            ),
                                          }
                                        : itm,
                                    ),
                                  );
                                }}
                                style={{
                                  width: "100%",
                                  padding: "4px 6px",
                                  background: "#121017",
                                  border: "1px solid #2b253b",
                                  borderRadius: 4,
                                  color: "#fff",
                                  fontSize: 12,
                                  textAlign: "center",
                                }}
                                placeholder="Qty"
                              />

                              {/* Unit Selector */}
                              <select
                                value={item.unit}
                                onChange={(e) => {
                                  const unitVal = e.target.value;
                                  const prod = products.find(
                                    (p) => p.id === item.product_id,
                                  );
                                  let newPrice = item.price;
                                  let newQty = item.quantity;
                                  if (prod) {
                                    const { resolvedPrice } =
                                      resolveUnitAndPrice(prod, 1, unitVal);
                                    const ratio =
                                      prod.retail_price > 0
                                        ? prod.wholesale_price /
                                          prod.retail_price
                                        : 1;
                                    const isOriginallyWholesale =
                                      selectedBill.subtotal > 0 &&
                                      selectedBill.items.some((i) => {
                                        const originalProd = products.find(
                                          (prodVar) =>
                                            prodVar.id === i.product_id,
                                        );
                                        if (
                                          originalProd &&
                                          originalProd.retail_price > 0 &&
                                          i.price < originalProd.retail_price
                                        ) {
                                          return true;
                                        }
                                        return false;
                                      });
                                    newPrice = isOriginallyWholesale
                                      ? +(resolvedPrice * ratio).toFixed(2)
                                      : +resolvedPrice.toFixed(2);

                                    // Scale quantity if switching between weight/volume units
                                    if (
                                      prod.category_id === 1 ||
                                      prod.category_id === 2
                                    ) {
                                      const origQtyInBase = getUnitBaseQuantity(
                                        item.unit,
                                        prod,
                                      );
                                      const destQtyInBase = getUnitBaseQuantity(
                                        unitVal,
                                        prod,
                                      );
                                      if (
                                        origQtyInBase > 0 &&
                                        destQtyInBase > 0
                                      ) {
                                        newQty =
                                          item.quantity *
                                          (origQtyInBase / destQtyInBase);
                                      }
                                    }
                                  }
                                  setEditItems((prev) =>
                                    prev.map((itm, idx) =>
                                      idx === index
                                        ? {
                                            ...itm,
                                            unit: unitVal,
                                            quantity: newQty,
                                            price: newPrice,
                                            total: +(newQty * newPrice).toFixed(
                                              2,
                                            ),
                                          }
                                        : itm,
                                    ),
                                  );
                                }}
                                style={{
                                  width: "100%",
                                  padding: "4px 2px",
                                  background: "#121017",
                                  border: "1px solid #2b253b",
                                  borderRadius: 4,
                                  color: "#fff",
                                  fontSize: 12,
                                }}
                              >
                                {prodUnits.map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </select>

                              {/* Price Input (Unit Price Override) */}
                              <input
                                type="number"
                                step="any"
                                value={item.price === 0 ? "" : item.price}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setEditItems((prev) =>
                                    prev.map((itm, idx) =>
                                      idx === index
                                        ? {
                                            ...itm,
                                            price: val,
                                            total: +(
                                              itm.quantity * val
                                            ).toFixed(2),
                                          }
                                        : itm,
                                    ),
                                  );
                                }}
                                style={{
                                  width: "100%",
                                  padding: "4px 6px",
                                  background: "#121017",
                                  border: "1px solid #2b253b",
                                  borderRadius: 4,
                                  color: "#fff",
                                  fontSize: 12,
                                  textAlign: "center",
                                }}
                                placeholder="Price"
                              />

                              {/* Delete Button */}
                              <button
                                type="button"
                                onClick={() => {
                                  setEditItems((prev) =>
                                    prev.filter((_, idx) => idx !== index),
                                  );
                                }}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  color: "#ef4444",
                                  cursor: "pointer",
                                  padding: 4,
                                  display: "flex",
                                  alignItems: "center",
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Add Item autocomplete tool */}
                    <div style={{ position: "relative" }}>
                      <input
                        type="text"
                        value={prodQuery}
                        onChange={(e) => setProdQuery(e.target.value)}
                        placeholder="Type product name to add to bill..."
                        style={{
                          width: "100%",
                          fontSize: 12,
                          padding: "8px 12px",
                          background: "#121017",
                          border: "1px solid #2b253b",
                          borderRadius: 6,
                          color: "#fff",
                        }}
                      />
                      {prodQuery.trim() && (
                        <div
                          style={{
                            position: "absolute",
                            top: "100%",
                            left: 0,
                            right: 0,
                            background: "#181520",
                            border: "1px solid #2b253b",
                            borderRadius: 8,
                            marginTop: 4,
                            zIndex: 10,
                            maxHeight: 150,
                            overflowY: "auto",
                            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                          }}
                        >
                          {products
                            .filter((p) =>
                              p.display_name
                                .toLowerCase()
                                .includes(prodQuery.toLowerCase()),
                            )
                            .map((p) => (
                              <div
                                key={p.id}
                                onClick={() => {
                                  const units = getProductUnits(p.id);
                                  const defaultUnit = units[0] || "Piece";
                                  const { resolvedPrice } = resolveUnitAndPrice(
                                    p,
                                    1,
                                    defaultUnit,
                                  );

                                  const ratio =
                                    p.retail_price > 0
                                      ? p.wholesale_price / p.retail_price
                                      : 1;
                                  const isOriginallyWholesale =
                                    selectedBill.subtotal > 0 &&
                                    selectedBill.items.some((i) => {
                                      const originalProd = products.find(
                                        (prodVar) =>
                                          prodVar.id === i.product_id,
                                      );
                                      if (
                                        originalProd &&
                                        originalProd.retail_price > 0 &&
                                        i.price < originalProd.retail_price
                                      ) {
                                        return true;
                                      }
                                      return false;
                                    });
                                  const finalPrice = isOriginallyWholesale
                                    ? +(resolvedPrice * ratio).toFixed(2)
                                    : +resolvedPrice.toFixed(2);

                                  const newItem: BillItem = {
                                    product_id: p.id,
                                    product_name: p.display_name,
                                    quantity: 1,
                                    unit: defaultUnit,
                                    price: finalPrice,
                                    total: finalPrice,
                                  };
                                  setEditItems((prev) => [...prev, newItem]);
                                  setProdQuery("");
                                }}
                                style={{
                                  padding: "8px 12px",
                                  cursor: "pointer",
                                  borderBottom: "1px solid #2b253b",
                                  display: "flex",
                                  justifyContent: "space-between",
                                  fontSize: 12,
                                }}
                              >
                                <span style={{ fontWeight: 600 }}>
                                  {p.display_name}
                                </span>
                                <span style={{ color: "#f59e0b" }}>
                                  ₹{p.retail_price}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Totals & Adjustments (Discount, Payment Mode) */}
                  <div
                    style={{
                      background: "#181520",
                      padding: 12,
                      borderRadius: 8,
                      border: "1px solid #2b253b",
                      marginBottom: 16,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 12,
                      }}
                    >
                      <div>
                        <label
                          style={{
                            display: "block",
                            fontSize: 11,
                            color: "#9c97aa",
                            marginBottom: 4,
                          }}
                        >
                          Discount (₹)
                        </label>
                        <input
                          type="number"
                          value={editDiscount === 0 ? "" : editDiscount}
                          onChange={(e) =>
                            setEditDiscount(parseFloat(e.target.value) || 0)
                          }
                          style={{
                            width: "100%",
                            padding: "6px",
                            fontSize: 12,
                            background: "#121017",
                            border: "1px solid #2b253b",
                            borderRadius: 6,
                            color: "#fff",
                          }}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label
                          style={{
                            display: "block",
                            fontSize: 11,
                            color: "#9c97aa",
                            marginBottom: 4,
                          }}
                        >
                          Payment Mode
                        </label>
                        <select
                          value={editPaymentMode}
                          onChange={(e) =>
                            setEditPaymentMode(e.target.value as any)
                          }
                          style={{
                            width: "100%",
                            padding: "6px",
                            fontSize: 12,
                            background: "#121017",
                            color: "#fff",
                            border: "1px solid #2b253b",
                            borderRadius: 4,
                          }}
                        >
                          <option value="Cash">Cash</option>
                          <option value="UPI">UPI</option>
                          <option value="Credit">Credit</option>
                        </select>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 14,
                        fontWeight: 700,
                        borderTop: "1px solid #2b253b",
                        paddingTop: 10,
                        marginTop: 4,
                      }}
                    >
                      <span>New Grand Total:</span>
                      <span style={{ color: "#f59e0b" }}>
                        ₹
                        {Math.max(
                          0,
                          editItems.reduce((sum, item) => sum + item.total, 0) -
                            editDiscount,
                        ).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Form Actions */}
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={() => setIsEditing(false)}
                      style={{
                        flex: 1,
                        padding: 12,
                        background: "transparent",
                        border: "1px solid #2b253b",
                        color: "#9c97aa",
                        borderRadius: 8,
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveChanges}
                      style={{
                        flex: 1,
                        padding: 12,
                        background: "linear-gradient(135deg, #10b981, #059669)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              ) : (
                /* Normal Bill Details Preview */
                <div className="pos-card" style={{ padding: 24 }}>
                  {isMobile && (
                    <button
                      onClick={() => setSelectedBill(null)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        background: "rgba(255, 255, 255, 0.05)",
                        border: "1px solid #2b253b",
                        padding: "6px 12px",
                        borderRadius: 6,
                        color: "#9c97aa",
                        marginBottom: 16,
                        fontSize: 12,
                      }}
                    >
                      <ArrowLeft size={14} /> Back to Bills List
                    </button>
                  )}
                  <div className="flex-between" style={{ marginBottom: 16 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 800 }}>
                      Bill Details #{selectedBill.bill_number}
                    </h3>
                    <span
                      className={`badge ${selectedBill.status === "Cancelled" ? "badge-failed" : "badge-approved"}`}
                    >
                      {selectedBill.status}
                    </span>
                  </div>

                  {/* Customer Preview Row */}
                  <div
                    style={{
                      display: "flex",
                      gap: 16,
                      marginBottom: 16,
                      background: "rgba(255, 255, 255, 0.02)",
                      padding: 10,
                      borderRadius: 8,
                      fontSize: 12,
                      border: "1px solid #2b253b",
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <span style={{ color: "#9c97aa", display: "block" }}>
                        Customer Name
                      </span>
                      <span style={{ fontWeight: 600 }}>
                        {selectedBill.customer_name || "Customer"}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: "#9c97aa", display: "block" }}>
                        Phone Number
                      </span>
                      <span style={{ fontWeight: 600 }}>
                        {selectedBill.customer_phone || "NA"}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: "#9c97aa", display: "block" }}>
                        Date
                      </span>
                      <span style={{ fontWeight: 600 }}>
                        {new Date(selectedBill.created_at).toLocaleDateString()}{" "}
                        {new Date(selectedBill.created_at).toLocaleTimeString(
                          [],
                          { hour: "2-digit", minute: "2-digit" },
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Items block */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      marginBottom: 16,
                      borderBottom: "1px solid #2b253b",
                      paddingBottom: 16,
                    }}
                  >
                    {selectedBill.items.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex-between"
                        style={{ fontSize: 13 }}
                      >
                        <span>
                          {item.product_name} x {item.quantity} {item.unit} @ ₹
                          {item.price}
                        </span>
                        <span style={{ fontFamily: "monospace" }}>
                          ₹{item.total.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Summary totals */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      marginBottom: 20,
                    }}
                  >
                    <div
                      className="flex-between"
                      style={{ fontSize: 13, color: "#9c97aa" }}
                    >
                      <span>Subtotal:</span>
                      <span>₹{selectedBill.subtotal.toFixed(2)}</span>
                    </div>
                    {selectedBill.discount > 0 && (
                      <div
                        className="flex-between"
                        style={{ fontSize: 13, color: "#14b8a6" }}
                      >
                        <span>Discount:</span>
                        <span>-₹{selectedBill.discount.toFixed(2)}</span>
                      </div>
                    )}
                    <div
                      className="flex-between"
                      style={{ fontSize: 15, fontWeight: 800 }}
                    >
                      <span>Grand Total:</span>
                      <span style={{ color: "#f59e0b" }}>
                        ₹{selectedBill.grand_total.toFixed(2)}
                      </span>
                    </div>
                    <div
                      className="flex-between"
                      style={{ fontSize: 13, color: "#9c97aa", marginTop: 6 }}
                    >
                      <span>Payment Mode:</span>
                      <span>{selectedBill.payment_mode}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <button
                      onClick={handleStartEdit}
                      style={{
                        width: "100%",
                        padding: 12,
                        borderRadius: 8,
                        background: "linear-gradient(135deg, #f59e0b, #d97706)",
                        color: "#0b0a0f",
                        fontSize: 13,
                        fontWeight: 700,
                        border: "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        cursor: "pointer",
                      }}
                    >
                      Edit Bill Details
                    </button>
                    <button
                      onClick={() => handleReprint(selectedBill)}
                      style={{
                        width: "100%",
                        padding: 12,
                        borderRadius: 8,
                        background: "#2b253b",
                        color: "#fff",
                        fontSize: 13,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        border: "1px solid #2b253b",
                        cursor: "pointer",
                      }}
                    >
                      <Printer size={15} /> Reprint Receipt
                    </button>
                    <button
                      onClick={handleShareHistoryBillWhatsApp}
                      style={{
                        width: "100%",
                        padding: 12,
                        borderRadius: 8,
                        background: "#25D366",
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 700,
                        border: "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        cursor: "pointer",
                      }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="currentColor"
                      >
                        <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.725 1.451 5.477 0 9.932-4.455 9.935-9.93.002-2.652-1.022-5.146-2.885-7.009-1.864-1.864-4.359-2.887-7.01-2.887-5.485 0-9.94 4.457-9.944 9.932-.001 1.62.428 3.205 1.242 4.616l-.975 3.56 3.657-.968zm11.666-4.63c-.312-.156-1.848-.912-2.129-1.015-.282-.102-.487-.156-.69.156-.204.311-.788 1.015-.966 1.22-.177.205-.355.23-.667.074-1.92-.958-3.178-1.957-4.323-3.92-.302-.518.302-.481.866-1.606.094-.188.047-.353-.024-.509-.071-.156-.69-1.666-.946-2.28-.248-.599-.5-.518-.69-.527-.18-.009-.387-.01-.594-.01s-.54.077-.822.387c-.282.311-1.077 1.051-1.077 2.562 0 1.511 1.098 2.972 1.248 3.179.15.205 2.162 3.303 5.239 4.629.732.316 1.303.504 1.748.646.735.234 1.405.201 1.933.123.589-.088 1.848-.756 2.11-1.45.263-.695.263-1.291.185-1.421-.078-.13-.282-.208-.595-.364z" />
                      </svg>
                      Share on WhatsApp
                    </button>
                    {selectedBill.status !== "Cancelled" &&
                      selectedBill.payment_mode !== "Credit" && (
                        <button
                          onClick={() => handleConvertToCredit(selectedBill)}
                          style={{
                            width: "100%",
                            padding: 12,
                            borderRadius: 8,
                            background: "rgba(59, 130, 246, 0.15)",
                            border: "1px solid #3b82f6",
                            color: "#3b82f6",
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                          }}
                        >
                          Convert to Khata Credit
                        </button>
                      )}
                    {selectedBill.status !== "Cancelled" && (
                      <button
                        onClick={() => handleCancelBill(selectedBill)}
                        style={{
                          width: "100%",
                          padding: 12,
                          borderRadius: 8,
                          background: "rgba(239,68,68,0.1)",
                          border: "1px solid #ef4444",
                          color: "#ef4444",
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        Cancel Bill (Audit Record)
                      </button>
                    )}
                    {selectedBill.status === "Cancelled" && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => handleUndoBill(selectedBill)}
                          style={{
                            flex: 1,
                            padding: 11,
                            borderRadius: 8,
                            background: "rgba(34,197,94,0.12)",
                            border: "1px solid #22c55e",
                            color: "#22c55e",
                            fontSize: 13,
                            cursor: "pointer",
                            fontWeight: 600,
                          }}
                        >
                          ↩ Undo Cancel
                        </button>
                        <button
                          onClick={() =>
                            handleDeleteBillPermanently(selectedBill)
                          }
                          style={{
                            flex: 1,
                            padding: 11,
                            borderRadius: 8,
                            background: "rgba(239,68,68,0.18)",
                            border: "1px solid #7f1d1d",
                            color: "#fca5a5",
                            fontSize: 13,
                            cursor: "pointer",
                            fontWeight: 600,
                          }}
                        >
                          🗑️ Delete Forever
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            ) : (
              <div
                className="pos-card"
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: "#9c97aa",
                  borderStyle: "dashed",
                }}
              >
                Select a bill from the history list to view details, edit
                options, and reprint receipts.
              </div>
            )}
          </div>
        )}
      </div>

      {/* CANCEL BILL CONFIRMATION MODAL */}
      {cancelConfirmBill && (
        <div
          onClick={() => setCancelConfirmBill(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 380,
              background: "#121017",
              border: "1px solid #ef4444",
              padding: 28,
              borderRadius: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  background: "rgba(239,68,68,0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                }}
              >
                ⚠️
              </div>
              <div>
                <div
                  style={{ fontSize: 17, fontWeight: 800, color: "#ef4444" }}
                >
                  Cancel Bill?
                </div>
                <div style={{ fontSize: 12, color: "#9c97aa", marginTop: 2 }}>
                  This action creates an audit record
                </div>
              </div>
            </div>
            <p
              style={{
                fontSize: 14,
                color: "#d1cee0",
                lineHeight: 1.6,
                marginBottom: 22,
              }}
            >
              Are you sure you want to cancel{" "}
              <strong style={{ color: "#fff" }}>
                Bill #{cancelConfirmBill.bill_number}
              </strong>
              ?<br />
              The bill will be marked{" "}
              <span style={{ color: "#ef4444", fontWeight: 700 }}>
                CANCELLED
              </span>{" "}
              and an audit log entry will be created. This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setCancelConfirmBill(null)}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  borderRadius: 8,
                  background: "transparent",
                  border: "1px solid #3d3750",
                  color: "#9c97aa",
                  fontSize: 14,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Keep Bill
              </button>
              <button
                onClick={handleConfirmCancelBill}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  borderRadius: 8,
                  background: "#ef4444",
                  border: "none",
                  color: "#fff",
                  fontSize: 14,
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Yes, Cancel Bill
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UNDO CANCEL BILL CONFIRMATION MODAL */}
      {undoConfirmBill && (
        <div
          onClick={() => setUndoConfirmBill(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 380,
              background: "#121017",
              border: "1px solid #22c55e",
              padding: 28,
              borderRadius: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  background: "rgba(34,197,94,0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                }}
              >
                ↩️
              </div>
              <div>
                <div
                  style={{ fontSize: 17, fontWeight: 800, color: "#22c55e" }}
                >
                  Restore Bill?
                </div>
                <div style={{ fontSize: 12, color: "#9c97aa", marginTop: 2 }}>
                  This will mark the bill as Completed
                </div>
              </div>
            </div>
            <p
              style={{
                fontSize: 14,
                color: "#d1cee0",
                lineHeight: 1.6,
                marginBottom: 22,
              }}
            >
              Are you sure you want to restore{" "}
              <strong style={{ color: "#fff" }}>
                Bill #{undoConfirmBill.bill_number}
              </strong>
              ?<br />
              The bill will be active again, and any associated credit
              transaction will be re-applied to the customer's account.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setUndoConfirmBill(null)}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  borderRadius: 8,
                  background: "transparent",
                  border: "1px solid #3d3750",
                  color: "#9c97aa",
                  fontSize: 14,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmUndoBill}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  borderRadius: 8,
                  background: "#22c55e",
                  border: "none",
                  color: "#fff",
                  fontSize: 14,
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Yes, Restore Bill
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE BILL PERMANENTLY CONFIRMATION MODAL */}
      {deleteConfirmBill && (
        <div
          onClick={() => setDeleteConfirmBill(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 380,
              background: "#121017",
              border: "1px solid #ef4444",
              padding: 28,
              borderRadius: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  background: "rgba(239,68,68,0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                }}
              >
                ⚠️
              </div>
              <div>
                <div
                  style={{ fontSize: 17, fontWeight: 800, color: "#ef4444" }}
                >
                  Delete Permanently?
                </div>
                <div style={{ fontSize: 12, color: "#9c97aa", marginTop: 2 }}>
                  This action is completely irreversible
                </div>
              </div>
            </div>
            <p
              style={{
                fontSize: 14,
                color: "#d1cee0",
                lineHeight: 1.6,
                marginBottom: 22,
              }}
            >
              Are you sure you want to permanently delete{" "}
              <strong style={{ color: "#fff" }}>
                Bill #{deleteConfirmBill.bill_number}
              </strong>
              ?<br />
              This will remove the bill record completely from your history.{" "}
              <strong style={{ color: "#ef4444" }}>
                This cannot be undone.
              </strong>
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setDeleteConfirmBill(null)}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  borderRadius: 8,
                  background: "transparent",
                  border: "1px solid #3d3750",
                  color: "#9c97aa",
                  fontSize: 14,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Keep Cancelled
              </button>
              <button
                onClick={handleConfirmDeleteBill}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  borderRadius: 8,
                  background: "#ef4444",
                  border: "none",
                  color: "#fff",
                  fontSize: 14,
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Yes, Delete Forever
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LINK/CREATE CUSTOMER MODAL FOR CREDIT BILL CONVERSION */}
      {showLinkCustomerModal && linkBill && (
        <div
          onClick={() => setShowLinkCustomerModal(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 101,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 420,
              background: "#121017",
              border: "1px solid #2b253b",
              padding: 24,
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div
              className="flex-between"
              style={{ borderBottom: "1px solid #2b253b", paddingBottom: 10 }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>
                Link Customer for Khata Dues
              </h3>
              <button
                onClick={() => setShowLinkCustomerModal(false)}
                style={{
                  background: "transparent",
                  color: "#9c97aa",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <X size={20} />
              </button>
            </div>

            <p
              style={{
                fontSize: 13,
                color: "#9c97aa",
                lineHeight: 1.4,
                margin: 0,
              }}
            >
              Bill #{linkBill.bill_number} has total of{" "}
              <strong style={{ color: "#f59e0b" }}>
                ₹{linkBill.grand_total.toFixed(2)}
              </strong>
              . To convert this to Credit (Khata), please link a registered
              customer profile below.
            </p>

            {/* Select Customer */}
            <div
              style={{
                background: "#181520",
                padding: 14,
                borderRadius: 8,
                border: "1px solid #2b253b",
                position: "relative",
              }}
            >
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#9c97aa",
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                Search Existing Customer
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  value={linkCustomerQuery}
                  onChange={(e) => {
                    const val = e.target.value;
                    setLinkCustomerQuery(val);
                    if (!val.trim()) {
                      setLinkCustSuggestions([]);
                    } else {
                      const matches = customers.filter(
                        (c) =>
                          c.name.toLowerCase().includes(val.toLowerCase()) ||
                          (c.phone && c.phone.includes(val)),
                      );
                      setLinkCustSuggestions(matches);
                    }
                  }}
                  placeholder="Type customer name or phone..."
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    fontSize: 13,
                    background: "#121017",
                    border: "1px solid #2b253b",
                    borderRadius: 6,
                    color: "#fff",
                  }}
                />

                {linkCustSuggestions.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      background: "#181520",
                      border: "1px solid #2b253b",
                      borderRadius: 8,
                      marginTop: 4,
                      zIndex: 10,
                      maxHeight: 120,
                      overflowY: "auto",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                    }}
                  >
                    {linkCustSuggestions.map((cust) => (
                      <div
                        key={cust.id}
                        onClick={() => {
                          setSelectedLinkCustomer(cust);
                          setLinkCustomerQuery(cust.name);
                          setLinkCustSuggestions([]);
                        }}
                        style={{
                          padding: "8px 12px",
                          cursor: "pointer",
                          borderBottom: "1px solid #2b253b",
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 12,
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{cust.name}</span>
                        <span style={{ color: "#9c97aa" }}>
                          {cust.phone || "No Phone"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selectedLinkCustomer && (
                <div
                  style={{
                    marginTop: 12,
                    padding: "8px 12px",
                    background: "rgba(20, 184, 166, 0.1)",
                    border: "1px solid rgba(20, 184, 166, 0.2)",
                    borderRadius: 6,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <strong style={{ fontSize: 13, color: "#14b8a6" }}>
                      {selectedLinkCustomer.name}
                    </strong>
                    <span
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "#9c97aa",
                      }}
                    >
                      {selectedLinkCustomer.phone || "No Phone"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      performCreditConversion(linkBill, selectedLinkCustomer)
                    }
                    style={{
                      padding: "6px 12px",
                      background: "#14b8a6",
                      color: "#0b0a0f",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    Link & Convert
                  </button>
                </div>
              )}
            </div>

            <div
              style={{
                textAlign: "center",
                fontSize: 12,
                color: "#9c97aa",
                fontWeight: 600,
              }}
            >
              OR
            </div>

            {/* Create New Customer Inline */}
            <div
              style={{
                background: "#181520",
                padding: 14,
                borderRadius: 8,
                border: "1px solid #2b253b",
              }}
            >
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#9c97aa",
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                Create & Link New Customer
              </label>

              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                <div>
                  <input
                    type="text"
                    value={createLinkCustName}
                    onChange={(e) => setCreateLinkCustName(e.target.value)}
                    placeholder="New Customer Name"
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      fontSize: 13,
                      background: "#121017",
                      border: "1px solid #2b253b",
                      borderRadius: 6,
                      color: "#fff",
                    }}
                  />
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="text"
                    value={createLinkCustPhone}
                    onChange={(e) => setCreateLinkCustPhone(e.target.value)}
                    placeholder="New Customer Phone (Optional)"
                    style={{
                      flex: 1,
                      padding: "6px 10px",
                      fontSize: 13,
                      background: "#121017",
                      border: "1px solid #2b253b",
                      borderRadius: 6,
                      color: "#fff",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      handlePickContact((name, phone) => {
                        setCreateLinkCustPhone(phone);
                        if (name) setCreateLinkCustName(name);
                      })
                    }
                    style={{
                      background: "#121017",
                      border: "1px solid #2b253b",
                      borderRadius: 6,
                      padding: "6px 8px",
                      color: "#f59e0b",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: 32,
                    }}
                    title="Pick from Contacts"
                  >
                    👤
                  </button>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    if (!createLinkCustName.trim()) {
                      alert("Please enter customer name.");
                      return;
                    }
                    if (createLinkCustPhone.trim()) {
                      const existing = customers.find(
                        (c) => c.phone === createLinkCustPhone.trim(),
                      );
                      if (existing) {
                        const confirmSave = window.confirm(
                          `A customer named "${existing.name}" is already registered with this phone number. Do you want to continue with the same number?`,
                        );
                        if (!confirmSave) return; // go back
                      }
                    }
                    try {
                      const newCust = await db.saveCustomer({
                        name: createLinkCustName.trim(),
                        phone: createLinkCustPhone.trim() || undefined,
                        total_bills: 0,
                        total_purchases: 0,
                      });
                      await performCreditConversion(linkBill, newCust);
                    } catch (err: any) {
                      alert(`Failed to create customer: ${err.message || err}`);
                    }
                  }}
                  style={{
                    padding: "8px 12px",
                    background: "#f59e0b",
                    color: "#0b0a0f",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    border: "none",
                    cursor: "pointer",
                    marginTop: 4,
                  }}
                >
                  Create, Link & Convert
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// SCREEN 9: KHATA CREDIT LEDGER MANAGER
// ----------------------------------------------------
function KhataLedger({
  khataRecords,
  onBack,
  handlePickContact,
}: {
  khataRecords: KhataRecord[];
  onBack: () => void;
  handlePickContact: (onSelect: (name: string, phone: string) => void) => void;
}) {
  const [selectedCustId, setSelectedCustId] = useState<number | null>(null);
  const customers = useStore((state) => state.customers);
  const [ledgerTxs, setLedgerTxs] = useState<any[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDesc, setPaymentDesc] = useState("");
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<"Payment" | "Credit">("Payment");
  const [attachedImage, setAttachedImage] = useState<string>("");
  const [viewImageTx, setViewImageTx] = useState<any | null>(null);
  const [txDate, setTxDate] = useState(
    new Date().toISOString().substring(0, 10),
  );
  const [showAddCustModal, setShowAddCustModal] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [newCustInitialCredit, setNewCustInitialCredit] = useState("");
  const [newCustNote, setNewCustNote] = useState("");
  const [newCustDate, setNewCustDate] = useState(
    new Date().toISOString().substring(0, 10),
  );
  const [khataSearchQuery, setKhataSearchQuery] = useState("");

  const [isListeningKhata, setIsListeningKhata] = useState(false);
  const [khataVoiceError, setKhataVoiceError] = useState("");
  const [khataTranscript, setKhataTranscript] = useState("");
  const [khataSummaryData, setKhataSummaryData] = useState<any | null>(null);
  const [showKhataVoiceModal, setShowKhataVoiceModal] = useState(false);
  const [simulatedKhataText, setSimulatedKhataText] = useState("");
  const khataRecognitionRef = useRef<any>(null);

  const [voiceDisambiguationList, setVoiceDisambiguationList] = useState<
    Customer[]
  >([]);
  const [pendingVoiceAction, setPendingVoiceAction] = useState<any | null>(
    null,
  );

  const startKhataVoiceListening = async () => {
    if (isListeningKhata) {
      if (Capacitor.isNativePlatform()) {
        try {
          await SpeechPlugin.stopListening();
        } catch {}
      } else if (khataRecognitionRef.current) {
        khataRecognitionRef.current.stop();
      }
      setIsListeningKhata(false);
      return;
    }

    setKhataVoiceError("");
    setKhataTranscript("");
    setShowKhataVoiceModal(true);

    if (Capacitor.isNativePlatform()) {
      try {
        setIsListeningKhata(true);
        setKhataTranscript("Listening... Speak command");
        const result = await SpeechPlugin.startListening();
        const resultText = pickBestSpeechTranscript(result);
        if (resultText) {
          setKhataTranscript(resultText);
          await processKhataVoiceCommand(resultText);
        }
      } catch (err: any) {
        console.error("Native Khata speech error:", err);
        setKhataVoiceError(
          err?.message ||
            "Native speech recognition failed. Try speaking clearer or use the simulator.",
        );
      } finally {
        setIsListeningKhata(false);
      }
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setKhataVoiceError(
        "Speech recognition is not supported in this browser. Please use the simulator below.",
      );
      return;
    }

    // Request microphone permission at runtime explicitly to trigger WebView dialog
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop all tracks immediately as we only wanted to prompt/acquire permission
      stream.getTracks().forEach((track) => track.stop());
    } catch (e: any) {
      console.warn("Microphone permission request failed or rejected:", e);
      setKhataVoiceError(
        "Microphone permission denied. Please allow microphone access and try again.",
      );
      return;
    }

    try {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;

      rec.onstart = () => {
        setIsListeningKhata(true);
        setKhataTranscript("Listening... Speak command");
      };

      rec.onresult = async (event: any) => {
        const resultText = event.results[0][0].transcript;
        setKhataTranscript(resultText);
        await processKhataVoiceCommand(resultText);
      };

      rec.onerror = (err: any) => {
        console.error("Khata Speech error:", err);
        setKhataVoiceError(
          "Speech recognition failed. Try speaking clearer or use the simulator.",
        );
        setIsListeningKhata(false);
      };

      rec.onend = () => {
        setIsListeningKhata(false);
      };

      khataRecognitionRef.current = rec;
      rec.start();
    } catch (err: any) {
      console.error("Speech start error:", err);
      setKhataVoiceError("Failed to start speech recognition.");
      setIsListeningKhata(false);
    }
  };

  const executeVoiceAction = async (targetCustomer: Customer, parsed: any) => {
    try {
      if (parsed.action === "INQUIRY") {
        const [txs, allBills] = await Promise.all([
          db.getKhataTransactions(targetCustomer.id),
          db.getBills(),
        ]);

        const customerBills = allBills.filter(
          (b) =>
            b.customer_id === targetCustomer.id && b.status !== "Cancelled",
        );
        const latestBill = [...customerBills].sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )[0];

        const record = khataRecords.find(
          (k) => k.customer_id === targetCustomer.id,
        );
        const balance = record ? record.balance : 0;

        setKhataSummaryData({
          customer: targetCustomer,
          balance,
          transactions: txs,
          latestBill,
        });

        loadLedger(targetCustomer.id);
        setShowKhataVoiceModal(false);
      } else if (parsed.action === "CREDIT" || parsed.action === "PAYMENT") {
        const amt = parsed.amount;
        if (!amt || isNaN(amt) || amt <= 0) {
          setKhataVoiceError(`Please specify a valid transaction amount.`);
          return;
        }

        const type = parsed.action === "CREDIT" ? "Credit" : "Payment";
        const finalAmount = type === "Payment" ? -amt : amt;
        const finalDesc =
          type === "Payment" ? "Voice Payment Entry" : "Voice Credit Entry";

        await db.addKhataTransaction(
          targetCustomer.id,
          finalAmount,
          type,
          finalDesc,
          undefined,
          new Date().toISOString(),
        );

        confetti({ particleCount: 60, spread: 60, origin: { y: 0.8 } });
        alert(
          `Successfully added ${type} of ₹${amt.toFixed(2)} for ${targetCustomer.name}.`,
        );

        loadLedger(targetCustomer.id);
        await useStore.getState().loadStoreData();
        useStore.getState().triggerSync();
        setShowKhataVoiceModal(false);
      }
    } catch (err: any) {
      console.error("Error executing voice action:", err);
      setKhataVoiceError(`Error executing command: ${err.message || err}`);
    }
  };

  const processKhataVoiceCommand = async (textStr: string) => {
    if (!textStr.trim()) return;
    try {
      const parsed = await parseKhataVoiceCommand(textStr, customers);

      if (parsed.action === "UNKNOWN") {
        setKhataVoiceError(`Could not understand command: "${textStr}"`);
        return;
      }

      // Find matched customers based on parsed name or customer ID
      let matchedCustomers: Customer[] = [];

      if (parsed.customerName && parsed.customerName !== "Unknown Customer") {
        const nameToSearch = parsed.customerName.toLowerCase().trim();
        matchedCustomers = customers.filter(
          (c) =>
            c.name.toLowerCase().trim() === nameToSearch ||
            c.name.toLowerCase().includes(nameToSearch) ||
            nameToSearch.includes(c.name.toLowerCase()),
        );
      }

      if (matchedCustomers.length === 0 && parsed.customerId) {
        const c = customers.find((x) => x.id === parsed.customerId);
        if (c) {
          const nameToSearch = c.name.toLowerCase().trim();
          matchedCustomers = customers.filter(
            (x) => x.name.toLowerCase().trim() === nameToSearch,
          );
        }
      }

      if (matchedCustomers.length === 0) {
        setKhataVoiceError(
          `Could not find customer matching "${parsed.customerName}" in database.`,
        );
        return;
      }

      if (matchedCustomers.length > 1) {
        // Multiple persons found with the same name -> display selection prompt
        setVoiceDisambiguationList(matchedCustomers);
        setPendingVoiceAction(parsed);
        setShowKhataVoiceModal(false);
        return;
      }

      // Exactly one customer matches
      await executeVoiceAction(matchedCustomers[0], parsed);
    } catch (err: any) {
      console.error("Error processing Khata voice command:", err);
      setKhataVoiceError(`Error: ${err.message || err}`);
    }
  };

  const loadLedger = async (cId: number) => {
    setSelectedCustId(cId);
    const [txs, allBills] = await Promise.all([
      db.getKhataTransactions(cId),
      db.getBills(),
    ]);
    setLedgerTxs(txs);
    setBills(allBills);
  };

  const handleShareKhataWhatsApp = async () => {
    if (!activeKhata) return;

    const storeName = useStore.getState().storeName;

    // 1. Generate Khata PDF
    const khataPdfBlob = generateKhataPDF(
      activeKhata.customer_name,
      activeKhata.customer_phone || "NA",
      activeKhata.balance,
      ledgerTxs,
      storeName,
    );

    // 2. Look up the customer's previous (most recent) bill
    const customerBills = bills.filter(
      (b) =>
        b.customer_id === activeKhata.customer_id && b.status !== "Cancelled",
    );
    const sortedCustomerBills = [...customerBills].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const previousBill = sortedCustomerBills[0];

    let pdfBlobs: Blob[] = [khataPdfBlob];
    let pdfFileNames: string[] = [
      `Khata_${activeKhata.customer_name.replace(/\s+/g, "_")}.pdf`,
    ];

    let previousBillSectionText = "";
    if (previousBill) {
      const prevBillPdf = generateBillPDF(previousBill, storeName);
      pdfBlobs.push(prevBillPdf);
      pdfFileNames.push(`Bill_${previousBill.bill_number}.pdf`);
      previousBillSectionText = `\n🧾 *Attached Previous Bill Details:*
- Bill No: #${previousBill.bill_number}
- Grand Total: Rs. ${previousBill.grand_total.toFixed(2)}
- Date: ${new Date(previousBill.created_at).toLocaleDateString()}
`;
    }

    // 3. Format WhatsApp Text Summary
    const txSummary = ledgerTxs
      .slice(0, 5)
      .map((tx) => {
        const txDate = new Date(tx.created_at).toLocaleDateString();
        const typeStr = tx.amount > 0 ? "Purchased" : "Paid";
        return `- ${txDate}: ${typeStr} (Rs.${Math.abs(tx.amount).toFixed(0)}) - ${tx.description}`;
      })
      .join("\n");

    const summary = `📜 *${storeName.toUpperCase()} - KHATA STATEMENT*
----------------------------------------
*Customer:* ${activeKhata.customer_name}
*Phone:* ${activeKhata.customer_phone || "NA"}
*Outstanding Balance:* Rs. ${activeKhata.balance.toFixed(2)}
${previousBillSectionText}
*Recent Transactions:*
${txSummary}
${ledgerTxs.length > 5 ? `... and ${ledgerTxs.length - 5} more transactions.` : ""}

----------------------------------------
Please settle the outstanding balance of *Rs. ${activeKhata.balance.toFixed(2)}* at your earliest convenience. 🙏`;

    // 4. Share
    await shareViaWhatsApp(
      activeKhata.customer_phone || "NA",
      summary,
      pdfBlobs,
      pdfFileNames,
    );
  };

  const handleShareLedgerBillWhatsApp = async (
    txDescription: string,
    customerPhone: string,
  ) => {
    const match = txDescription.match(/Bill\s+#(\d+)/);
    if (!match) return;
    const billNum = parseInt(match[1], 10);
    if (isNaN(billNum)) return;

    const targetBill = bills.find((b) => b.bill_number === billNum);
    if (!targetBill) {
      alert(`Could not find Bill #${billNum} in history.`);
      return;
    }

    const storeName = useStore.getState().storeName;
    const pdfBlob = generateBillPDF(targetBill, storeName);

    const itemsList = targetBill.items
      .map(
        (itm, idx) =>
          `${idx + 1}. ${itm.product_name} x ${itm.quantity} ${itm.unit} @ Rs.${itm.price.toFixed(0)} = Rs.${itm.total.toFixed(0)}`,
      )
      .join("\n");

    const summary = `🧾 *${storeName.toUpperCase()} - BILL RECEIPT*
----------------------------------------
*Bill No:* #${targetBill.bill_number}
*Date:* ${new Date(targetBill.created_at).toLocaleDateString()}
*Customer:* ${targetBill.customer_name || "Guest"} (${targetBill.customer_phone || "NA"})
*Payment Mode:* ${targetBill.payment_mode}

*Items:*
${itemsList}

----------------------------------------
*Subtotal:* Rs. ${targetBill.subtotal.toFixed(2)}
*Discount:* Rs. ${targetBill.discount.toFixed(2)}
*Grand Total:* Rs. ${targetBill.grand_total.toFixed(2)}

Thank you for shopping with us! 🙏`;

    await shareViaWhatsApp(
      customerPhone || "NA",
      summary,
      pdfBlob,
      `Bill_${targetBill.bill_number}.pdf`,
    );
  };

  const handleTransactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustId || !paymentAmount) return;

    const amt = parseFloat(paymentAmount);
    if (isNaN(amt) || amt <= 0) {
      alert("Please enter a valid amount.");
      return;
    }

    const type = activeTab;
    const finalAmount = type === "Payment" ? -amt : amt;
    const defaultDesc =
      type === "Payment" ? "Cash Settlement" : "Manual Credit Entry";
    const finalDesc = paymentDesc.trim() || defaultDesc;

    // Construct custom date preserving current clock time
    const now = new Date();
    const [year, month, day] = txDate.split("-").map(Number);
    const dateObj = new Date(
      year,
      month - 1,
      day,
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
    );
    const finalCreatedAt = dateObj.toISOString();

    await db.addKhataTransaction(
      selectedCustId,
      finalAmount,
      type,
      finalDesc,
      attachedImage || undefined,
      finalCreatedAt,
    );

    // Refresh state
    setPaymentAmount("");
    setPaymentDesc("");
    setAttachedImage("");
    setTxDate(new Date().toISOString().substring(0, 10)); // reset to today
    loadLedger(selectedCustId);
    useStore.getState().loadStoreData();
    useStore.getState().triggerSync();
  };

  const handleAddCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;

    if (newCustPhone.trim()) {
      const existing = customers.find((c) => c.phone === newCustPhone.trim());
      if (existing) {
        const confirmSave = window.confirm(
          `A customer named "${existing.name}" is already registered with this phone number. Do you want to continue with the same number?`,
        );
        if (!confirmSave) return; // go back
      }
    }

    try {
      const newCust = await db.saveCustomer({
        name: newCustName.trim(),
        phone: newCustPhone.trim() || undefined,
        total_bills: 0,
        total_purchases: 0,
      });

      const initialAmt = parseFloat(newCustInitialCredit);
      if (!isNaN(initialAmt) && initialAmt > 0) {
        const now = new Date();
        const [year, month, day] = newCustDate.split("-").map(Number);
        const dateObj = new Date(
          year,
          month - 1,
          day,
          now.getHours(),
          now.getMinutes(),
          now.getSeconds(),
        );
        const finalCreatedAt = dateObj.toISOString();

        await db.addKhataTransaction(
          newCust.id,
          initialAmt,
          "Credit",
          newCustNote.trim() || "Initial Khata Setup",
          undefined,
          finalCreatedAt,
        );
      }

      setNewCustName("");
      setNewCustPhone("");
      setNewCustInitialCredit("");
      setNewCustNote("");
      setNewCustDate(new Date().toISOString().substring(0, 10));
      setShowAddCustModal(false);

      await useStore.getState().loadStoreData();
      useStore.getState().triggerSync();
      await loadLedger(newCust.id);
    } catch (err: any) {
      alert(`Failed to add customer: ${err.message || err}`);
    }
  };

  const activeKhata = khataRecords.find(
    (k) => k.customer_id === selectedCustId,
  );
  const currentCustomer = customers.find((c) => c.id === selectedCustId);

  const showList = !isMobile || !selectedCustId;
  const showDetails = !isMobile || selectedCustId;

  return (
    <div
      style={{ maxWidth: 880, margin: "0 auto" }}
      className="animate-slide-up"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <button
          onClick={
            isMobile && selectedCustId ? () => setSelectedCustId(null) : onBack
          }
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "#121017",
            border: "1px solid #2b253b",
            padding: "8px 12px",
            borderRadius: 8,
            color: "#9c97aa",
          }}
        >
          <ArrowLeft size={16} />{" "}
          {isMobile && selectedCustId ? "Back to Accounts" : "Back"}
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>
          {isMobile && selectedCustId
            ? "Customer Account"
            : "Khata Credit Ledger"}
        </h1>
      </div>

      <div className="khata-grid">
        {/* Khata list of account balances */}
        {showList && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              width: "100%",
            }}
          >
            {isMobile && (
              <div
                className="pos-card animate-slide-up"
                style={{
                  padding: "14px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "rgba(245, 158, 11, 0.05)",
                  border: "1px solid rgba(245, 158, 11, 0.2)",
                  borderRadius: 12,
                }}
              >
                <div>
                  <h4
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      color: "#f59e0b",
                      margin: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Zap size={14} /> Voice Commands Active
                  </h4>
                  <p
                    style={{
                      fontSize: 10,
                      color: "#9c97aa",
                      margin: "2px 0 0 0",
                    }}
                  >
                    Say: "Add credit 500 to [Name]" or "Paid 1000"
                  </p>
                </div>
                <button
                  type="button"
                  onClick={startKhataVoiceListening}
                  style={{
                    background: "#f59e0b",
                    color: "#0b0a0f",
                    border: "none",
                    borderRadius: "50%",
                    width: 40,
                    height: 40,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(245, 158, 11, 0.25)",
                  }}
                >
                  <Mic size={18} />
                </button>
              </div>
            )}

            <div className="pos-card" style={{ padding: 20 }}>
              <div
                className="flex-between"
                style={{ marginBottom: 12, alignItems: "center" }}
              >
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
                  Customer Accounts
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddCustModal(true)}
                  style={{
                    background: "#14b8a6",
                    color: "#0b0a0f",
                    border: "none",
                    borderRadius: 6,
                    padding: "6px 10px",
                    fontSize: 12,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    cursor: "pointer",
                  }}
                >
                  <Plus size={14} /> Add Customer
                </button>
              </div>

              {/* Premium Search Bar */}
              <div style={{ position: "relative", marginBottom: 14 }}>
                <Search
                  size={15}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#6b6880",
                    pointerEvents: "none",
                  }}
                />
                <input
                  type="text"
                  value={khataSearchQuery}
                  onChange={(e) => setKhataSearchQuery(e.target.value)}
                  placeholder="Search customer by name or phone..."
                  style={{
                    width: "100%",
                    padding: "10px 12px 10px 38px",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.09)",
                    borderRadius: 10,
                    color: "#fff",
                    fontSize: 13,
                    outline: "none",
                    boxSizing: "border-box",
                    transition: "all 0.2s",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "rgba(245,158,11,0.5)";
                    e.target.style.boxShadow =
                      "0 0 0 3px rgba(245,158,11,0.08)";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "rgba(255,255,255,0.09)";
                    e.target.style.boxShadow = "none";
                  }}
                />
                {khataSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setKhataSearchQuery("")}
                    style={{
                      position: "absolute",
                      right: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      color: "#9c97aa",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  maxHeight: 450,
                  overflowY: "auto",
                }}
              >
                {(() => {
                  const filtered = khataRecords.filter((record) => {
                    const q = khataSearchQuery.trim().toLowerCase();
                    const matchesSearch =
                      !q ||
                      record.customer_name.toLowerCase().includes(q) ||
                      (record.customer_phone &&
                        record.customer_phone.includes(q));

                    if (!q) {
                      return record.balance > 0;
                    }
                    return matchesSearch;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div
                        style={{
                          padding: "24px 0",
                          textAlign: "center",
                          color: "#9c97aa",
                          fontSize: 13,
                        }}
                      >
                        {khataSearchQuery.trim()
                          ? "No customers found matching search."
                          : "No accounts with credit balance."}
                      </div>
                    );
                  }

                  return filtered.map((record) => {
                    const initials =
                      record.customer_name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase() || "?";
                    const active = selectedCustId === record.customer_id;
                    return (
                      <div
                        key={record.customer_id}
                        onClick={() => loadLedger(record.customer_id)}
                        style={{
                          padding: "12px 14px",
                          background: active
                            ? "rgba(245, 158, 11, 0.06)"
                            : "rgba(255, 255, 255, 0.02)",
                          border: active
                            ? "1px solid #f59e0b"
                            : "1px solid rgba(255, 255, 255, 0.06)",
                          borderRadius: 10,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          transition: "all 0.2s",
                        }}
                        onMouseEnter={(e) => {
                          if (!active) {
                            e.currentTarget.style.background =
                              "rgba(255, 255, 255, 0.04)";
                            e.currentTarget.style.borderColor =
                              "rgba(255, 255, 255, 0.12)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!active) {
                            e.currentTarget.style.background =
                              "rgba(255, 255, 255, 0.02)";
                            e.currentTarget.style.borderColor =
                              "rgba(255, 255, 255, 0.06)";
                          }
                        }}
                      >
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            background:
                              record.balance > 0
                                ? "rgba(239, 68, 68, 0.1)"
                                : "rgba(20, 184, 166, 0.1)",
                            border:
                              record.balance > 0
                                ? "1px solid rgba(239, 68, 68, 0.2)"
                                : "1px solid rgba(20, 184, 166, 0.2)",
                            color: record.balance > 0 ? "#ef4444" : "#14b8a6",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 12,
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {initials}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <h4
                            style={{
                              fontWeight: 700,
                              margin: 0,
                              color: "#fff",
                              fontSize: 13,
                              textOverflow: "ellipsis",
                              overflow: "hidden",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {record.customer_name}
                          </h4>
                          <span style={{ fontSize: 11, color: "#9c97aa" }}>
                            {record.customer_phone || "No Phone"}
                          </span>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 800,
                              color: record.balance > 0 ? "#ef4444" : "#14b8a6",
                            }}
                          >
                            ₹{record.balance.toFixed(0)}
                          </span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>

              {/* Voice Input Simulator for Testing & Desktop */}
              <div
                style={{
                  borderTop: "1px solid #2b253b",
                  paddingTop: 16,
                  marginTop: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#9c97aa",
                      textTransform: "uppercase",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Mic size={12} style={{ color: "#f59e0b" }} /> Khata Voice
                    Commands
                  </span>
                  {!isMobile && (
                    <button
                      type="button"
                      onClick={startKhataVoiceListening}
                      style={{
                        background: isListeningKhata ? "#ef4444" : "#2b253b",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        padding: "4px 8px",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <Mic size={12} />{" "}
                      {isListeningKhata ? "Listening..." : "Record Voice"}
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    value={simulatedKhataText}
                    onChange={(e) => setSimulatedKhataText(e.target.value)}
                    placeholder="e.g. Ramesh paid 500 rupees"
                    style={{
                      flex: 1,
                      padding: "8px 10px",
                      fontSize: 13,
                      background: "#121017",
                      border: "1px solid #2b253b",
                      borderRadius: 6,
                      color: "#fff",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      processKhataVoiceCommand(simulatedKhataText);
                      setSimulatedKhataText("");
                    }}
                    style={{
                      padding: "8px 12px",
                      background: "#2b253b",
                      borderRadius: 6,
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 700,
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    Submit
                  </button>
                </div>
                {khataVoiceError && (
                  <span
                    style={{
                      color: "#ef4444",
                      fontSize: 11,
                      display: "block",
                      marginTop: 6,
                    }}
                  >
                    {khataVoiceError}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Ledger logs & Payment submission */}
        {showDetails && (
          <div>
            {selectedCustId ? (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 20 }}
              >
                {isMobile && (
                  <button
                    onClick={() => setSelectedCustId(null)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid #2b253b",
                      padding: "6px 12px",
                      borderRadius: 6,
                      color: "#9c97aa",
                      alignSelf: "flex-start",
                      fontSize: 12,
                    }}
                  >
                    <ArrowLeft size={14} /> Back to Accounts List
                  </button>
                )}

                {/* Profile Card / Header Card */}
                <div className="pos-card" style={{ padding: 20 }}>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 16,
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                    }}
                  >
                    {/* Left: avatar + name/phone */}
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 14 }}
                    >
                      <div
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: "50%",
                          background:
                            activeKhata && activeKhata.balance > 0
                              ? "linear-gradient(135deg, #ef4444, #b91c1c)"
                              : "linear-gradient(135deg, #14b8a6, #0d9488)",
                          color: "#fff",
                          fontSize: 18,
                          fontWeight: 800,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                          flexShrink: 0,
                        }}
                      >
                        {currentCustomer
                          ? currentCustomer.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase() || "?"
                          : "?"}
                      </div>
                      <div>
                        <h3
                          style={{
                            fontSize: 18,
                            fontWeight: 800,
                            color: "#fff",
                            margin: 0,
                          }}
                        >
                          {currentCustomer
                            ? currentCustomer.name
                            : "Account Ledger"}
                        </h3>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginTop: 4,
                            flexWrap: "wrap",
                          }}
                        >
                          <span style={{ fontSize: 12, color: "#9c97aa" }}>
                            📞 {currentCustomer?.phone || "No phone"}
                          </span>
                          {currentCustomer?.phone && (
                            <div style={{ display: "flex", gap: 6 }}>
                              <a
                                href={`tel:${currentCustomer.phone}`}
                                style={{
                                  fontSize: 11,
                                  color: "#f59e0b",
                                  textDecoration: "none",
                                  background: "rgba(245,158,11,0.1)",
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                  fontWeight: 700,
                                }}
                              >
                                Call
                              </a>
                              <a
                                href={`https://wa.me/91${currentCustomer.phone.replace(/[^0-9]/g, "")}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  fontSize: 11,
                                  color: "#25D366",
                                  textDecoration: "none",
                                  background: "rgba(37,211,102,0.1)",
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                  fontWeight: 700,
                                }}
                              >
                                WhatsApp
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Outstanding Balance */}
                    <div
                      style={{
                        background:
                          activeKhata && activeKhata.balance > 0
                            ? "rgba(239,68,68,0.08)"
                            : "rgba(20,184,166,0.08)",
                        border: `1px solid ${activeKhata && activeKhata.balance > 0 ? "rgba(239,68,68,0.25)" : "rgba(20,184,166,0.25)"}`,
                        borderRadius: 12,
                        padding: "12px 20px",
                        textAlign: "right",
                        minWidth: 140,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          color: "#9c97aa",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          marginBottom: 4,
                        }}
                      >
                        Outstanding Balance
                      </div>
                      <div
                        style={{
                          fontSize: 22,
                          fontWeight: 800,
                          color:
                            activeKhata && activeKhata.balance > 0
                              ? "#ef4444"
                              : "#14b8a6",
                        }}
                      >
                        ₹{activeKhata ? activeKhata.balance.toFixed(2) : "0.00"}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color:
                            activeKhata && activeKhata.balance > 0
                              ? "#ef4444"
                              : "#14b8a6",
                          marginTop: 2,
                          opacity: 0.7,
                        }}
                      >
                        {activeKhata && activeKhata.balance > 0
                          ? "Amount Due"
                          : "No Outstanding"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Log History */}
                <div className="pos-card" style={{ padding: 20 }}>
                  <div
                    className="flex-between"
                    style={{
                      borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                      paddingBottom: 12,
                      marginBottom: 16,
                      alignItems: "center",
                    }}
                  >
                    <h3
                      style={{
                        fontSize: 15,
                        fontWeight: 800,
                        color: "#fff",
                        margin: 0,
                      }}
                    >
                      Transaction Timeline
                    </h3>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <button
                        type="button"
                        onClick={startKhataVoiceListening}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          background: "rgba(245, 158, 11, 0.15)",
                          color: "#f59e0b",
                          border: "1px solid rgba(245, 158, 11, 0.3)",
                          fontSize: 12,
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          cursor: "pointer",
                        }}
                      >
                        <Mic size={14} /> Voice Command
                      </button>
                      {activeKhata && (
                        <button
                          onClick={handleShareKhataWhatsApp}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 6,
                            background: "#25D366",
                            color: "#fff",
                            fontSize: 12,
                            fontWeight: 700,
                            border: "none",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            cursor: "pointer",
                          }}
                          type="button"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="currentColor"
                          >
                            <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.725 1.451 5.477 0 9.932-4.455 9.935-9.93.002-2.652-1.022-5.146-2.885-7.009-1.864-1.864-4.359-2.887-7.01-2.887-5.485 0-9.94 4.457-9.944 9.932-.001 1.62.428 3.205 1.242 4.616l-.975 3.56 3.657-.968zm11.666-4.63c-.312-.156-1.848-.912-2.129-1.015-.282-.102-.487-.156-.69.156-.204.311-.788 1.015-.966 1.22-.177.205-.355.23-.667.074-1.92-.958-3.178-1.957-4.323-3.92-.302-.518.302-.481.866-1.606.094-.188.047-.353-.024-.509-.071-.156-.69-1.666-.946-2.28-.248-.599-.5-.518-.69-.527-.18-.009-.387-.01-.594-.01s-.54.077-.822.387c-.282.311-1.077 1.051-1.077 2.562 0 1.511 1.098 2.972 1.248 3.179.15.205 2.162 3.303 5.239 4.629.732.316 1.303.504 1.748.646.735.234 1.405.201 1.933.123.589-.088 1.848-.756 2.11-1.45.263-.695.263-1.291.185-1.421-.078-.13-.282-.208-.595-.364z" />
                          </svg>
                          Share Ledger
                        </button>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 0,
                      marginBottom: 6,
                      paddingRight: 6,
                    }}
                  >
                    {ledgerTxs.length === 0 ? (
                      <div
                        style={{
                          padding: "24px 0",
                          textAlign: "center",
                          color: "#9c97aa",
                          fontSize: 13,
                        }}
                      >
                        No transaction history found for this account.
                      </div>
                    ) : (
                      ledgerTxs.map((tx) => (
                        <div
                          key={tx.id}
                          style={{
                            display: "flex",
                            gap: 12,
                            padding: "12px 0",
                            borderBottom: "1px solid rgba(255,255,255,0.03)",
                            alignItems: "center",
                          }}
                        >
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: "50%",
                              background:
                                tx.amount > 0
                                  ? "rgba(239, 68, 68, 0.1)"
                                  : "rgba(20, 184, 166, 0.1)",
                              border:
                                tx.amount > 0
                                  ? "1px solid rgba(239, 68, 68, 0.2)"
                                  : "1px solid rgba(20, 184, 166, 0.2)",
                              color: tx.amount > 0 ? "#ef4444" : "#14b8a6",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 12,
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            {tx.amount > 0 ? "↗" : "↙"}
                          </div>
                          <div
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: 12,
                            }}
                          >
                            <div>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  flexWrap: "wrap",
                                }}
                              >
                                <span
                                  style={{
                                    fontWeight: 600,
                                    color: "#fff",
                                    fontSize: 13,
                                  }}
                                >
                                  {tx.description}
                                </span>
                                {tx.description.includes("Bill #") && (
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                    }}
                                  >
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleShareLedgerBillWhatsApp(
                                          tx.description,
                                          activeKhata?.customer_phone || "NA",
                                        )
                                      }
                                      style={{
                                        background: "transparent",
                                        border: "none",
                                        color: "#25D366",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        padding: 2,
                                      }}
                                      title="Share Bill on WhatsApp"
                                    >
                                      <svg
                                        viewBox="0 0 24 24"
                                        width="14"
                                        height="14"
                                        fill="currentColor"
                                      >
                                        <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.725 1.451 5.477 0 9.932-4.455 9.935-9.93.002-2.652-1.022-5.146-2.885-7.009-1.864-1.864-4.359-2.887-7.01-2.887-5.485 0-9.94 4.457-9.944 9.932-.001 1.62.428 3.205 1.242 4.616l-.975 3.56 3.657-.968zm11.666-4.63c-.312-.156-1.848-.912-2.129-1.015-.282-.102-.487-.156-.69.156-.204.311-.788 1.015-.966 1.22-.177.205-.355.23-.667.074-1.92-.958-3.178-1.957-4.323-3.92-.302-.518.302-.481.866-1.606.094-.188.047-.353-.024-.509-.071-.156-.69-1.666-.946-2.28-.248-.599-.5-.518-.69-.527-.18-.009-.387-.01-.594-.01s-.54.077-.822.387c-.282.311-1.077 1.051-1.077 2.562 0 1.511 1.098 2.972 1.248 3.179.15.205 2.162 3.303 5.239 4.629.732.316 1.303.504 1.748.646.735.234 1.405.201 1.933.123.589-.088 1.848-.756 2.11-1.45.263-.695.263-1.291.185-1.421-.078-.13-.282-.208-.595-.364z" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const match =
                                          tx.description.match(/Bill\s+#(\d+)/);
                                        if (match) {
                                          localStorage.setItem(
                                            "preselected_bill_number",
                                            match[1],
                                          );
                                          useStore
                                            .getState()
                                            .setScreen("history");
                                        }
                                      }}
                                      style={{
                                        background: "transparent",
                                        border: "none",
                                        color: "#f59e0b",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        padding: 2,
                                      }}
                                      title="View Bill in History"
                                    >
                                      <Eye size={14} />
                                    </button>
                                  </div>
                                )}
                                {tx.image_url && (
                                  <button
                                    type="button"
                                    onClick={() => setViewImageTx(tx)}
                                    style={{
                                      background: "transparent",
                                      border: "none",
                                      color: "#3b82f6",
                                      cursor: "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      padding: 2,
                                    }}
                                    title="View Attached Image"
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      width="14"
                                      height="14"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                                      <circle cx="12" cy="13" r="4" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                              <span
                                style={{
                                  display: "block",
                                  fontSize: 10,
                                  color: "#9c97aa",
                                  marginTop: 2,
                                }}
                              >
                                {new Date(tx.created_at).toLocaleDateString()}
                              </span>
                            </div>
                            <span
                              style={{
                                fontWeight: 800,
                                color: tx.amount > 0 ? "#ef4444" : "#14b8a6",
                                fontSize: 14,
                              }}
                            >
                              {tx.amount > 0
                                ? `+₹${tx.amount}`
                                : `-₹${Math.abs(tx.amount)}`}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Record Transaction Cash flow (Payment / Credit) */}
                <div className="pos-card" style={{ padding: 20 }}>
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      marginBottom: 16,
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                      paddingBottom: 12,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab("Payment");
                        setPaymentDesc("");
                        setPaymentAmount("");
                        setAttachedImage("");
                      }}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: 6,
                        background:
                          activeTab === "Payment"
                            ? "rgba(20, 184, 166, 0.12)"
                            : "transparent",
                        color: activeTab === "Payment" ? "#14b8a6" : "#9c97aa",
                        border:
                          activeTab === "Payment"
                            ? "1px solid #14b8a6"
                            : "1px solid transparent",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                        transition: "all 0.2s",
                      }}
                    >
                      Receive Payment
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab("Credit");
                        setPaymentDesc("");
                        setPaymentAmount("");
                        setAttachedImage("");
                      }}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: 6,
                        background:
                          activeTab === "Credit"
                            ? "rgba(239, 68, 68, 0.12)"
                            : "transparent",
                        color: activeTab === "Credit" ? "#ef4444" : "#9c97aa",
                        border:
                          activeTab === "Credit"
                            ? "1px solid #ef4444"
                            : "1px solid transparent",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                        transition: "all 0.2s",
                      }}
                    >
                      Increase Credit
                    </button>
                  </div>

                  <form
                    onSubmit={handleTransactionSubmit}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#9c97aa",
                        }}
                      >
                        {activeTab === "Payment"
                          ? "Amount Paid (₹)"
                          : "Credit Amount to Add (₹)"}
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        placeholder={
                          activeTab === "Payment" ? "e.g. 500" : "e.g. 1000"
                        }
                        required
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          fontSize: 13,
                          background: "rgba(255,255,255,0.02)",
                          border: "1px solid rgba(255,255,255,0.09)",
                          borderRadius: 10,
                          color: "#fff",
                          outline: "none",
                          boxSizing: "border-box",
                          transition: "all 0.2s",
                        }}
                        onFocus={(e) => {
                          e.target.style.borderColor =
                            activeTab === "Payment" ? "#14b8a6" : "#ef4444";
                          e.target.style.boxShadow =
                            activeTab === "Payment"
                              ? "0 0 0 3px rgba(20,184,166,0.08)"
                              : "0 0 0 3px rgba(239,68,68,0.08)";
                        }}
                        onBlur={(e) => {
                          e.target.style.borderColor = "rgba(255,255,255,0.09)";
                          e.target.style.boxShadow = "none";
                        }}
                      />
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#9c97aa",
                        }}
                      >
                        Notes / Description
                      </label>
                      <input
                        type="text"
                        value={paymentDesc}
                        onChange={(e) => setPaymentDesc(e.target.value)}
                        placeholder={
                          activeTab === "Payment"
                            ? "e.g. Cash payment received"
                            : "e.g. Purchased items, custom balance increase"
                        }
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          fontSize: 13,
                          background: "rgba(255,255,255,0.02)",
                          border: "1px solid rgba(255,255,255,0.09)",
                          borderRadius: 10,
                          color: "#fff",
                          outline: "none",
                          boxSizing: "border-box",
                          transition: "all 0.2s",
                        }}
                        onFocus={(e) => {
                          e.target.style.borderColor =
                            activeTab === "Payment" ? "#14b8a6" : "#ef4444";
                          e.target.style.boxShadow =
                            activeTab === "Payment"
                              ? "0 0 0 3px rgba(20,184,166,0.08)"
                              : "0 0 0 3px rgba(239,68,68,0.08)";
                        }}
                        onBlur={(e) => {
                          e.target.style.borderColor = "rgba(255,255,255,0.09)";
                          e.target.style.boxShadow = "none";
                        }}
                      />
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#9c97aa",
                        }}
                      >
                        Transaction Date
                      </label>
                      <input
                        type="date"
                        value={txDate}
                        onChange={(e) => setTxDate(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          fontSize: 13,
                          background: "rgba(255,255,255,0.02)",
                          border: "1px solid rgba(255,255,255,0.09)",
                          borderRadius: 10,
                          color: "#fff",
                          outline: "none",
                          boxSizing: "border-box",
                          transition: "all 0.2s",
                        }}
                        onFocus={(e) => {
                          e.target.style.borderColor =
                            activeTab === "Payment" ? "#14b8a6" : "#ef4444";
                          e.target.style.boxShadow =
                            activeTab === "Payment"
                              ? "0 0 0 3px rgba(20,184,166,0.08)"
                              : "0 0 0 3px rgba(239,68,68,0.08)";
                        }}
                        onBlur={(e) => {
                          e.target.style.borderColor = "rgba(255,255,255,0.09)";
                          e.target.style.boxShadow = "none";
                        }}
                      />
                    </div>

                    {/* Image Attachment (Camera / Gallery) */}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#9c97aa",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span>Attach Receipt / Proof Image (Optional)</span>
                        {attachedImage && (
                          <button
                            type="button"
                            onClick={() => setAttachedImage("")}
                            style={{
                              background: "transparent",
                              color: "#ef4444",
                              fontSize: 11,
                              border: "none",
                              cursor: "pointer",
                              padding: 0,
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </label>

                      {!attachedImage ? (
                        <div style={{ position: "relative", width: "100%" }}>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                  setAttachedImage(reader.result as string);
                                };
                                reader.readAsDataURL(file);
                              }
                            }}
                            style={{
                              width: "100%",
                              padding: "10px 12px",
                              fontSize: 12,
                              background: "rgba(255,255,255,0.02)",
                              border: "1px solid rgba(255,255,255,0.09)",
                              borderRadius: 10,
                              color: "#9c97aa",
                              cursor: "pointer",
                              outline: "none",
                            }}
                          />
                        </div>
                      ) : (
                        <div
                          style={{
                            position: "relative",
                            width: 80,
                            height: 80,
                            borderRadius: 6,
                            overflow: "hidden",
                            border: "1px solid #2b253b",
                            marginTop: 4,
                          }}
                        >
                          <img
                            src={attachedImage}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                            }}
                            alt="Attachment Preview"
                          />
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      style={{
                        padding: 12,
                        background:
                          activeTab === "Payment"
                            ? "linear-gradient(135deg, #14b8a6, #0d9488)"
                            : "linear-gradient(135deg, #ef4444, #b91c1c)",
                        color: activeTab === "Payment" ? "#0b0a0f" : "#fff",
                        borderRadius: 8,
                        fontWeight: 800,
                        marginTop: 8,
                        border: "none",
                        cursor: "pointer",
                        transition: "all 0.2s",
                        boxShadow:
                          activeTab === "Payment"
                            ? "0 4px 12px rgba(20,184,166,0.2)"
                            : "0 4px 12px rgba(239,68,68,0.2)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "translateY(-1px)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "translateY(0)";
                      }}
                    >
                      {activeTab === "Payment"
                        ? "✓ Submit Cash Payment"
                        : "+ Increase Customer Credit"}
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              <div
                className="pos-card"
                style={{
                  padding: 32,
                  textAlign: "center",
                  color: "#9c97aa",
                  borderStyle: "dashed",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 200,
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 32 }}>👤</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
                  No Account Selected
                </div>
                <div style={{ fontSize: 12, color: "#9c97aa", maxWidth: 260 }}>
                  Select a customer account to view transactional credit log
                  records and process payments.
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* FULL-SIZE IMAGE PREVIEW MODAL */}
      {viewImageTx && (
        <div
          onClick={() => setViewImageTx(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 480,
              background: "#121017",
              border: "1px solid #2b253b",
              padding: 20,
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div
              className="flex-between"
              style={{ borderBottom: "1px solid #2b253b", paddingBottom: 10 }}
            >
              <div>
                <h4 style={{ fontWeight: 800, fontSize: 15 }}>
                  {viewImageTx.description}
                </h4>
                <span style={{ fontSize: 11, color: "#9c97aa" }}>
                  {new Date(viewImageTx.created_at).toLocaleString()}
                </span>
              </div>
              <button
                onClick={() => setViewImageTx(null)}
                style={{
                  background: "transparent",
                  color: "#9c97aa",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div
              style={{
                width: "100%",
                maxHeight: 400,
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid #2b253b",
                display: "flex",
                justifyContent: "center",
                background: "#0b0a0f",
              }}
            >
              <img
                src={viewImageTx.image_url}
                style={{
                  maxWidth: "100%",
                  maxHeight: 400,
                  objectFit: "contain",
                }}
                alt="Full Attachment"
              />
            </div>

            <div className="flex-between" style={{ fontSize: 13 }}>
              <span style={{ color: "#9c97aa" }}>Transaction Amount:</span>
              <span
                style={{
                  fontWeight: 800,
                  color: viewImageTx.amount > 0 ? "#ef4444" : "#14b8a6",
                }}
              >
                {viewImageTx.amount > 0
                  ? `+₹${viewImageTx.amount.toFixed(2)}`
                  : `-₹${Math.abs(viewImageTx.amount).toFixed(2)}`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* VOICE SEARCH DISAMBIGUATION MODAL */}
      {voiceDisambiguationList.length > 0 && (
        <div
          onClick={() => {
            setVoiceDisambiguationList([]);
            setPendingVoiceAction(null);
          }}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 120,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 400,
              background: "#121017",
              border: "1px solid #2b253b",
              padding: 24,
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{ textAlign: "center" }}>
              <h3
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  margin: 0,
                  color: "#f59e0b",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                👤 Select Customer
              </h3>
              <p style={{ fontSize: 13, color: "#9c97aa", marginTop: 4 }}>
                Multiple customers found with the name "
                {pendingVoiceAction?.customerName}". Please choose the correct
                customer.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                maxHeight: 240,
                overflowY: "auto",
              }}
            >
              {voiceDisambiguationList.map((cust) => (
                <button
                  key={cust.id}
                  onClick={async () => {
                    const selectedCust = cust;
                    const action = pendingVoiceAction;
                    setVoiceDisambiguationList([]);
                    setPendingVoiceAction(null);
                    if (action) {
                      await executeVoiceAction(selectedCust, action);
                    }
                  }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 4,
                    background: "#181520",
                    border: "1px solid #2b253b",
                    borderRadius: 8,
                    padding: "12px 16px",
                    color: "#fff",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#f59e0b";
                    e.currentTarget.style.background = "#231e2e";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "#2b253b";
                    e.currentTarget.style.background = "#181520";
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 700 }}>
                    {cust.name}
                  </span>
                  <span style={{ fontSize: 11, color: "#9c97aa" }}>
                    📞 {cust.phone || "No Phone Number"}
                  </span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                setVoiceDisambiguationList([]);
                setPendingVoiceAction(null);
              }}
              style={{
                padding: "8px 16px",
                background: "#2b253b",
                color: "#fff",
                borderRadius: 8,
                fontSize: 13,
                border: "none",
                cursor: "pointer",
                alignSelf: "center",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ADD CUSTOMER MODAL */}
      {showAddCustModal && (
        <div
          onClick={() => setShowAddCustModal(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 101,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 400,
              background: "#121017",
              border: "1px solid #2b253b",
              padding: 24,
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div
              className="flex-between"
              style={{ borderBottom: "1px solid #2b253b", paddingBottom: 10 }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>
                Add New Khata Customer
              </h3>
              <button
                onClick={() => setShowAddCustModal(false)}
                style={{
                  background: "transparent",
                  color: "#9c97aa",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={handleAddCustomerSubmit}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label
                  style={{ fontSize: 11, fontWeight: 700, color: "#9c97aa" }}
                >
                  Customer Name *
                </label>
                <input
                  type="text"
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  placeholder="e.g. Ramesh Prasad"
                  required
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    fontSize: 13,
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.09)",
                    borderRadius: 10,
                    color: "#fff",
                    outline: "none",
                    boxSizing: "border-box",
                    transition: "all 0.2s",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "#14b8a6";
                    e.target.style.boxShadow =
                      "0 0 0 3px rgba(20,184,166,0.08)";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "rgba(255,255,255,0.09)";
                    e.target.style.boxShadow = "none";
                  }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label
                  style={{ fontSize: 11, fontWeight: 700, color: "#9c97aa" }}
                >
                  Phone Number (Optional)
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="text"
                    value={newCustPhone}
                    onChange={(e) => setNewCustPhone(e.target.value)}
                    placeholder="e.g. 9876543210"
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      fontSize: 13,
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.09)",
                      borderRadius: 10,
                      color: "#fff",
                      outline: "none",
                      boxSizing: "border-box",
                      transition: "all 0.2s",
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = "#14b8a6";
                      e.target.style.boxShadow =
                        "0 0 0 3px rgba(20,184,166,0.08)";
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = "rgba(255,255,255,0.09)";
                      e.target.style.boxShadow = "none";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      handlePickContact((name, phone) => {
                        setNewCustPhone(phone);
                        if (name) setNewCustName(name);
                      })
                    }
                    style={{
                      background: "#181520",
                      border: "1px solid rgba(255,255,255,0.09)",
                      borderRadius: 10,
                      padding: "8px 12px",
                      color: "#f59e0b",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: 38,
                    }}
                    title="Pick from Contacts"
                  >
                    👤
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label
                  style={{ fontSize: 11, fontWeight: 700, color: "#9c97aa" }}
                >
                  Initial Credit Balance (₹, Optional)
                </label>
                <input
                  type="number"
                  step="any"
                  value={newCustInitialCredit}
                  onChange={(e) => setNewCustInitialCredit(e.target.value)}
                  placeholder="e.g. 500 (leave empty if 0)"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    fontSize: 13,
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.09)",
                    borderRadius: 10,
                    color: "#fff",
                    outline: "none",
                    boxSizing: "border-box",
                    transition: "all 0.2s",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "#14b8a6";
                    e.target.style.boxShadow =
                      "0 0 0 3px rgba(20,184,166,0.08)";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "rgba(255,255,255,0.09)";
                    e.target.style.boxShadow = "none";
                  }}
                />
              </div>

              {parseFloat(newCustInitialCredit) > 0 && (
                <>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 4 }}
                  >
                    <label
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#9c97aa",
                      }}
                    >
                      Transaction Date *
                    </label>
                    <input
                      type="date"
                      value={newCustDate}
                      onChange={(e) => setNewCustDate(e.target.value)}
                      required
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        fontSize: 13,
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.09)",
                        borderRadius: 10,
                        color: "#fff",
                        outline: "none",
                        boxSizing: "border-box",
                        transition: "all 0.2s",
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = "#14b8a6";
                        e.target.style.boxShadow =
                          "0 0 0 3px rgba(20,184,166,0.08)";
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = "rgba(255,255,255,0.09)";
                        e.target.style.boxShadow = "none";
                      }}
                    />
                  </div>

                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 4 }}
                  >
                    <label
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#9c97aa",
                      }}
                    >
                      Initial Note / Description *
                    </label>
                    <input
                      type="text"
                      value={newCustNote}
                      onChange={(e) => setNewCustNote(e.target.value)}
                      placeholder="e.g. Initial Khata Setup / Balance Forward"
                      required
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        fontSize: 13,
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.09)",
                        borderRadius: 10,
                        color: "#fff",
                        outline: "none",
                        boxSizing: "border-box",
                        transition: "all 0.2s",
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = "#14b8a6";
                        e.target.style.boxShadow =
                          "0 0 0 3px rgba(20,184,166,0.08)";
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = "rgba(255,255,255,0.09)";
                        e.target.style.boxShadow = "none";
                      }}
                    />
                  </div>
                </>
              )}

              <button
                type="submit"
                style={{
                  padding: 12,
                  background: "#14b8a6",
                  color: "#0b0a0f",
                  borderRadius: 8,
                  fontWeight: 700,
                  marginTop: 8,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Create Account
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Listening / Processing Voice Modal overlay */}
      {showKhataVoiceModal && (
        <div
          onClick={() => {
            if (khataRecognitionRef.current) khataRecognitionRef.current.stop();
            setIsListeningKhata(false);
            setShowKhataVoiceModal(false);
          }}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 110,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 400,
              background: "#121017",
              border: "1px solid #2b253b",
              padding: 24,
              borderRadius: 12,
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
            }}
          >
            <h3
              style={{
                fontSize: 18,
                fontWeight: 800,
                margin: 0,
                color: "#f59e0b",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Mic size={20} /> Voice Assistant
            </h3>

            <div
              style={{
                display: "inline-block",
                position: "relative",
                margin: "12px 0",
              }}
            >
              <button
                type="button"
                onClick={startKhataVoiceListening}
                className={isListeningKhata ? "animate-pulse-gold" : ""}
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: "50%",
                  background: isListeningKhata ? "#ef4444" : "#f59e0b",
                  color: "#0b0a0f",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "none",
                  cursor: "pointer",
                  boxShadow: isListeningKhata
                    ? "0 0 20px rgba(239,68,68,0.4)"
                    : "0 0 20px rgba(245,158,11,0.3)",
                }}
              >
                {isListeningKhata ? <MicOff size={24} /> : <Mic size={24} />}
              </button>
            </div>

            <span style={{ fontSize: 14, fontWeight: 700 }}>
              {isListeningKhata
                ? "Listening... Speak Now"
                : "Click Mic to Restart"}
            </span>

            {khataTranscript && (
              <p
                style={{
                  fontSize: 13,
                  color: "#f59e0b",
                  background: "#181520",
                  border: "1px solid #2b253b",
                  padding: "10px 14px",
                  borderRadius: 8,
                  fontFamily: "monospace",
                  width: "100%",
                  margin: 0,
                }}
              >
                "{khataTranscript}"
              </p>
            )}

            {khataVoiceError && (
              <span
                style={{
                  color: "#ef4444",
                  fontSize: 12,
                  padding: "4px 10px",
                  background: "rgba(239,68,68,0.1)",
                  borderRadius: 6,
                }}
              >
                {khataVoiceError}
              </span>
            )}

            <button
              type="button"
              onClick={() => {
                if (khataRecognitionRef.current)
                  khataRecognitionRef.current.stop();
                setIsListeningKhata(false);
                setShowKhataVoiceModal(false);
              }}
              style={{
                padding: "8px 16px",
                background: "#2b253b",
                color: "#fff",
                borderRadius: 8,
                fontSize: 13,
                border: "none",
                cursor: "pointer",
                marginTop: 8,
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Detailed Account Summary Modal overlay */}
      {khataSummaryData && (
        <div
          onClick={() => setKhataSummaryData(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 110,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="pos-card animate-scale-up"
            style={{
              width: "100%",
              maxWidth: 440,
              background: "#121017",
              border: "1px solid #2b253b",
              padding: 24,
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div
              className="flex-between"
              style={{ borderBottom: "1px solid #2b253b", paddingBottom: 10 }}
            >
              <h3
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  margin: 0,
                  color: "#f59e0b",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <User size={18} /> Customer Khata Summary
              </h3>
              <button
                type="button"
                onClick={() => setKhataSummaryData(null)}
                style={{
                  background: "transparent",
                  color: "#9c97aa",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Account Card Details */}
            <div
              style={{
                background: "#181520",
                padding: 16,
                borderRadius: 10,
                border: "1px solid #2b253b",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "#9c97aa",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                Customer Info
              </span>
              <h2
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  margin: "4px 0 2px 0",
                  color: "#fff",
                }}
              >
                {khataSummaryData.customer.name}
              </h2>
              <span style={{ fontSize: 12, color: "#9c97aa" }}>
                {khataSummaryData.customer.phone || "No Phone Registered"}
              </span>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: "1px solid #2b253b",
                }}
              >
                <span
                  style={{ fontSize: 13, color: "#9c97aa", fontWeight: 600 }}
                >
                  Total Outstanding:
                </span>
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: khataSummaryData.balance > 0 ? "#ef4444" : "#14b8a6",
                  }}
                >
                  ₹{khataSummaryData.balance.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Latest Bill row if exists */}
            {khataSummaryData.latestBill && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "rgba(245, 158, 11, 0.04)",
                  border: "1px solid rgba(245, 158, 11, 0.1)",
                  padding: 12,
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                <div>
                  <span style={{ color: "#9c97aa", display: "block" }}>
                    Latest Purchase:
                  </span>
                  <strong style={{ color: "#fff" }}>
                    Bill #{khataSummaryData.latestBill.bill_number}
                  </strong>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ color: "#9c97aa", display: "block" }}>
                    {new Date(
                      khataSummaryData.latestBill.created_at,
                    ).toLocaleDateString()}
                  </span>
                  <strong style={{ color: "#f59e0b" }}>
                    ₹{khataSummaryData.latestBill.grand_total.toFixed(2)}
                  </strong>
                </div>
              </div>
            )}

            {/* Recent transactions log */}
            <div>
              <span
                style={{
                  fontSize: 11,
                  color: "#9c97aa",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  display: "block",
                  marginBottom: 8,
                }}
              >
                Recent Log entries
              </span>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  maxHeight: 120,
                  overflowY: "auto",
                }}
              >
                {khataSummaryData.transactions.slice(0, 3).map((tx: any) => (
                  <div
                    key={tx.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: 12,
                      padding: "4px 0",
                      borderBottom: "1px solid #2b253b",
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, color: "#fff" }}>
                        {tx.description}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 9,
                          color: "#9c97aa",
                        }}
                      >
                        {new Date(tx.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <span
                      style={{
                        fontWeight: 700,
                        color: tx.amount > 0 ? "#ef4444" : "#14b8a6",
                      }}
                    >
                      {tx.amount > 0
                        ? `+₹${tx.amount}`
                        : `-₹${Math.abs(tx.amount)}`}
                    </span>
                  </div>
                ))}
                {khataSummaryData.transactions.length === 0 && (
                  <div
                    style={{
                      padding: 10,
                      textAlign: "center",
                      fontSize: 12,
                      color: "#9c97aa",
                    }}
                  >
                    No transactions recorded yet.
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setKhataSummaryData(null);
                  setSelectedCustId(khataSummaryData.customer.id);
                }}
                style={{
                  flex: 1,
                  padding: 12,
                  background: "linear-gradient(135deg, #f59e0b, #d97706)",
                  color: "#0b0a0f",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                Open Full Ledger
              </button>
              <button
                type="button"
                onClick={() => setKhataSummaryData(null)}
                style={{
                  padding: 12,
                  background: "#2b253b",
                  color: "#fff",
                  borderRadius: 8,
                  fontSize: 13,
                  border: "1px solid #2b253b",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// SCREEN 10: ANALYTICS REPORTS
// ----------------------------------------------------
function ReportsScreen({ onBack }: { onBack: () => void }) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [khataBal, setKhataBal] = useState<number>(0);

  useEffect(() => {
    db.getBills().then(setBills);
    db.getKhataBalances().then((records) => {
      const sum = records.reduce((s, r) => s + r.balance, 0);
      setKhataBal(sum);
    });
  }, []);

  // Compute daily numbers
  const activeBills = bills.filter((b) => b.status !== "Cancelled");
  const totalBills = activeBills.length;

  const cashSales = activeBills
    .filter((b) => b.payment_mode === "Cash")
    .reduce((s, b) => s + b.grand_total, 0);
  const upiSales = activeBills
    .filter((b) => b.payment_mode === "UPI")
    .reduce((s, b) => s + b.grand_total, 0);
  const creditSales = activeBills
    .filter((b) => b.payment_mode === "Credit")
    .reduce((s, b) => s + b.grand_total, 0);
  const grandTotalSales = cashSales + upiSales + creditSales;

  return (
    <div
      style={{ maxWidth: 880, margin: "0 auto" }}
      className="animate-slide-up"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <button
          onClick={onBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "#121017",
            border: "1px solid #2b253b",
            padding: "8px 12px",
            borderRadius: 8,
            color: "#9c97aa",
          }}
        >
          <ArrowLeft size={16} /> Back
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>Business Reports</h1>
      </div>

      <div className="reports-summary-grid">
        <div
          className="pos-card"
          style={{ padding: 16, borderLeft: "4px solid #f59e0b" }}
        >
          <span
            style={{
              fontSize: 11,
              color: "#9c97aa",
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            Gross Sales
          </span>
          <h2 style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
            ₹{grandTotalSales.toFixed(0)}
          </h2>
        </div>
        <div
          className="pos-card"
          style={{ padding: 16, borderLeft: "4px solid #14b8a6" }}
        >
          <span
            style={{
              fontSize: 11,
              color: "#9c97aa",
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            Cash Sales
          </span>
          <h2 style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
            ₹{cashSales.toFixed(0)}
          </h2>
        </div>
        <div
          className="pos-card"
          style={{ padding: 16, borderLeft: "4px solid #3b82f6" }}
        >
          <span
            style={{
              fontSize: 11,
              color: "#9c97aa",
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            UPI Sales
          </span>
          <h2 style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
            ₹{upiSales.toFixed(0)}
          </h2>
        </div>
        <div
          className="pos-card"
          style={{ padding: 16, borderLeft: "4px solid #ec4899" }}
        >
          <span
            style={{
              fontSize: 11,
              color: "#9c97aa",
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            Khata Credit Dues
          </span>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 800,
              marginTop: 4,
              color: "#ef4444",
            }}
          >
            ₹{khataBal.toFixed(0)}
          </h2>
        </div>
      </div>

      <div className="pos-card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
          Daily Sales Distribution
        </h3>

        {/* Custom SVG graph rendering */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "100%",
          }}
        >
          <svg
            viewBox="0 0 400 240"
            style={{
              width: "100%",
              maxWidth: "400px",
              height: "auto",
              background: "#121017",
              borderRadius: 8,
              padding: 10,
            }}
          >
            {/* Grid Lines */}
            <line
              x1="50"
              y1="30"
              x2="350"
              y2="30"
              stroke="#2b253b"
              strokeDasharray="4"
            />
            <line
              x1="50"
              y1="90"
              x2="350"
              y2="90"
              stroke="#2b253b"
              strokeDasharray="4"
            />
            <line
              x1="50"
              y1="150"
              x2="350"
              y2="150"
              stroke="#2b253b"
              strokeDasharray="4"
            />
            <line x1="50" y1="210" x2="350" y2="210" stroke="#2b253b" />

            {/* Simulated bar chart logic */}
            {/* Cash Bar (14b8a6) */}
            <rect
              x="80"
              y={
                grandTotalSales > 0
                  ? 210 - (cashSales / grandTotalSales) * 160
                  : 210
              }
              width="50"
              height={
                grandTotalSales > 0 ? (cashSales / grandTotalSales) * 160 : 0
              }
              fill="#14b8a6"
              rx="4"
            />
            {/* UPI Bar (3b82f6) */}
            <rect
              x="170"
              y={
                grandTotalSales > 0
                  ? 210 - (upiSales / grandTotalSales) * 160
                  : 210
              }
              width="50"
              height={
                grandTotalSales > 0 ? (upiSales / grandTotalSales) * 160 : 0
              }
              fill="#3b82f6"
              rx="4"
            />
            {/* Credit Bar (ec4899) */}
            <rect
              x="260"
              y={
                grandTotalSales > 0
                  ? 210 - (creditSales / grandTotalSales) * 160
                  : 210
              }
              width="50"
              height={
                grandTotalSales > 0 ? (creditSales / grandTotalSales) * 160 : 0
              }
              fill="#ec4899"
              rx="4"
            />

            {/* Labels */}
            <text
              x="105"
              y="230"
              fill="#9c97aa"
              fontSize="11"
              textAnchor="middle"
              fontFamily="sans-serif"
            >
              CASH
            </text>
            <text
              x="195"
              y="230"
              fill="#9c97aa"
              fontSize="11"
              textAnchor="middle"
              fontFamily="sans-serif"
            >
              UPI
            </text>
            <text
              x="285"
              y="230"
              fill="#9c97aa"
              fontSize="11"
              textAnchor="middle"
              fontFamily="sans-serif"
            >
              CREDIT
            </text>
          </svg>
          <div style={{ display: "flex", gap: 20, marginTop: 16 }}>
            <span style={{ fontSize: 13, color: "#9c97aa" }}>
              Total bills generated today: <b>{totalBills} bills</b>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// SCREEN 11: SYSTEM SETTINGS
// ----------------------------------------------------
interface SettingsProps {
  storeName: string;
  upiId: string;
  printerConfig: PrinterConfig;
  onSave: (config: any) => void;
  onTestPrint: () => Promise<boolean>;
  onBack: () => void;
}

function SettingsScreen({
  storeName,
  upiId,
  printerConfig,
  onSave,
  onTestPrint,
  onBack,
}: SettingsProps) {
  const {
    printerStatus,
    pairedPrinters,
    isScanning,
    autoConnect,
    scanBluetoothDevices,
    connectPrinter,
    disconnectPrinter,
    reconnectPrinter,
    toggleAutoConnect,
    isSyncing,
  } = useStore();

  const [store, setStore] = useState(storeName);
  const [upi, setUpi] = useState(upiId);
  const [upiQrImage, setUpiQrImage] = useState<string | undefined>(
    printerConfig.upi_qr_image,
  );
  const [qrDetected, setQrDetected] = useState<string | null>(null);
  const [qrProcessing, setQrProcessing] = useState(false);
  const qrFileRef = useRef<HTMLInputElement>(null);

  const [printerMac, setPrinterMac] = useState(
    printerConfig.printer_mac || "DC:0D:30:06:49:9C",
  );
  const [printerName, setPrinterName] = useState(
    printerConfig.printer_name || "BlueTooth Printer",
  );
  const [qrSize, setQrSize] = useState(printerConfig.qr_size || 8);

  const [saved, setSaved] = useState(false);

  // Decode QR from an image (dataURL) using jsQR via dynamic import
  const decodeQRFromImage = async (dataUrl: string): Promise<string | null> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        // Try jsQR if available (loaded via script tag)
        const jsQR = (window as any).jsQR;
        if (jsQR) {
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });
          resolve(code ? code.data : null);
        } else {
          // jsQR not loaded yet — load it dynamically
          const script = document.createElement("script");
          script.src =
            "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
          script.onload = () => {
            const jsQRLoaded = (window as any).jsQR;
            if (jsQRLoaded) {
              const code2 = jsQRLoaded(
                imageData.data,
                imageData.width,
                imageData.height,
                {
                  inversionAttempts: "dontInvert",
                },
              );
              resolve(code2 ? code2.data : null);
            } else {
              resolve(null);
            }
          };
          script.onerror = () => resolve(null);
          document.head.appendChild(script);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  };

  const handleQrImageFile = async (file: File) => {
    setQrProcessing(true);
    setQrDetected(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setUpiQrImage(dataUrl);
      const qrData = await decodeQRFromImage(dataUrl);
      if (qrData) {
        setQrDetected(qrData);
        if (/^upi:\/\/pay\?/i.test(qrData.trim())) {
          setUpi(qrData.trim());
        } else {
          const vpaMatch = qrData.match(/pa=([^&]+)/);
          if (vpaMatch && vpaMatch[1]) {
            setUpi(decodeURIComponent(vpaMatch[1]));
          }
        }
      } else {
        setQrDetected(null);
      }
      setQrProcessing(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    onSave({
      store_name: store,
      upi_id: upi,
      printer_name: printerName,
      printer_mac: printerMac,
      upi_qr_image: upiQrImage,
      qr_size: qrSize,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTestPrint = async () => {
    const ok = await onTestPrint();
    if (ok) {
      alert("Test print receipt triggered successfully.");
    } else {
      alert(
        "Failed to send print command. Please check if the printer is connected.",
      );
    }
  };

  return (
    <div
      style={{ maxWidth: 540, margin: "0 auto" }}
      className="animate-slide-up"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <button
          onClick={onBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "#121017",
            border: "1px solid #2b253b",
            padding: "8px 12px",
            borderRadius: 8,
            color: "#9c97aa",
          }}
        >
          <ArrowLeft size={16} /> Back
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>POS Settings</h1>
      </div>

      <div className="pos-card" style={{ padding: 24 }}>
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#9c97aa",
                textTransform: "uppercase",
              }}
            >
              Store Name Banner
            </label>
            <input
              type="text"
              value={store}
              onChange={(e) => setStore(e.target.value)}
              required
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#9c97aa",
                textTransform: "uppercase",
              }}
            >
              Store UPI VPA / Payment URI
            </label>
            <input
              type="text"
              value={upi}
              onChange={(e) => setUpi(e.target.value)}
              placeholder="upi://pay?... or name@bank"
              required
            />
          </div>

          {/* UPI QR Photo Section */}
          <div
            style={{
              background: "#0e0c17",
              border: "1px solid #2b253b",
              borderRadius: 12,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{ fontSize: 12, fontWeight: 700, color: "#d1cee0" }}
                >
                  UPI QR Code Photo
                </div>
                <div style={{ fontSize: 11, color: "#6b6880", marginTop: 2 }}>
                  Upload your UPI QR code — it will appear on bills for
                  customers to scan
                </div>
              </div>
              {upiQrImage && (
                <button
                  type="button"
                  onClick={() => {
                    setUpiQrImage(undefined);
                    setQrDetected(null);
                  }}
                  style={{
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid #ef4444",
                    color: "#ef4444",
                    borderRadius: 8,
                    padding: "4px 10px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              )}
            </div>

            {upiQrImage ? (
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    background: "#fff",
                    padding: 8,
                    borderRadius: 8,
                    border: "2px solid #6d28d9",
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={upiQrImage}
                    alt="UPI QR"
                    style={{
                      width: 120,
                      height: 120,
                      objectFit: "contain",
                      display: "block",
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  {qrProcessing && (
                    <div style={{ fontSize: 12, color: "#f59e0b" }}>
                      📷 Detecting QR code...
                    </div>
                  )}
                  {qrDetected !== null && !qrProcessing && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "#22c55e",
                        background: "rgba(34,197,94,0.08)",
                        border: "1px solid rgba(34,197,94,0.3)",
                        borderRadius: 6,
                        padding: "6px 10px",
                        marginBottom: 8,
                      }}
                    >
                      ✅ QR Detected!
                      <br />
                      <span
                        style={{
                          fontFamily: "monospace",
                          wordBreak: "break-all",
                          fontSize: 10,
                        }}
                      >
                        {qrDetected}
                      </span>
                    </div>
                  )}
                  {qrDetected === null && !qrProcessing && upiQrImage && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "#f59e0b",
                        background: "rgba(245,158,11,0.08)",
                        border: "1px solid rgba(245,158,11,0.3)",
                        borderRadius: 6,
                        padding: "6px 10px",
                        marginBottom: 8,
                      }}
                    >
                      ⚠️ Could not auto-detect QR data.
                      <br />
                      Make sure the photo is clear &amp; well-lit.
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => qrFileRef.current?.click()}
                    style={{
                      fontSize: 12,
                      padding: "6px 12px",
                      background: "#1c1926",
                      border: "1px solid #3b3550",
                      borderRadius: 8,
                      color: "#a78bfa",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Change Photo
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => qrFileRef.current?.click()}
                  style={{
                    flex: 1,
                    padding: "12px 8px",
                    background: "#1c1926",
                    border: "2px dashed #3b3550",
                    borderRadius: 10,
                    color: "#a78bfa",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  🖼️ Upload from Gallery
                </button>
              </div>
            )}

            {/* Hidden file input */}
            <input
              ref={qrFileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleQrImageFile(file);
                e.target.value = "";
              }}
            />
          </div>

          <div
            style={{
              borderTop: "1px solid #2b253b",
              paddingTop: 16,
              marginTop: 4,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
                Bluetooth Thermal Printer Settings
              </h3>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "4px 8px",
                  borderRadius: 6,
                  background:
                    printerStatus === "Connected"
                      ? "rgba(34,197,94,0.15)"
                      : printerStatus === "Connecting"
                        ? "rgba(245,158,11,0.15)"
                        : "rgba(239,68,68,0.15)",
                  color:
                    printerStatus === "Connected"
                      ? "#22c55e"
                      : printerStatus === "Connecting"
                        ? "#f59e0b"
                        : "#ef4444",
                  border: `1px solid ${printerStatus === "Connected" ? "#22c55e" : printerStatus === "Connecting" ? "#f59e0b" : "#ef4444"}`,
                }}
              >
                {printerStatus === "Connected"
                  ? "🟢 Connected"
                  : printerStatus === "Connecting"
                    ? "🟡 Connecting..."
                    : "🔴 Disconnected"}
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 12,
                marginBottom: 14,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 11, color: "#9c97aa" }}>
                  Printer MAC Address
                </label>
                <input
                  type="text"
                  value={printerMac}
                  onChange={(e) => setPrinterMac(e.target.value)}
                  placeholder="e.g. 00:11:22:33:44:55"
                  required
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 11, color: "#9c97aa" }}>
                  Printer Model
                </label>
                <input
                  type="text"
                  value={printerName}
                  onChange={(e) => setPrinterName(e.target.value)}
                  required
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 11, color: "#9c97aa" }}>
                  UPI QR Print Size
                </label>
                <select
                  value={qrSize}
                  onChange={(e) => setQrSize(parseInt(e.target.value, 10))}
                  style={{
                    padding: "8px 10px",
                    background: "#121017",
                    border: "1px solid #2b253b",
                    borderRadius: 8,
                    color: "#fff",
                    outline: "none",
                    fontSize: 13,
                    height: 38,
                  }}
                >
                  <option value={6}>6 (Small - 58mm)</option>
                  <option value={8}>8 (Medium)</option>
                  <option value={10}>10 (Large - Default)</option>
                  <option value={12}>12 (Extra Large)</option>
                  <option value={14}>14 (Double Large)</option>
                  <option value={16}>16 (Max - 80mm)</option>
                </select>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  color: "#d1cee0",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={autoConnect}
                  onChange={toggleAutoConnect}
                  style={{ width: 16, height: 16, cursor: "pointer" }}
                />
                <span>Auto-Connect on App Start</span>
              </label>

              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                {printerStatus !== "Connected" ? (
                  <button
                    type="button"
                    onClick={() => connectPrinter(printerMac, printerName)}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      background: "#22c55e",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Connect
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={disconnectPrinter}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      background: "#ef4444",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Disconnect
                  </button>
                )}

                <button
                  type="button"
                  onClick={reconnectPrinter}
                  style={{
                    padding: "8px 12px",
                    background: "#2b253b",
                    border: "1px solid #3d3750",
                    color: "#fff",
                    borderRadius: 8,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                  disabled={printerStatus === "Connecting"}
                >
                  🔄 Reconnect
                </button>

                <button
                  type="button"
                  onClick={handleTestPrint}
                  style={{
                    padding: "8px 12px",
                    background: "#2b253b",
                    border: "1px solid #3d3750",
                    color: "#fff",
                    borderRadius: 8,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                  disabled={printerStatus !== "Connected"}
                >
                  Test Print
                </button>
              </div>
            </div>

            <div
              style={{
                background: "#121017",
                border: "1px solid #2b253b",
                padding: 14,
                borderRadius: 8,
                marginTop: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <span
                  style={{ fontSize: 12, fontWeight: 700, color: "#9c97aa" }}
                >
                  Discovered Printers
                </span>
                <button
                  type="button"
                  onClick={scanBluetoothDevices}
                  disabled={isScanning}
                  style={{
                    padding: "6px 12px",
                    background: "#3b82f6",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {isScanning ? "Scanning..." : "🔍 Scan Devices"}
                </button>
              </div>

              {isScanning && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    padding: "16px 0",
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      border: "2px solid #3b82f6",
                      borderTopColor: "transparent",
                      borderRadius: "50%",
                      animation: "spin 1s linear infinite",
                    }}
                    className="animate-spin"
                  ></div>
                  <span
                    style={{ fontSize: 12, color: "#9c97aa", marginLeft: 8 }}
                  >
                    Searching for ATPOS H58BT & nearby printers...
                  </span>
                </div>
              )}

              {!isScanning && pairedPrinters.length === 0 && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#686377",
                    textAlign: "center",
                    padding: "10px 0",
                  }}
                >
                  No discovered devices. Tap scan to discover bluetooth thermal
                  printers.
                </div>
              )}

              {!isScanning && pairedPrinters.length > 0 && (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  {pairedPrinters.map((dev) => (
                    <div
                      key={dev.mac}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        background: "#0b0a0f",
                        padding: "8px 10px",
                        borderRadius: 6,
                        border: "1px solid #1c1a24",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#fff",
                          }}
                        >
                          {dev.name}
                        </div>
                        <div style={{ fontSize: 10, color: "#9c97aa" }}>
                          {dev.mac}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPrinterMac(dev.mac);
                          setPrinterName(dev.name);
                          connectPrinter(dev.mac, dev.name);
                        }}
                        style={{
                          padding: "4px 8px",
                          background: "#22c55e",
                          color: "#fff",
                          border: "none",
                          borderRadius: 4,
                          fontSize: 11,
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        Pair & Connect
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* .env credentials notice */}
          <div
            style={{
              borderTop: "1px solid #2b253b",
              paddingTop: 16,
              marginTop: 4,
            }}
          >
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
              🔑 API Keys &amp; Credentials
            </h3>
            <div
              style={{
                background: "rgba(245,158,11,0.07)",
                border: "1px solid rgba(245,158,11,0.25)",
                borderRadius: 10,
                padding: "12px 14px",
              }}
            >
              <p
                style={{
                  fontSize: 12,
                  color: "#f59e0b",
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                All keys are configured in the{" "}
                <code
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    padding: "1px 5px",
                    borderRadius: 4,
                  }}
                >
                  .env
                </code>{" "}
                file
              </p>
              <p
                style={{
                  fontSize: 11,
                  color: "#9c97aa",
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                Open <strong style={{ color: "#e2e0e8" }}>app/.env</strong> in a
                text editor and fill in your keys:
              </p>
              <ul
                style={{
                  fontSize: 11,
                  color: "#9c97aa",
                  margin: "8px 0 0 0",
                  paddingLeft: 16,
                  lineHeight: 1.8,
                }}
              >
                <li>
                  <code style={{ color: "#a78bfa" }}>VITE_SUPABASE_URL</code> —
                  Supabase project URL
                </li>
                <li>
                  <code style={{ color: "#a78bfa" }}>
                    VITE_SUPABASE_ANON_KEY
                  </code>{" "}
                  — Supabase anon key
                </li>
                <li>
                  <code style={{ color: "#a78bfa" }}>VITE_GEMINI_API_KEY</code>{" "}
                  — Google Gemini AI
                </li>
                <li>
                  <code style={{ color: "#a78bfa" }}>VITE_GROQ_API_KEY</code> —
                  Groq Whisper STT
                </li>
                <li>
                  <code style={{ color: "#a78bfa" }}>
                    VITE_BARCODELOOKUP_API_KEY
                  </code>{" "}
                  — Barcode Lookup (optional)
                </li>
              </ul>
              <p
                style={{
                  fontSize: 11,
                  color: "#6b7280",
                  marginTop: 8,
                  marginBottom: 0,
                }}
              >
                After editing .env, restart the dev server for changes to take
                effect.
              </p>
            </div>
          </div>

          {/* Emergency Database Tools */}
          <div
            style={{
              borderTop: "1px solid #2b253b",
              paddingTop: 16,
              marginTop: 16,
            }}
          >
            <h3
              style={{
                fontSize: 14,
                fontWeight: 700,
                marginBottom: 10,
                color: "#ef4444",
              }}
            >
              🛠️ Emergency Database Tools
            </h3>
            <div
              style={{
                background: "rgba(239,68,68,0.05)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 10,
                padding: "14px 16px",
              }}
            >
              <p
                style={{
                  fontSize: 11,
                  color: "#9c97aa",
                  lineHeight: 1.6,
                  marginTop: 0,
                  marginBottom: 12,
                }}
              >
                Use these tools to repair or synchronize your database if your
                local data is out of sync or corrupted.
                <strong>Warning:</strong> "Force Full Sync" will replace all
                local products and records with the cloud database.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={async () => {
                    const confirm = window.confirm(
                      "Are you sure you want to run an Emergency Full Sync? This will overwrite your local database tables with a snapshot from Supabase.",
                    );
                    if (!confirm) return;
                    try {
                      setSaved(false);
                      await useStore.getState().forceFullSync();
                      alert(
                        "Emergency Database Full Sync completed successfully!",
                      );
                    } catch (err: any) {
                      alert(`Emergency Sync Failed: ${err.message || err}`);
                    }
                  }}
                  disabled={isSyncing}
                  style={{
                    padding: "8px 16px",
                    background: "#ef4444",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: isSyncing ? "not-allowed" : "pointer",
                    opacity: isSyncing ? 0.6 : 1,
                  }}
                >
                  {isSyncing ? "Syncing..." : "Force Full Sync"}
                </button>
              </div>
            </div>
          </div>

          {saved && (
            <div
              style={{
                fontSize: 13,
                color: "#14b8a6",
                background: "rgba(20,184,166,0.1)",
                padding: 10,
                borderRadius: 8,
                textAlign: "center",
              }}
            >
              Settings Saved successfully.
            </div>
          )}

          <button
            type="submit"
            style={{
              padding: 14,
              background: "#f59e0b",
              color: "#0b0a0f",
              borderRadius: 8,
              fontWeight: 700,
              marginTop: 8,
            }}
          >
            Save Configuration
          </button>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// SCREEN 8: SYSTEM BARCODES REGISTRY MANAGER
// ----------------------------------------------------
interface SystemBarcodesManagerProps {
  products: Product[];
  onBack: () => void;
}

function SystemBarcodesManager({
  products,
  onBack,
}: SystemBarcodesManagerProps) {
  const { printerConfig } = useStore();
  const [barcodes, setBarcodes] = useState<DbBarcode[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const isMobile = useIsMobile();

  const loadBarcodes = async () => {
    try {
      const all = await db.getBarcodes();
      const systemOnes = all.filter(
        (b) => b.is_system || b.barcode.startsWith("SYS-"),
      );
      setBarcodes(systemOnes);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadBarcodes();
    (window as any)._reloadSystemBarcodes = loadBarcodes;
    return () => {
      delete (window as any)._reloadSystemBarcodes;
    };
  }, []);

  const handlePrint = async (b: DbBarcode) => {
    const prod = products.find((p) => p.id === b.product_id);
    if (!prod) return;
    const unitName = b.unit || "Piece";

    if ((window as any)._setBarcodePreview) {
      (window as any)._setBarcodePreview({
        barcode: b.barcode,
        productName: prod.display_name,
        unitName,
      });
    }

    await bluetoothPrinter.printBarcodeLabel(
      b.barcode,
      prod.display_name,
      unitName,
      printerConfig,
    );
  };

  const handleDelete = async (b: DbBarcode) => {
    if (
      window.confirm(
        `Are you sure you want to delete system barcode "${b.barcode}"?`,
      )
    ) {
      try {
        await db.deleteBarcode(b.barcode);
        setSuccess(`System barcode "${b.barcode}" successfully deleted.`);
        loadBarcodes();
        await useStore.getState().loadStoreData();
        useStore.getState().triggerSync();
        setTimeout(() => setSuccess(""), 3000);
      } catch (err: any) {
        setError(err.message || "Failed to delete barcode.");
      }
    }
  };

  const barcodeLessProducts = products.filter((p) => !p.barcode && (!p.barcodes || p.barcodes.length === 0));

  const filteredBarcodes = barcodes.filter((b) => {
    const prod = products.find((p) => p.id === b.product_id);
    const prodName = prod ? prod.display_name.toLowerCase() : "";
    const code = b.barcode.toLowerCase();
    const q = searchQuery.toLowerCase();
    return prodName.includes(q) || code.includes(q);
  });
  const ITEMS_PER_PAGE = 50;
  const paginatedBarcodes = React.useMemo(() => {
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredBarcodes.slice(startIdx, startIdx + ITEMS_PER_PAGE);
  }, [filteredBarcodes, currentPage]);

  const totalPages = Math.ceil(filteredBarcodes.length / ITEMS_PER_PAGE);

  return (
    <div
      style={{ maxWidth: 1000, margin: "0 auto", padding: "16px 0" }}
      className="animate-slide-up"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onBack}
            style={{
              background: "#2b253b",
              color: "#fff",
              border: "none",
              padding: "8px 12px",
              borderRadius: 8,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800 }}>System Barcodes</h1>
            <p style={{ color: "#9c97aa", fontSize: 13, marginTop: 2 }}>
              Manage generated Code-128 barcodes for loose/custom weight
              products
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowGenerateModal(true)}
          style={{
            padding: "10px 16px",
            background: "#a78bfa",
            color: "#181520",
            borderRadius: 8,
            border: "none",
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Plus size={16} /> Generate Barcode
        </button>
      </div>

      {success && (
        <div
          style={{
            background: "rgba(20,184,166,0.1)",
            border: "1px solid #14b8a6",
            color: "#14b8a6",
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <CheckCircle size={16} /> {success}
        </div>
      )}
      {error && (
        <div
          style={{
            background: "rgba(239,68,68,0.1)",
            border: "1px solid #ef4444",
            color: "#ef4444",
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="pos-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search
              size={16}
              style={{
                position: "absolute",
                left: 12,
                top: 12,
                color: "#9c97aa",
              }}
            />
            <input
              type="text"
              placeholder="Search by product name or barcode..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pos-input"
              style={{ paddingLeft: 38, width: "100%", height: 40 }}
            />
          </div>
        </div>

        {paginatedBarcodes.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "40px 20px",
              color: "#9c97aa",
            }}
          >
            <Barcode
              size={48}
              style={{ strokeWidth: 1, marginBottom: 12, opacity: 0.5 }}
            />
            <p style={{ fontWeight: 600 }}>No System Barcodes Found</p>
            <p style={{ fontSize: 13, marginTop: 4 }}>
              Generate a system barcode for any loose product to list it here.
            </p>
          </div>
        ) : isMobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {paginatedBarcodes.map((b) => {
              const prod = products.find((p) => p.id === b.product_id);
              return (
                <div
                  key={b.barcode}
                  style={{
                    background: "#121017",
                    border: "1px solid #2b253b",
                    padding: 16,
                    borderRadius: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 15,
                        color: "#f3f1f6",
                      }}
                    >
                      {prod ? prod.display_name : "Unknown Product"}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#9c97aa",
                        background: "#2b253b",
                        padding: "2px 8px",
                        borderRadius: 4,
                      }}
                    >
                      {b.unit || "Piece"}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      background: "rgba(255,255,255,0.02)",
                      padding: 10,
                      borderRadius: 8,
                      border: "1px solid #1c1926",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          color: "#9c97aa",
                          textTransform: "uppercase",
                          fontWeight: 600,
                        }}
                      >
                        Barcode String
                      </span>
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontSize: 12,
                          color: "#a78bfa",
                        }}
                      >
                        {b.barcode}
                      </span>
                    </div>

                    <div
                      style={{
                        background: "#fff",
                        padding: "4px 8px",
                        borderRadius: 4,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 100,
                        height: 28,
                      }}
                    >
                      <div
                        className="barcode-svg-container"
                        dangerouslySetInnerHTML={{
                          __html: generateCode128SVG(b.barcode),
                        }}
                        style={{ width: "100%", height: "100%" }}
                      />
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      justifyContent: "flex-end",
                      marginTop: 4,
                    }}
                  >
                    <button
                      onClick={() => handlePrint(b)}
                      style={{
                        flex: 1,
                        padding: "10px 12px",
                        background: "#2b253b",
                        border: "1px solid #3d3550",
                        borderRadius: 8,
                        color: "#a78bfa",
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        fontSize: 13,
                      }}
                    >
                      <Printer size={14} /> Reprint
                    </button>
                    <button
                      onClick={() => handleDelete(b)}
                      style={{
                        flex: 1,
                        padding: "10px 12px",
                        background: "rgba(239,68,68,0.1)",
                        border: "1px solid rgba(239,68,68,0.2)",
                        borderRadius: 8,
                        color: "#ef4444",
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        fontSize: 13,
                      }}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>
              );
            })}
            
            {/* Mobile Pagination Controls */}
            {totalPages > 1 && (
              <div style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: 12,
                marginTop: 16,
                padding: "8px 0",
              }}>
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    background: currentPage === 1 ? "transparent" : "rgba(167,139,250,0.15)",
                    border: "1px solid #2b253b",
                    color: currentPage === 1 ? "#4b4855" : "#a78bfa",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: currentPage === 1 ? "not-allowed" : "pointer",
                  }}
                >
                  Prev
                </button>
                <span style={{ fontSize: 13, color: "#9c97aa", fontWeight: 600 }}>
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    background: currentPage === totalPages ? "transparent" : "rgba(167,139,250,0.15)",
                    border: "1px solid #2b253b",
                    color: currentPage === totalPages ? "#4b4855" : "#a78bfa",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              className="pos-table"
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--border-color)",
                    textAlign: "left",
                    color: "#9c97aa",
                  }}
                >
                  <th style={{ padding: 12 }}>Product Name</th>
                  <th style={{ padding: 12 }}>Barcode String</th>
                  <th style={{ padding: 12, textAlign: "center" }}>
                    Visual Barcode
                  </th>
                  <th style={{ padding: 12, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedBarcodes.map((b) => {
                  const prod = products.find((p) => p.id === b.product_id);
                  return (
                    <tr
                      key={b.barcode}
                      style={{ borderBottom: "1px solid var(--border-color)" }}
                    >
                      <td
                        style={{
                          padding: 12,
                          fontWeight: 700,
                          color: "#f3f1f6",
                        }}
                      >
                        {prod ? prod.display_name : "Unknown Product"}
                      </td>
                      <td
                        style={{
                          padding: 12,
                          fontFamily: "monospace",
                          color: "#9c97aa",
                        }}
                      >
                        {b.barcode}
                      </td>
                      <td style={{ padding: 6, textAlign: "center" }}>
                        <div
                          style={{
                            background: "#fff",
                            padding: "4px 8px",
                            borderRadius: 4,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 120,
                            height: 32,
                          }}
                        >
                          <div
                            className="barcode-svg-container"
                            dangerouslySetInnerHTML={{
                              __html: generateCode128SVG(b.barcode),
                            }}
                            style={{ width: "100%", height: "100%" }}
                          />
                        </div>
                      </td>
                      <td style={{ padding: 12, textAlign: "right" }}>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            justifyContent: "flex-end",
                          }}
                        >
                          <button
                            onClick={() => handlePrint(b)}
                            style={{
                              padding: "6px 12px",
                              background: "#2b253b",
                              border: "1px solid #3d3550",
                              borderRadius: 6,
                              color: "#a78bfa",
                              fontWeight: 700,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <Printer size={13} /> Reprint
                          </button>
                          <button
                            onClick={() => handleDelete(b)}
                            style={{
                              padding: "6px 12px",
                              background: "rgba(239,68,68,0.1)",
                              border: "1px solid rgba(239,68,68,0.2)",
                              borderRadius: 6,
                              color: "#ef4444",
                              fontWeight: 700,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <Trash2 size={13} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Desktop Pagination Controls */}
            {totalPages > 1 && (
              <div style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                background: "#121017",
                borderTop: "1px solid #2b253b",
              }}>
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    background: currentPage === 1 ? "transparent" : "rgba(167,139,250,0.15)",
                    border: "1px solid #2b253b",
                    color: currentPage === 1 ? "#4b4855" : "#a78bfa",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: currentPage === 1 ? "not-allowed" : "pointer",
                  }}
                >
                  Prev
                </button>
                <span style={{ fontSize: 13, color: "#9c97aa", fontWeight: 600 }}>
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    background: currentPage === totalPages ? "transparent" : "rgba(167,139,250,0.15)",
                    border: "1px solid #2b253b",
                    color: currentPage === totalPages ? "#4b4855" : "#a78bfa",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {showGenerateModal &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 100,
              padding: 20,
            }}
          >
            <div
              className="pos-card animate-scale-up"
              style={{
                width: "100%",
                maxWidth: 450,
                background: "#1c1926",
                padding: 24,
                borderRadius: 12,
              }}
            >
              <div className="flex-between" style={{ marginBottom: 16 }}>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: "#a78bfa" }}>
                  Select Loose Product
                </h2>
                <button
                  onClick={() => setShowGenerateModal(false)}
                  style={{
                    background: "transparent",
                    color: "#9c97aa",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  <X size={20} />
                </button>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#9c97aa",
                    textTransform: "uppercase",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  Select Barcode-less Product
                </label>
                <select
                  onChange={(e) => {
                    const id = e.target.value
                      ? parseInt(e.target.value, 10)
                      : "";
                    if (id) {
                      const prod = products.find((p) => p.id === id);
                      if (prod) {
                        setShowGenerateModal(false);
                        if ((window as any)._openGenSystemBarcode) {
                          (window as any)._openGenSystemBarcode(prod);
                        }
                      }
                    }
                  }}
                  className="pos-input"
                  style={{
                    width: "100%",
                    height: 40,
                    background: "#120f1a",
                    border: "1px solid var(--border-color)",
                    color: "#fff",
                    padding: "0 8px",
                    borderRadius: 8,
                  }}
                >
                  <option value="">-- Choose Loose Product --</option>
                  {barcodeLessProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// ----------------------------------------------------
// SCREEN 10: CATEGORIES SETTINGS SCREEN
// ----------------------------------------------------
function CategoriesScreen({
  onBack,
  products,
}: {
  onBack: () => void;
  products: Product[];
}) {
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [mappings, setMappings] = useState<ProductCategory[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingCat, setEditingCat] = useState<CatalogCategory | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [displayOrder, setDisplayOrder] = useState("0");
  const [imageUrl, setImageUrl] = useState("");

  // Management states
  const [manageCat, setManageCat] = useState<CatalogCategory | null>(null);
  const [tab, setTab] = useState<"assigned" | "available">("assigned");
  const [search, setSearch] = useState("");
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());

  const [isFetchingImages, setIsFetchingImages] = useState(false);
  const [screenTab, setScreenTab] = useState<"categories" | "images">("categories");
  const [selectedImageCatId, setSelectedImageCatId] = useState("all");
  const [imageSearchQuery, setImageSearchQuery] = useState("");
  const [imagePage, setImagePage] = useState(1);
  const [syncProgress, setSyncProgress] = useState<{
    show: boolean;
    total: number;
    current: number;
    success: number;
    currentName: string;
  } | null>(null);

  const loadAll = () => {
    setCategories(db.getCatalogCategories().sort((a, b) => a.display_order - b.display_order));
    setMappings(db.getProductCategories());
  };

  useEffect(() => {
    loadAll();
  }, []);

  // Image upload modal states
  const [uploadModalProduct, setUploadModalProduct] = useState<Product | null>(null);
  const [uploadPastedUrl, setUploadPastedUrl] = useState("");
  const [uploadPreviewSrc, setUploadPreviewSrc] = useState<string | null>(null);
  const [isImageUploading, setIsImageUploading] = useState(false);

  const handleUploadProductImageInScreen = (prod: Product, e: React.MouseEvent) => {
    e.stopPropagation();
    setUploadModalProduct(prod);
    setUploadPastedUrl("");
    setUploadPreviewSrc(prod.image_url || null);
  };

  const handleCapacitorCamera = async () => {
    try {
      const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
      const photo = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Prompt,
      });
      if (photo && photo.base64String) {
        setUploadPreviewSrc(`data:image/${photo.format};base64,${photo.base64String}`);
      }
    } catch (err: any) {
      alert("Camera error: " + err.message);
    }
  };

  const handleFileSelect = (evt: React.ChangeEvent<HTMLInputElement>) => {
    const file = evt.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          setUploadPreviewSrc(e.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePreviewUrl = () => {
    if (uploadPastedUrl.trim()) {
      setUploadPreviewSrc(uploadPastedUrl.trim());
    }
  };

  const handleSaveCroppedImage = async () => {
    if (!uploadModalProduct || !uploadPreviewSrc) return;
    setIsImageUploading(true);
    try {
      const uploadedUrl = await optimizeAndUploadProductImage(uploadModalProduct.id, uploadPreviewSrc);
      if (uploadedUrl) {
        const updated = {
          ...uploadModalProduct,
          image_url: uploadedUrl,
          image_source: "USER"
        };
        await db.saveProduct(updated);
        alert("Product image updated successfully!");
        setUploadModalProduct(null);
        loadAll();
      } else {
        alert("Failed to upload image. Please try a different URL/file.");
      }
    } catch (err: any) {
      alert("Save failed: " + err.message);
    } finally {
      setIsImageUploading(false);
    }
  };

  const optimizeAndUploadProductImage = async (productId: number, sourceUrl: string): Promise<string | null> => {
    if (!db.supabase) {
      console.warn("Supabase not initialized, using direct URL");
      return sourceUrl;
    }
    try {
      // 1. Get blob from URL or dataURL
      let blob: Blob;
      if (sourceUrl.startsWith("data:")) {
        const parts = sourceUrl.split(",");
        const mime = parts[0].match(/:(.*?);/)?.[1] || "image/png";
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        blob = new Blob([u8arr], { type: mime });
      } else {
        const res = await fetch(sourceUrl);
        if (!res.ok) return null;
        blob = await res.blob();
      }

      // 2. Load into Canvas to crop center to 300x300 and convert to WebP
      const optimizedBlob = await new Promise<Blob>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = URL.createObjectURL(blob);
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(blob);
            return;
          }
          canvas.width = 300;
          canvas.height = 300;

          // Crop center square
          const minSide = Math.min(img.width, img.height);
          const sx = (img.width - minSide) / 2;
          const sy = (img.height - minSide) / 2;
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, 300, 300);

          canvas.toBlob((webBlob) => {
            resolve(webBlob || blob);
          }, "image/webp", 0.85);
        };
        img.onerror = () => {
          resolve(blob); // fallback to raw download blob if CORS or loader fails
        };
      });

      // 3. Upload to Supabase Storage Bucket 'product-images'
      const filename = `prod_${productId}_${Date.now()}.webp`;
      const { error } = await db.supabase.storage
        .from("product-images")
        .upload(filename, optimizedBlob, {
          contentType: "image/webp",
          upsert: true
        });

      if (error) {
        console.error("Failed uploading optimized WebP to Supabase Storage:", error.message);
        return null;
      }

      const { data: urlData } = db.supabase.storage
        .from("product-images")
        .getPublicUrl(filename);

      return urlData.publicUrl;
    } catch (err) {
      console.error("optimizeAndUploadProductImage error:", err);
      // Last-ditch direct blob upload
      try {
        const res = await fetch(sourceUrl);
        if (res.ok) {
          const blob = await res.blob();
          const ext = sourceUrl.split('.').pop()?.split('?')[0] || 'jpg';
          const filename = `prod_${productId}_${Date.now()}.${ext}`;
          const { error } = await db.supabase.storage
            .from("product-images")
            .upload(filename, blob, {
              contentType: blob.type || "image/jpeg",
              upsert: true
            });
          if (!error) {
            const { data: urlData } = db.supabase.storage.from("product-images").getPublicUrl(filename);
            return urlData.publicUrl;
          }
        }
      } catch {}
      return null;
    }
  };

  interface GoogleImageItem {
    link: string;
    title?: string;
    mime?: string;
    image?: {
      height: number;
      width: number;
    };
  }

  const scoreGoogleImage = (item: GoogleImageItem, query: string): number => {
    let score = 100;
    const title = (item.title || "").toLowerCase();
    const url = (item.link || "").toLowerCase();
    const width = item.image?.width || 1;
    const height = item.image?.height || 1;
    const ratio = width / height;

    // 1. Aspect ratio scoring: Prefer square/portrait (standard package shapes)
    if (ratio > 1.4) {
      score -= 40; // Penalty for landscape
    }
    if (ratio > 1.8) {
      score -= 50; // Heavy penalty for banners/ads
    }
    if (ratio < 0.4) {
      score -= 40; // Penalty for narrow vertical lines
    }

    // 2. Reject vectors/SVGs (mostly corporate logos)
    if (item.mime === "image/svg+xml" || url.endsWith(".svg")) {
      score -= 80;
    }

    // 3. Reject/Penalize obvious text, ads, banners, or reviews
    const badKeywords = [
      "logo", "banner", "advertisement", "ad-", "corporate", "website", "review", "press", "history", "career",
      "founder", "chart", "diagram", "news", "map", "header", "footer", "button", "vector", "promo", "discount",
      "offer", "leaflet", "flyer", "sign", "label", "text", "info"
    ];
    badKeywords.forEach(kw => {
      if (title.includes(kw)) score -= 30;
      if (url.includes(kw)) score -= 30;
    });

    // 4. Boost ideal product attributes in title
    const goodKeywords = ["pack", "packaging", "bottle", "box", "pouch", "bag", "product", "jar", "can", "packet", "wrapper"];
    goodKeywords.forEach(kw => {
      if (title.includes(kw)) score += 15;
    });

    // 5. Text relevance matching: title contains words from search query
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    let matchedWords = 0;
    queryWords.forEach(word => {
      if (title.includes(word)) matchedWords++;
    });
    if (queryWords.length > 0) {
      score += (matchedWords / queryWords.length) * 30;
    }

    return score;
  };

  const fetchGoogleImageByBarcode = async (barcode: string): Promise<string | null> => {
    const googleKey = (import.meta.env as any).VITE_GOOGLE_API_KEY;
    const googleCx = (import.meta.env as any).VITE_GOOGLE_CX;
    if (!googleKey || !googleCx) return null;

    try {
      const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(barcode)}&searchType=image&key=${googleKey}&cx=${googleCx}&num=5`;
      const res = await fetch(url);
      if (res.ok) {
        const d = await res.json();
        const items: GoogleImageItem[] = d?.items || [];
        if (items.length > 0) {
          // Score and rank candidates
          const scored = items.map(item => ({ item, score: scoreGoogleImage(item, barcode) }));
          scored.sort((a, b) => b.score - a.score);
          if (scored[0].score >= 40) {
            return scored[0].item.link;
          }
        }
      }
    } catch (e) {
      console.error("Google Barcode Custom Search API failed:", e);
    }
    return null;
  };

  const fetchGoogleImageByName = async (productName: string, suffix: string): Promise<string | null> => {
    const googleKey = (import.meta.env as any).VITE_GOOGLE_API_KEY;
    const googleCx = (import.meta.env as any).VITE_GOOGLE_CX;
    const query = `${productName} ${suffix}`.trim();

    if (googleKey && googleCx) {
      try {
        const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&searchType=image&key=${googleKey}&cx=${googleCx}&num=5`;
        const res = await fetch(url);
        if (res.ok) {
          const d = await res.json();
          const items: GoogleImageItem[] = d?.items || [];
          if (items.length > 0) {
            const scored = items.map(item => ({ item, score: scoreGoogleImage(item, query) }));
            scored.sort((a, b) => b.score - a.score);
            if (scored[0].score >= 45) {
              return scored[0].item.link;
            }
          }
        }
      } catch (e) {
        console.error("Google Name Custom Search API failed:", e);
      }
    }

    // Gemini Fallback if Google keys are missing or API limits hit
    const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Provide a single, publicly accessible direct image URL (hotlinkable, ending in .jpg, .png, or .jpeg) for: "${query}". Return ONLY the raw URL string, nothing else. No markdown, no quotes, no extra text.`
              }]
            }]
          })
        });
        if (response.ok) {
          const data = await response.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text && text.startsWith("http")) {
            return text;
          }
        }
      } catch (e) {
        console.error("Gemini image search fallback failed:", e);
      }
    }
    return null;
  };

  const handleFetchMissingImages = async () => {
    // 1. Supabase storage check & skip user uploads / existing images
    const targetProducts = products.filter(p => !p.image_url && !p.is_deleted && p.image_source !== "USER");
    if (targetProducts.length === 0) {
      alert("All products already have images or are protected!");
      return;
    }
    
    setIsFetchingImages(true);
    setSyncProgress({
      show: true,
      total: targetProducts.length,
      current: 0,
      success: 0,
      currentName: ""
    });

    let successCount = 0;
    let currentIdx = 0;
    
    for (const prod of targetProducts) {
      currentIdx++;
      setSyncProgress(prev => prev ? {
        ...prev,
        current: currentIdx,
        currentName: prod.display_name
      } : null);

      let resolvedUrl: string | null = null;
      let resolvedSource: "GOOGLE_BARCODE" | "GOOGLE_NAME" | "PLACEHOLDER" = "PLACEHOLDER";

      // Step 1: Google Search by Barcode
      if (prod.barcode) {
        const cleanBarcode = prod.barcode.trim().replace(/[^0-9]/g, '');
        if (cleanBarcode) {
          try {
            const imgUrl = await fetchGoogleImageByBarcode(cleanBarcode);
            if (imgUrl) {
              resolvedUrl = imgUrl;
              resolvedSource = "GOOGLE_BARCODE";
            }
          } catch (err) {
            console.warn(`Google barcode search failed for ${prod.display_name}:`, err);
          }
        }
      }

      // Step 2: Google Search by Product Name (with packaging suffix)
      if (!resolvedUrl) {
        try {
          const imgUrl = await fetchGoogleImageByName(prod.display_name, "product packaging");
          if (imgUrl) {
            resolvedUrl = imgUrl;
            resolvedSource = "GOOGLE_NAME";
          }
        } catch (err) {
          console.warn(`Google name search failed for ${prod.display_name}:`, err);
        }
      }

      // Step 3: Google Search by Product Name Fallback (simpler query)
      if (!resolvedUrl) {
        try {
          const imgUrl = await fetchGoogleImageByName(prod.display_name, "product");
          if (imgUrl) {
            resolvedUrl = imgUrl;
            resolvedSource = "GOOGLE_NAME";
          }
        } catch (err) {
          console.warn(`Google simple name search failed for ${prod.display_name}:`, err);
        }
      }

      // Step 5: Upload to Supabase and compress to optimized WebP 300x300
      if (resolvedUrl) {
        try {
          const uploadedUrl = await optimizeAndUploadProductImage(prod.id, resolvedUrl);
          if (uploadedUrl) {
            const updated = {
              ...prod,
              image_url: uploadedUrl,
              image_source: resolvedSource,
              image_last_updated: new Date().toISOString()
            };
            await db.saveProduct(updated);
            successCount++;
            setSyncProgress(prev => prev ? { ...prev, success: successCount } : null);
            continue;
          }
        } catch (uploadErr) {
          console.error(`Optimized upload failed for ${prod.display_name}:`, uploadErr);
        }
      }
    }
    
    setIsFetchingImages(false);
    setSyncProgress(null);
    alert(`Bulk fetch completed! Successfully fetched and optimized images for ${successCount} products.`);
    loadAll();
  };

  const handleOpenAdd = () => {
    setEditingCat(null);
    setName("");
    setDisplayOrder("0");
    setImageUrl("");
    setShowModal(true);
  };

  const handleOpenEdit = (cat: CatalogCategory) => {
    setEditingCat(cat);
    setName(cat.name);
    setDisplayOrder(String(cat.display_order));
    setImageUrl(cat.image_url || "");
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      alert("Name is required");
      return;
    }
    await db.saveCatalogCategory({
      id: editingCat?.id,
      name: name.trim(),
      display_order: parseInt(displayOrder, 10) || 0,
      image_url: imageUrl.trim() || undefined,
      is_system: editingCat?.is_system || false,
    });
    loadAll();
    setShowModal(false);
  };

  const handleDelete = async (id: string) => {
    if (confirm("Delete this category? Product associations will also be removed.")) {
      await db.deleteCatalogCategory(id);
      loadAll();
    }
  };

  const handleCameraUpload = async () => {
    try {
      const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
      const photo = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Prompt,
      });
      if (photo && photo.base64String) {
        alert("Uploading image to Supabase Storage...");
        const raw = atob(photo.base64String);
        const rawLength = raw.length;
        const array = new Uint8Array(new ArrayBuffer(rawLength));
        for (let i = 0; i < rawLength; i++) {
          array[i] = raw.charCodeAt(i);
        }
        const blob = new Blob([array], { type: `image/${photo.format}` });
        const filename = `cat_${Date.now()}.${photo.format}`;
        
        if (db.supabase) {
          const { error } = await db.supabase.storage
            .from("category-images")
            .upload(filename, blob, {
              contentType: `image/${photo.format}`,
              upsert: true,
            });
          if (error) {
            alert("Upload failed: " + error.message);
            return;
          }
          const { data: urlData } = db.supabase.storage
            .from("category-images")
            .getPublicUrl(filename);
          setImageUrl(urlData.publicUrl);
          alert("Image uploaded!");
        } else {
          alert("Supabase not initialized");
        }
      }
    } catch (e: any) {
      alert("Camera error: " + e.message);
    }
  };

  // Product assignment logic
  const assignedList = mappings.filter(m => m.category_id === manageCat?.id);
  const assignedSet = new Set(assignedList.map(m => m.product_id));

  const filteredAssigned = products.filter(
    p => assignedSet.has(p.id) && !p.is_deleted &&
    (search ? p.display_name.toLowerCase().includes(search.toLowerCase()) : true)
  );

  const filteredAvailable = products.filter(
    p => !assignedSet.has(p.id) && !p.is_deleted &&
    (search ? p.display_name.toLowerCase().includes(search.toLowerCase()) : true)
  );

  const currentTabProducts = tab === "assigned" ? filteredAssigned : filteredAvailable;

  const handleToggleCheck = (pid: number) => {
    const next = new Set(checkedIds);
    if (next.has(pid)) next.delete(pid);
    else next.add(pid);
    setCheckedIds(next);
  };

  const handleToggleSelectAll = () => {
    if (checkedIds.size === currentTabProducts.length) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(currentTabProducts.map(p => p.id)));
    }
  };

  const handleBulkAction = async () => {
    if (checkedIds.size === 0 || !manageCat) return;
    if (tab === "available") {
      for (const pid of checkedIds) {
        await db.assignProductToCategory(pid, manageCat.id);
      }
      alert(`Assigned ${checkedIds.size} products to ${manageCat.name}`);
    } else {
      for (const pid of checkedIds) {
        await db.removeProductFromCategory(pid, manageCat.id);
      }
      alert(`Removed ${checkedIds.size} products from ${manageCat.name}`);
    }
    setCheckedIds(new Set());
    loadAll();
  };

  const catalogProducts = products.filter(p => !p.is_deleted);

  return (
    <div style={{ padding: "16px", maxWidth: screenTab === "images" ? "100%" : 1000, margin: "0 auto", boxSizing: "border-box" }}>
      {/* Sync Progress Modal */}
      {syncProgress?.show && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div className="pos-card animate-scale-up" style={{ width: "90%", maxWidth: 400, padding: 24, textAlign: "center" }}>
            <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12, color: "var(--accent-gold)" }}>Syncing Product Images</h3>
            <div style={{ display: "flex", justifyContent: "center", margin: "16px 0" }}>
              <div className="animate-spin" style={{ width: 36, height: 36, border: "3px solid rgba(245,158,11,0.2)", borderTopColor: "var(--accent-gold)", borderRadius: "50%" }} />
            </div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8, wordBreak: "break-all" }}>
              Fetching: <span style={{ color: "#fff", fontWeight: 700 }}>{syncProgress.currentName}</span>
            </p>
            <div style={{ height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden", marginBottom: 16 }}>
              <div style={{ height: "100%", background: "var(--accent-gold)", width: `${(syncProgress.current / syncProgress.total) * 100}%`, transition: "width 0.2s" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-secondary)" }}>
              <span>Progress: {syncProgress.current} / {syncProgress.total}</span>
              <span style={{ color: "var(--accent-teal)" }}>Found: {syncProgress.success}</span>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20, boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <button onClick={onBack} className="pos-btn" style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)", color: "#fff", borderRadius: 8 }}>
            <ArrowLeft size={16} /> Back
          </button>
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "#fff" }}>Category Settings</h2>
        </div>
        
        <div style={{ display: "flex", gap: 8, width: "100%" }}>
          <button
            onClick={handleFetchMissingImages}
            disabled={isFetchingImages}
            className="pos-btn"
            style={{
              flex: 1,
              background: "rgba(245,158,11,0.1)",
              color: "var(--accent-gold)",
              border: "1px solid rgba(245,158,11,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "10px",
              fontSize: "12px",
              opacity: isFetchingImages ? 0.7 : 1,
              cursor: isFetchingImages ? "not-allowed" : "pointer"
            }}
          >
            <DownloadCloud size={16} /> {isFetchingImages ? "Fetching..." : "Fetch Images"}
          </button>
          <button 
            onClick={handleOpenAdd} 
            className="pos-btn" 
            style={{ 
              flex: 1, 
              background: "var(--accent-teal)", 
              color: "#fff", 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center", 
              gap: 6,
              padding: "10px",
              fontSize: "12px"
            }}
          >
            <Plus size={16} /> New Category
          </button>
        </div>
      </div>

      {/* Sub tabs navigator */}
      <div style={{ display: "flex", background: "#120f1a", padding: 4, borderRadius: 8, gap: 4, marginBottom: 20 }}>
        <button
          onClick={() => setScreenTab("categories")}
          style={{
            flex: 1,
            padding: "10px 0",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            background: screenTab === "categories" ? "#1d1829" : "transparent",
            color: screenTab === "categories" ? "var(--accent-gold)" : "var(--text-secondary)",
            fontWeight: 700,
            fontSize: 13,
            outline: "none"
          }}
        >
          Manage Categories
        </button>
        <button
          onClick={() => setScreenTab("images")}
          style={{
            flex: 1,
            padding: "10px 0",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            background: screenTab === "images" ? "#1d1829" : "transparent",
            color: screenTab === "images" ? "var(--accent-gold)" : "var(--text-secondary)",
            fontWeight: 700,
            fontSize: 13,
            outline: "none"
          }}
        >
          Product Images Manager
        </button>
      </div>

      {/* Categories Tab Content */}
      {screenTab === "categories" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {categories.map(cat => {
            const count = mappings.filter(m => m.category_id === cat.id).length;
            return (
              <div key={cat.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
                    {cat.image_url ? (
                      <img src={cat.image_url} alt={cat.name} style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: 48, height: 48, borderRadius: 8, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                        📁
                      </div>
                    )}
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{cat.name}</h3>
                      <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Order: {cat.display_order}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Products:</span>
                    <span style={{ background: "rgba(20,184,166,0.1)", color: "var(--accent-teal)", borderRadius: 20, padding: "2px 8px", fontSize: 12, fontWeight: 700 }}>
                      {count}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { setManageCat(cat); setCheckedIds(new Set()); setSearch(""); setTab("assigned"); }} className="pos-btn" style={{ flex: 1, padding: "6px 0", fontSize: 12, background: "rgba(245,158,11,0.1)", color: "var(--accent-gold)", border: "1px solid rgba(245,158,11,0.2)" }}>
                    Manage Products
                  </button>
                  <button onClick={() => handleOpenEdit(cat)} className="pos-btn" style={{ padding: "6px 10px", fontSize: 12, background: "#2b253b", color: "#fff" }}>
                    Edit
                  </button>
                  <button onClick={() => handleDelete(cat.id)} className="pos-btn" style={{ padding: "6px 10px", fontSize: 12, background: "rgba(239,68,68,0.1)", color: "var(--accent-red)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Product Images Tab Content */}
      {screenTab === "images" && (
        <div style={{ display: "flex", gap: 8, minHeight: "65vh" }}>
          {/* Left Sidebar */}
          <div
            style={{
              width: "28%",
              borderRight: "1px solid var(--border-color)",
              paddingRight: 6,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "550px", overflowY: "auto" }}>
              {[
                { id: "all", name: "All Items", icon: "📦", imageUrl: undefined as string | undefined, count: catalogProducts.length },
                ...categories.map(cat => ({
                  id: cat.id,
                  name: cat.name,
                  icon: undefined,
                  imageUrl: cat.image_url,
                  count: mappings.filter(m => m.category_id === cat.id).length
                })),
                { id: "uncategorized", name: "Uncategorized", icon: "📁", imageUrl: undefined as string | undefined, count: catalogProducts.filter(p => !new Set(mappings.map(m => m.product_id)).has(p.id)).length }
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setSelectedImageCatId(item.id);
                    setImagePage(1);
                  }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    width: "100%",
                    padding: "8px 6px",
                    borderRadius: "6px",
                    border: selectedImageCatId === item.id ? "1.5px solid var(--accent-gold)" : "1px solid var(--border-color)",
                    cursor: "pointer",
                    textAlign: "center",
                    background: selectedImageCatId === item.id ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.02)",
                    color: selectedImageCatId === item.id ? "var(--accent-gold)" : "var(--text-primary)",
                    fontWeight: "700",
                    fontSize: "12px",
                    transition: "all 0.15s",
                    gap: "6px",
                    outline: "none",
                    boxSizing: "border-box"
                  }}
                >
                  {/* Category Image/Thumbnail or Icon Placeholder */}
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} style={{ width: "100%", height: "45px", borderRadius: 4, objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: "100%", height: "45px", borderRadius: 4, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                      {item.icon || "📁"}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "center", width: "100%" }}>
                    <span style={{ display: "block", fontSize: "10px", fontWeight: "800", wordBreak: "break-word", lineHeight: "12px", textAlign: "center" }}>
                      {item.name}
                    </span>
                    <span style={{ display: "block", fontSize: "8px", color: "var(--text-secondary)", fontWeight: "500", textAlign: "center" }}>
                      {item.count} items
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right Product Grid */}
          <div style={{ width: "72%", display: "flex", flexDirection: "column" }}>
            {/* Search Bar */}
            <div style={{ position: "relative", marginBottom: 14 }}>
              <Search
                size={15}
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#6b6880",
                  pointerEvents: "none",
                }}
              />
              <input
                type="text"
                value={imageSearchQuery}
                onChange={(e) => {
                  setImageSearchQuery(e.target.value);
                  setImagePage(1);
                }}
                placeholder="Search items by name..."
                style={{
                  width: "100%",
                  padding: "11px 36px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.09)",
                  borderRadius: 10,
                  color: "#fff",
                  outline: "none",
                  fontSize: 13,
                }}
              />
            </div>

            {/* Grid of Product Cards */}
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1 }}>
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
                  {(() => {
                    const currentGridProducts = (() => {
                      if (selectedImageCatId === "all") return catalogProducts;
                      if (selectedImageCatId === "uncategorized") {
                        const assignedIds = new Set(mappings.map(m => m.product_id));
                        return catalogProducts.filter(p => !assignedIds.has(p.id));
                      }
                      const catProdIds = new Set(mappings.filter(m => m.category_id === selectedImageCatId).map(m => m.product_id));
                      return catalogProducts.filter(p => catProdIds.has(p.id));
                    })();

                    const filtered = imageSearchQuery.trim()
                      ? currentGridProducts.filter(p => p.display_name.toLowerCase().includes(imageSearchQuery.toLowerCase()))
                      : currentGridProducts;

                    const PAGE_SIZE = 40;
                    const paginated = filtered.slice((imagePage - 1) * PAGE_SIZE, imagePage * PAGE_SIZE);

                    if (paginated.length === 0) {
                      return (
                        <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: 32, color: "var(--text-secondary)" }}>
                          No products found
                        </div>
                      );
                    }

                    return paginated.map(p => (
                      <div
                        key={p.id}
                        onClick={(e) => handleUploadProductImageInScreen(p, e)}
                        style={{
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "8px",
                          padding: "8px",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "stretch",
                          cursor: "pointer",
                          position: "relative",
                          overflow: "hidden",
                          textAlign: "center",
                          minHeight: "165px",
                          transition: "all 0.15s",
                          boxSizing: "border-box"
                        }}
                      >
                        {/* Corner Active Price Badge */}
                        <div
                          style={{
                            position: "absolute",
                            top: "4px",
                            right: "4px",
                            background: "rgba(245,158,11,0.9)",
                            color: "#0b0a0f",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "9px",
                            fontWeight: "900",
                            zIndex: 5,
                            pointerEvents: "none"
                          }}
                        >
                          ₹{p.retail_price}
                        </div>

                        {/* Image wrapper with camera overlay */}
                        <div style={{ position: "relative", width: "100%", height: "100px", marginBottom: "8px" }}>
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.display_name} style={{ width: "100%", height: "100px", objectFit: "cover", borderRadius: "6px" }} />
                          ) : (
                            <div style={{ width: "100%", height: "100px", borderRadius: "6px", background: getProductColor(p.display_name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "30px", fontWeight: "bold", color: "#fff" }}>
                              {p.display_name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div style={{ position: "absolute", bottom: 6, right: 6, background: "rgba(0,0,0,0.65)", borderRadius: "50%", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>
                            📷
                          </div>
                        </div>

                        {/* Clamped Name to match catalog */}
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: "700",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            height: "30px",
                            lineHeight: "15px",
                            color: "var(--text-primary)",
                            marginBottom: "4px"
                          }}
                        >
                          {p.display_name}
                        </span>
                      </div>
                    ));
                  })()}
                </div>
              </div>

              {/* Pagination Controls */}
              {(() => {
                const currentGridProducts = (() => {
                  if (selectedImageCatId === "all") return catalogProducts;
                  if (selectedImageCatId === "uncategorized") {
                    const assignedIds = new Set(mappings.map(m => m.product_id));
                    return catalogProducts.filter(p => !assignedIds.has(p.id));
                  }
                  const catProdIds = new Set(mappings.filter(m => m.category_id === selectedImageCatId).map(m => m.product_id));
                  return catalogProducts.filter(p => catProdIds.has(p.id));
                })();

                const filtered = imageSearchQuery.trim()
                  ? currentGridProducts.filter(p => p.display_name.toLowerCase().includes(imageSearchQuery.toLowerCase()))
                  : currentGridProducts;

                const PAGE_SIZE = 40;
                const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

                if (totalPages <= 1) return null;

                return (
                  <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 16, alignItems: "center" }}>
                    <button
                      disabled={imagePage === 1}
                      onClick={() => setImagePage(p => Math.max(1, p - 1))}
                      className="pos-btn"
                      style={{ padding: "6px 12px", background: "#2b253b", color: "#fff", opacity: imagePage === 1 ? 0.5 : 1 }}
                    >
                      Prev
                    </button>
                    <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                      Page {imagePage} of {totalPages}
                    </span>
                    <button
                      disabled={imagePage === totalPages}
                      onClick={() => setImagePage(p => Math.min(totalPages, p + 1))}
                      className="pos-btn"
                      style={{ padding: "6px 12px", background: "#2b253b", color: "#fff", opacity: imagePage === totalPages ? 0.5 : 1 }}
                    >
                      Next
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* CREATE / EDIT MODAL */}
      {showModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120 }}>
          <div style={{ background: "#181520", padding: 24, borderRadius: 12, width: "100%", maxWidth: 400, border: "1px solid var(--border-color)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 800 }}>{editingCat ? "Edit Category" : "New Category"}</h3>
              <button onClick={() => setShowModal(false)} className="pos-btn" style={{ background: "transparent", border: "none", color: "var(--text-secondary)" }}>
                <X size={20} />
              </button>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6, fontWeight: 700 }}>CATEGORY NAME</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} className="pos-input" style={{ width: "100%" }} placeholder="e.g. Spices 🌶️" />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6, fontWeight: 700 }}>DISPLAY ORDER</label>
                <input type="number" value={displayOrder} onChange={e => setDisplayOrder(e.target.value)} className="pos-input" style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6, fontWeight: 700 }}>IMAGE URL</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="text" value={imageUrl} onChange={e => setImageUrl(e.target.value)} className="pos-input" style={{ flex: 1 }} placeholder="Image URL (optional)" />
                  <button onClick={handleCameraUpload} className="pos-btn" style={{ background: "#2b253b", color: "#fff" }}>
                    📷 Upload
                  </button>
                </div>
              </div>
              
              <button onClick={handleSave} className="pos-btn" style={{ background: "var(--accent-teal)", color: "#fff", width: "100%", padding: 12, fontWeight: 700, marginTop: 10 }}>
                Save Category
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MANAGE PRODUCTS MODAL */}
      {manageCat && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120 }}>
          <div style={{ background: "#181520", padding: 24, borderRadius: 12, width: "90%", maxWidth: 600, height: "80vh", display: "flex", flexDirection: "column", border: "1px solid var(--border-color)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 800 }}>Manage Products</h3>
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Category: {manageCat.name}</span>
              </div>
              <button onClick={() => setManageCat(null)} className="pos-btn" style={{ background: "transparent", border: "none", color: "var(--text-secondary)" }}>
                <X size={20} />
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", background: "#120f1a", padding: 4, borderRadius: 8, gap: 4, marginBottom: 16 }}>
              <button onClick={() => { setTab("assigned"); setCheckedIds(new Set()); }} style={{ flex: 1, padding: "8px 0", border: "none", borderRadius: 6, cursor: "pointer", background: tab === "assigned" ? "#1d1829" : "transparent", color: tab === "assigned" ? "var(--accent-gold)" : "var(--text-secondary)", fontWeight: 700, fontSize: 13 }}>
                Assigned Products ({filteredAssigned.length})
              </button>
              <button onClick={() => { setTab("available"); setCheckedIds(new Set()); }} style={{ flex: 1, padding: "8px 0", border: "none", borderRadius: 6, cursor: "pointer", background: tab === "available" ? "#1d1829" : "transparent", color: tab === "available" ? "var(--accent-gold)" : "var(--text-secondary)", fontWeight: 700, fontSize: 13 }}>
                Add Products ({filteredAvailable.length})
              </button>
            </div>

            {/* Search and Check-all */}
            <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center" }}>
              <div style={{ position: "relative", flex: 1 }}>
                <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-secondary)" }} />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} className="pos-input" style={{ width: "100%", paddingLeft: 36 }} placeholder="Search products..." />
              </div>
              <button onClick={handleToggleSelectAll} className="pos-btn" style={{ background: "#2b253b", color: "#fff", fontSize: 12, padding: "10px 14px" }}>
                {checkedIds.size === currentTabProducts.length && currentTabProducts.length > 0 ? "Deselect All" : "Select All"}
              </button>
            </div>

            {/* Products List (Scrollable) */}
            <div style={{ flex: 1, overflowY: "auto", background: "#120f1a", borderRadius: 8, padding: 12, border: "1px solid var(--border-color)", marginBottom: 16 }}>
              {currentTabProducts.length === 0 ? (
                <div style={{ textAlign: "center", padding: 32, color: "var(--text-secondary)" }}>
                  No products found
                </div>
              ) : (
                currentTabProducts.map(p => (
                  <div key={p.id} onClick={() => handleToggleCheck(p.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px", borderBottom: "1px solid #1a1626", cursor: "pointer", background: checkedIds.has(p.id) ? "rgba(245,158,11,0.04)" : "transparent" }}>
                    <input type="checkbox" checked={checkedIds.has(p.id)} readOnly style={{ accentColor: "var(--accent-gold)", width: 16, height: 16 }} />
                    
                    {/* Image Thumbnail */}
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.display_name} style={{ width: 36, height: 36, borderRadius: 4, objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: 36, height: 36, borderRadius: 4, background: getProductColor(p.display_name), display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "14px", color: "#fff" }}>
                        {p.display_name.charAt(0).toUpperCase()}
                      </div>
                    )}

                    <div style={{ display: "flex", flex: 1, justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span style={{ fontWeight: 600, display: "block", fontSize: 13 }}>{p.display_name}</span>
                        <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{p.barcode ? `Barcode: ${p.barcode}` : "Loose Item"}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 12, color: "var(--accent-gold)", fontWeight: 700 }}>₹{p.retail_price}</span>
                        <button
                          onClick={(e) => handleUploadProductImageInScreen(p, e)}
                          title="Change Image"
                          className="pos-btn"
                          style={{
                            padding: "6px",
                            background: "#2b253b",
                            border: "none",
                            borderRadius: 4,
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          📷
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Action Bar */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button onClick={() => setManageCat(null)} className="pos-btn" style={{ background: "#2b253b", color: "#fff" }}>
                Cancel
              </button>
              <button onClick={handleBulkAction} disabled={checkedIds.size === 0} className="pos-btn" style={{ background: tab === "available" ? "var(--accent-teal)" : "var(--accent-red)", color: "#fff", opacity: checkedIds.size === 0 ? 0.5 : 1 }}>
                {tab === "available" ? `Add Selected (${checkedIds.size})` : `Remove Selected (${checkedIds.size})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UPLOAD PRODUCT IMAGE MODAL WITH CROP PREVIEW AND URL OPTION */}
      {uploadModalProduct && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 250 }}>
          <div className="pos-card animate-scale-up" style={{ width: "90%", maxWidth: 450, padding: 20, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontSize: 16, fontWeight: 800 }}>Update Product Image</h3>
              <button onClick={() => setUploadModalProduct(null)} className="pos-btn" style={{ background: "transparent", border: "none", color: "var(--text-secondary)", padding: 4 }}>
                <X size={18} />
              </button>
            </div>
            
            <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16 }}>
              Update image for <strong style={{ color: "#fff" }}>{uploadModalProduct.display_name}</strong>. Choose a method below:
            </p>

            {/* Inputs & Buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
              {/* Option 1: URL paste */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-gold)" }}>PASTE IMAGE URL</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    value={uploadPastedUrl}
                    onChange={(e) => setUploadPastedUrl(e.target.value)}
                    placeholder="https://example.com/image.jpg"
                    className="pos-input"
                    style={{ flex: 1, height: 36, fontSize: 12 }}
                  />
                  <button
                    onClick={handlePreviewUrl}
                    disabled={!uploadPastedUrl.trim()}
                    className="pos-btn"
                    style={{
                      background: "rgba(245,158,11,0.1)",
                      color: "var(--accent-gold)",
                      border: "1px solid rgba(245,158,11,0.2)",
                      fontSize: 12,
                      padding: "0 12px",
                      height: 36
                    }}
                  >
                    Preview
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>- OR -</span>
              </div>

              {/* Option 2: Upload File / Camera */}
              <div style={{ display: "flex", gap: 10 }}>
                {/* Custom File Upload Button */}
                <label
                  className="pos-btn"
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    padding: "8px 0",
                    background: "#2b253b",
                    border: "1px solid var(--border-color)",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 12,
                    textAlign: "center"
                  }}
                >
                  <UploadCloud size={14} style={{ marginRight: 4 }} /> Local File
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    style={{ display: "none" }}
                  />
                </label>

                {/* Capacitor Camera Button */}
                <button
                  onClick={handleCapacitorCamera}
                  className="pos-btn"
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    padding: "8px 0",
                    background: "#2b253b",
                    border: "1px solid var(--border-color)",
                    color: "#fff",
                    fontSize: 12
                  }}
                >
                  <Camera size={14} style={{ marginRight: 4 }} /> Camera/Gallery
                </button>
              </div>
            </div>

            {/* Crop Preview Container */}
            {uploadPreviewSrc && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
                  CROP PREVIEW (1:1 RATIO AREA ENCLOSED)
                </span>
                
                <div style={{ position: "relative", width: "100%", height: 200, background: "#0b0a0f", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", border: "1px solid var(--border-color)" }}>
                  <img
                    src={uploadPreviewSrc}
                    alt="Preview"
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                  />
                  {/* Aspect Ratio Box Mask Overlay */}
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ width: 150, height: 150, border: "2px dashed var(--accent-gold)", boxShadow: "0 0 0 9999px rgba(11, 10, 15, 0.65)", borderRadius: 4, pointerEvents: "none" }} />
                  </div>
                </div>
                
                <span style={{ fontSize: 9, color: "var(--text-secondary)", marginTop: 6, display: "block", textAlign: "center" }}>
                  Only the area inside the highlighted box will be cropped and saved.
                </span>
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button
                onClick={() => setUploadModalProduct(null)}
                className="pos-btn"
                style={{ flex: 1, background: "#2b253b", color: "#fff", padding: "10px 0" }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCroppedImage}
                disabled={!uploadPreviewSrc || isImageUploading}
                className="pos-btn"
                style={{
                  flex: 1,
                  background: "var(--accent-teal)",
                  color: "#fff",
                  padding: "10px 0",
                  opacity: (!uploadPreviewSrc || isImageUploading) ? 0.6 : 1,
                  cursor: (!uploadPreviewSrc || isImageUploading) ? "not-allowed" : "pointer"
                }}
              >
                {isImageUploading ? "Saving..." : "Save Image"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// DYNAMIC GRADIENT GENERATOR FOR PRODUCTS
// ----------------------------------------------------
function getProductColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "linear-gradient(135deg, #ec4899, #f43f5e)", // Rose pink
    "linear-gradient(135deg, #8b5cf6, #a78bfa)", // Purple
    "linear-gradient(135deg, #3b82f6, #60a5fa)", // Blue
    "linear-gradient(135deg, #10b981, #34d399)", // Emerald
    "linear-gradient(135deg, #f59e0b, #fbbf24)", // Amber
    "linear-gradient(135deg, #ef4444, #f87171)", // Red
    "linear-gradient(135deg, #14b8a6, #2dd4bf)", // Teal
  ];
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}
