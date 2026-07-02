# 🛒 Sai Ram Kirana — Advanced POS & Store Management System

> A production-grade, offline-first hybrid Point of Sale ecosystem built for Indian grocery stores. It runs as an Android APK on your phone and as a web application on your PC, both syncing in real-time through Supabase.

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
  <img src="https://img.shields.io/badge/Capacitor-8-119EFF?style=for-the-badge&logo=capacitor&logoColor=white" />
  <img src="https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" />
  <img src="https://img.shields.io/badge/Android-APK-34A853?style=for-the-badge&logo=android&logoColor=white" />
  <img src="https://img.shields.io/badge/Node.js-Express-339933?style=for-the-badge&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/Groq-Llama--3.3-FF6B35?style=for-the-badge&logo=meta&logoColor=white" />
  <img src="https://img.shields.io/badge/Google-Gemini_Vision-4285F4?style=for-the-badge&logo=google&logoColor=white" />
  <img src="https://img.shields.io/badge/Zustand-State_Manager-FF9900?style=for-the-badge&logo=npm&logoColor=white" />
  <img src="https://img.shields.io/badge/jsPDF-PDF_Generator-C8102E?style=for-the-badge&logo=adobe&logoColor=white" />
  <img src="https://img.shields.io/badge/Bluetooth-ESC%2FPOS_Printer-0082FC?style=for-the-badge&logo=bluetooth&logoColor=white" />
</p>

---

## 📱 App Overview

Sai Ram Kirana POS is a full-featured store management system built with **React + TypeScript (Vite)**, compiled natively to Android via **Capacitor**, and backed by **Supabase** (PostgreSQL + Realtime + Storage). The system is designed for a real kirana (grocery) store environment — fast, multilingual, offline-capable, and fully Bluetooth-printer integrated.

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    subgraph DEVICES["📱 Client Devices"]
        APK["🤖 Android APK\n(Capacitor + React)\nPhone / Tablet"]
        WEB["🌐 Web Browser\n(Vite Dev Server)\nBilling PC"]
    end

    subgraph LOCAL_PC["💻 Local Windows PC"]
        SERVER["🚀 Express Server\nimage_manager_server.js\nPort 3000"]
        FETCHER["🤖 AI Image Fetcher\nauto_images.js\n--id=productId"]
        LOCALDB["🗄️ Local SQLite DB\n@capacitor-community/sqlite\nOffline-first store"]
        PRINTER["🖨️ Bluetooth\nThermal Printer\nESC/POS"]
    end

    subgraph SUPABASE["☁️ Supabase Cloud"]
        PGDB[("🐘 PostgreSQL DB\nproducts · barcodes\nbills · khata\ncustomers · settings")]
        RT["⚡ Realtime\nPostgres Changes\nWebSocket"]
        STORAGE[("📦 Supabase Storage\nproduct-images bucket\nWebP 300×300")]
    end

    subgraph AI_PIPELINE["🧠 AI / Search Pipeline"]
        DDG["🦆 DuckDuckGo\nImage Search"]
        GOOGLE["🔍 Google Images\ngooglethis"]
        GROQ["⚡ Groq API\nLlama-3.3-70b\nQuery Generator"]
        GEMINI["👁️ Gemini Vision\nModel Rotation Pool\n3.5-flash / 3.1-lite / 2.5-lite"]
    end

    APK -- "Voice Commands\nBarcode Scans\nBill Creation" --> LOCALDB
    WEB -- "Product Edits\nCategory Mgmt" --> LOCALDB
    LOCALDB -- "Push Queue\n(online)" --> PGDB
    PGDB -- "Pull / Merge" --> LOCALDB
    RT -- "INSERT / UPDATE / DELETE\nevents" --> LOCALDB
    RT -- "New product INSERT" --> SERVER
    SERVER -- "spawn" --> FETCHER
    FETCHER --> DDG
    FETCHER --> GOOGLE
    FETCHER --> GROQ
    GROQ -- "optimized query" --> GOOGLE
    GOOGLE -- "candidate URLs" --> GEMINI
    GEMINI -- "✅ approved image" --> STORAGE
    STORAGE -- "public URL" --> PGDB
    PGDB -- "image_url updated" --> RT
    RT -- "sync to all devices" --> APK
    APK -- "Print Bill\nPrint Barcode" --> PRINTER
    WEB -- "Test Print" --> PRINTER
```

---

## 🗺️ Application Screens

<p align="center">The app has <strong>10 screens</strong> accessible from the home dashboard:</p>

<div align="center">

| Screen | Purpose |
|:---:|:---|
| **Home** | Dashboard with module navigation + sync status |
| **Billing Terminal** | Voice/scan/catalog billing, MRP/Wholesale toggle |
| **Product Inventory** | Add/edit/delete products, prices, units, aliases |
| **Categories Settings** | Create/manage catalog categories + assign products |
| **Barcode Manager** | Register real barcodes to products |
| **System Barcodes** | Generate internal SYS-XXXXX barcodes for untagged items |
| **Sales History** | Full bill log, cancel/reprint, PDF & WhatsApp share |
| **Khata Ledger** | Customer credit accounts, voice-based payment entry |
| **Analytics Reports** | Cash/UPI/Credit sales totals and transaction counts |
| **System Settings** | Bluetooth printer MAC, UPI QR, store info |

</div>


---

## 📸 Screenshots

---

### 🏠 Home & Sync

<div align="center">
<table>
  <tr>
    <td align="center" width="50%">
      <img src="ss/home.jpeg" width="100%" alt="Home Screen" />
      <br/><sub><b>Home Dashboard</b></sub>
    </td>
    <td align="center" width="50%">
      <img src="ss/databse synchronization when queue is above 10.jpeg" width="100%" alt="Database Sync" />
      <br/><sub><b>Database Sync (Queue > 10)</b></sub>
    </td>
  </tr>
</table>
</div>

---

### 💳 Billing Terminal

<div align="center">
<table>
  <tr>
    <td align="center" width="50%">
      <img src="ss/billing terminal.jpeg" width="100%" alt="Billing Terminal" />
      <br/><sub><b>Billing Terminal — Scan / Search</b></sub>
    </td>
    <td align="center" width="50%">
      <img src="ss/billing terminal catlog.jpeg" width="100%" alt="Billing Catalog" />
      <br/><sub><b>Billing Terminal — Catalog Browser</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="ss/cart.jpeg" width="100%" alt="Cart" />
      <br/><sub><b>Active Bill / Cart View</b></sub>
    </td>
    <td align="center" width="50%">
      <img src="ss/cart 2.jpeg" width="100%" alt="Cart 2" />
      <br/><sub><b>Bill Totals & Payment Mode</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="ss/ultra fast barcode scanning in the billing terminal.jpeg" width="100%" alt="Barcode Scanning" />
      <br/><sub><b>Ultra-Fast Barcode Scanning</b></sub>
    </td>
    <td align="center" width="50%">
      <img src="ss/billing history.jpeg" width="100%" alt="Billing History" />
      <br/><sub><b>Sales History Log</b></sub>
    </td>
  </tr>
</table>
</div>

---

### 📦 Product & Category Management

<div align="center">
<table>
  <tr>
    <td align="center" width="50%">
      <img src="ss/add product or edit product page.jpeg" width="100%" alt="Add / Edit Product" />
      <br/><sub><b>Add / Edit Product Page</b></sub>
    </td>
    <td align="center" width="50%">
      <img src="ss/product image manager.jpeg" width="100%" alt="Product Image Manager" />
      <br/><sub><b>Product Image Manager</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="ss/manage categories.jpeg" width="100%" alt="Manage Categories" />
      <br/><sub><b>Manage Categories</b></sub>
    </td>
    <td align="center" width="50%">
      <img src="ss/system barcodes.jpeg" width="100%" alt="System Barcodes" />
      <br/><sub><b>System Barcodes Manager</b></sub>
    </td>
  </tr>
</table>
</div>

---

### 📒 Khata Ledger

<div align="center">
<table>
  <tr>
    <td align="center" width="50%">
      <img src="ss/khata ledger.jpeg" width="100%" alt="Khata Ledger" />
      <br/><sub><b>Khata — Customer List</b></sub>
    </td>
    <td align="center" width="50%">
      <img src="ss/khata customer account.jpeg" width="100%" alt="Khata Customer Account" />
      <br/><sub><b>Khata — Customer Account Detail</b></sub>
    </td>
  </tr>
</table>
</div>

---

### 📊 Reports & Settings

<div align="center">
<table>
  <tr>
    <td align="center" width="50%">
      <img src="ss/bussiness reports.jpeg" width="100%" alt="Business Reports" />
      <br/><sub><b>Analytics & Business Reports</b></sub>
    </td>
    <td align="center" width="50%">
      <img src="ss/pos settings.jpeg" width="100%" alt="POS Settings" />
      <br/><sub><b>System Settings</b></sub>
    </td>
  </tr>
</table>
</div>

---


The home screen serves as the central navigation hub for the store manager.

**Features:**
- Shows **9 module cards** in a responsive grid, each with an icon, color accent, title, and description
- **Online/Offline indicator** badge showing real-time connectivity status
- **Bidirectional Sync banner** with a prominent "Sync Now" button — pulls and pushes latest products, customers, bills, and Khata ledger data to/from Supabase
- Animated spin state during active sync; shows green "✅ Sync Complete!" on success
- Deep-link URL hash routing (e.g. `#new_bill`, `#products`, `#khata`) for direct screen access

---

## 💳 Billing Terminal (`new_bill`)

The most powerful and heavily-used screen. This is where all customer billing happens.

### Header Controls
- **Customer Selector**: Pick or search a customer; phone contact picker (via native Capacitor Contacts plugin)
- **MRP / Wholesale Toggle**: Switch all item prices between retail MRP and wholesale rates in real-time
- **History shortcut**: Jump to Sales History without losing the current bill

### Voice Billing Engine (V4)
The app has a **multilingual, low-latency voice command system** built specifically for Indian grocery store environments.

- **Tap microphone** → speak in English, Telugu, Hindi, or phonetic mix
- Recognized commands: adding items, removing items, editing quantities, setting customer names, choosing payment mode
- **Intelligent Quantity Parser**: Understands expressions like:
  - *"okatinara kilo"* → 1.5 kg
  - *"adhha kilo"* → 0.5 kg
  - *"pav kilo"* → 0.25 kg
  - *"dedh liter"* → 1.5 L
  - *"two pieces"*, *"oka packet"*, *"rendu"* → exact integers
- **Family Variant Resolver**: If a product name matches multiple sizes/units (e.g. "Ariel 1kg" vs "Ariel 500g"), a variant selector modal appears for the user to pick
- **Voice Learning**: Correct resolutions are recorded to improve future accuracy
- Uses a native **Android SpeechRecognition plugin** for on-device transcription; falls back to browser Web Speech API on PC
- Shows real-time transcript and a visual voice status modal while listening

### Input Methods — 2 Tabs

#### 1. Scan / Search Tab
- **Search by name**: Live fuzzy search with Fuse.js — type a product name and press Enter to add
- **Barcode scan**: Type or scan a barcode; instantly resolves to the matched product and adds it
- Handles unknown barcodes gracefully with a clear error message

#### 2. Catalog Tab
- **Category sidebar** (left): Vertical cards showing category image (rectangular thumbnail), category name (wrapped), and item count — filtered by All, Recent, Fast Selling, individual categories, and Uncategorized
- **Product grid** (right): Product photo, name, and price badge; tap to add to bill
- Separate search bar for filtering within the catalog
- Paginated grid to handle 600+ product catalogs without lag

### Bill Management Panel (Right Column)
- Live bill table with columns: Product name, unit/quantity, unit price, line total, and a ❌ remove button
- **Inline edit** for quantity and unit per line item
- **Discount input**: Flat rupee discount applied to subtotal
- **Subtotal → Discount → Grand Total** breakdown
- **Payment Mode**: Cash / UPI / Credit (Khata) selector with highlighted active mode
- **Complete Bill & Print**: Triggers Bluetooth thermal printer; shows animated confetti on success 🎊
- **Save Without Printing**: Saves bill to local DB without sending to printer
- Draft bill persistence: If you leave the screen with an active bill, it is saved as a recoverable draft

---

## 📦 Product Inventory (`products`)

Full CRUD management of the product catalog.

**Features:**
- Search products by name with live fuzzy filtering
- **Add New Product** form with:
  - Display name, category assignment, retail price, wholesale price
  - Multiple **unit variants** (e.g. "500g @ ₹45", "1kg @ ₹85") — each with their own price
  - **Unit Conversion definitions** (e.g. 1 Sack = 50 kg)
  - Product **aliases** for voice recognition (alternate names a shopkeeper might say)
- **Edit Product**: Modify any field inline; changes sync to Supabase
- **Delete Product**: Soft-delete with confirmation dialog
- Unit selector is smart: shows product-specific units first, then category default units, then generic fallbacks

---

## 🗂️ Categories Settings (`categories`)

Two-tab screen for managing catalog categories and product images.

### Tab 1: Categories
- **Category list** with drag-free ordering via `display_order` field
- Create/Edit modal: Category name, display order, optional image URL
- **Delete** category with confirmation
- Each category card shows thumbnail image, item count, and action buttons

### Tab 2: Product Image Manager
- **Category sidebar** (left): Filter products by category using beautiful vertical cards (rectangular image + category name below)
- **Product grid** (right): All products with their photos; each card shows the product image prominently
- **Upload/Change Image** flow:
  - **Paste URL**: Type or paste any web image URL
  - **Choose File**: Local file picker for selecting photos from device storage
  - **Capacitor Camera**: Take a live photo or pick from gallery on Android
  - **Crop Preview**: A golden dashed 1:1 square overlay mask shows exactly how the final cropped product image will look
  - Images are center-cropped to a **300×300 px WebP** on a canvas and uploaded to Supabase Storage
- **Auto-Fetch Images button**: Triggers the AI image fetcher pipeline for all products without images

---

## 📷 Barcode Manager (`barcode`)

Associates real-world EAN/UPC barcodes with catalog products.

**Features:**
- Search by barcode or product name
- Assign a barcode to a product (creates/updates the `barcodes` table entry)
- View all registered barcodes with their linked product names
- Re-assign barcodes to different products
- Delete barcode associations

---

## 🏷️ System Barcodes (`system_barcodes`)

Generate custom internal barcodes for products that don't have a physical barcode sticker (e.g. loose items, local brands).

**Features:**
- Search through all system barcodes (`SYS-XXXXX` format)
- **Generate new**: Creates a unique system barcode for any product
- **Print Label**: Sends the barcode label directly to the Bluetooth thermal printer; also shows a live preview SVG of the barcode
- **Delete**: Remove a system barcode from the database
- Paginated view for large barcode sets

---

## 📜 Sales History (`history`)

A complete log of all bills ever created.

**Features:**
- Chronological bill list with customer name, date, total, and payment mode badge (Cash/UPI/Credit)
- **Bill detail view**: Tap any bill to see every line item, quantities, prices, and totals
- **Cancel Bill**: Void a previously printed bill (updates status to "Cancelled")
- **Reprint**: Resend the bill to the Bluetooth printer
- **PDF generation**: Download the bill as a formatted PDF
- **WhatsApp Share**: Generate and share the bill summary via WhatsApp
- Filter and navigate between bills; referrer-aware back navigation (returns to home or billing terminal depending on how the user arrived)

---

## 📒 Khata Credit Ledger (`khata`)

A digital version of the traditional Indian "Khata" (credit ledger) for tracking customer balances.

**Features:**
- **Customer list** with outstanding balance displayed for each customer
- **Add Customer**: Name, phone, optional opening credit balance, and a note
- **Customer detail view**:
  - Full transaction timeline showing credit sales and payments
  - Attach a photo receipt/proof to any transaction
  - View attached image proof for past transactions
- **Record Payment**: Enter amount, description, and date manually
- **Voice Payment Entry**: Speak a payment command (e.g. *"Ram paid 500"*) — the system identifies the customer by name, parses the amount, and records the transaction
- **PDF Ledger Export**: Generate a printable Khata summary PDF
- **WhatsApp Share**: Send the ledger statement to the customer
- Customer search with live filtering across all accounts

---

## 📊 Analytics Reports (`reports`)

Business intelligence summary screen.

**Metrics displayed:**
| Card | Value |
|---|---|
| Gross Sales | Total revenue across all bills |
| Cash Sales | Revenue from cash-mode bills |
| UPI Sales | Revenue from UPI-mode bills |
| Credit Sales | Revenue booked as credit (Khata) |
| Total Transactions | Count of active (non-cancelled) bills |
| Pending Khata | Total outstanding credit balance across all customers |

All metrics are computed live from the local database.

---

## ⚙️ System Settings (`settings`)

Configure all hardware and integration settings.

**Sections:**
- **Store Name**: Appears on printed bills and PDF headers
- **UPI ID**: Printed on the bill footer for customer payments
- **UPI QR Code**: Upload a QR code image; the app decodes it automatically using `jsQR` to verify and store the payment address
- **Bluetooth Printer**:
  - Scan for available Bluetooth devices
  - Connect/disconnect to paired printers
  - Set MAC address and printer name manually
  - Toggle auto-reconnect on startup
  - **Test Print**: Send a test receipt to verify the printer connection
  - Adjust QR size parameter for thermal print density

---

## 🤖 AI Image Fetcher Pipeline

A standalone Node.js script (`auto_images.js`) and Express server (`image_manager_server.js`) that runs on your local Windows PC.

### Pipeline (per product):
```
Step 1: DuckDuckGo search → barcode + product name
Step 2: Google search    → barcode + product name
  ↓ (if both fail)
Step 3: Groq AI (Llama-3.3-70b) identifies product category → optimized search query
Step 4: Google search with AI query
Step 5: DDG search with AI query
  ↓
For each candidate image:
  → Validate magic bytes (PNG/JPG/WebP/GIF/BMP) — reject HTML errors
  → Fast Mode: branded products saved directly
  → Vision Mode: ambiguous items verified via Gemini Vision (model pool)
  → If approved → upload to Supabase Storage → update product image_url
```

### Model Rotation Pool
To avoid Gemini API rate limits (429 errors), the script automatically rotates between:
- `gemini-3.5-flash`
- `gemini-3.1-flash-lite`
- `gemini-2.5-flash-lite`

### Single-Product Mode
```bash
node auto_images.js --id=123
```
Fetches the image for one specific product by database ID — used by the autonomous server trigger.

### Autonomous Realtime Worker
`image_manager_server.js` runs on port `3000` and:
- Subscribes to Supabase Realtime `INSERT` events on the `products` table
- When a new product is created from **any client** (Android APK, admin panel, etc.), the server immediately spawns `auto_images.js --id=<newId>` in the background
- Responds via `POST /api/fetch-product-image` for manual triggers from the frontend

---

## 🔄 Bidirectional Sync Engine

Implemented in `src/syncEngine.ts` using Supabase Realtime channels.

**How it works:**
1. **Local-first writes**: All bills, products, and customer edits are saved to local IndexedDB (via `@capacitor-community/sqlite`) first
2. **Push queue**: Changes are queued and pushed to Supabase when online
3. **Pull on connect**: On reconnect, the engine pulls the latest remote state and merges it locally
4. **Realtime subscriptions**: Listens to `postgres_changes` events on all catalog and transaction tables — updates local store instantly without a full pull
5. **Print job relay**: New print jobs inserted by any device are picked up by the host device automatically via realtime

---

## 🖨️ Bluetooth Thermal Printer Integration

Full ESC/POS command generation for 58mm/80mm thermal receipt printers.

**Supported print types:**
- **Customer Receipt**: Store name, customer details, itemized bill, subtotal, discount, grand total, UPI QR code, payment mode
- **Barcode Label**: Product name + Code128 barcode SVG + unit type
- **Test Page**: Connectivity verification print

**Connection modes:**
- Auto-connect on app start
- Manual scan and pair from Settings
- Reconnect button for dropped connections

---

## 🗄️ Database Schema

Managed via Supabase PostgreSQL. Key tables:

| Table | Purpose |
|---|---|
| `products` | Product catalog with prices, units, aliases, image URLs |
| `barcodes` | EAN/UPC and SYS-XXXXX barcode-to-product mappings |
| `customers` | Customer profiles with phone numbers |
| `bills` | Bill headers with totals, payment mode, and status |
| `bill_items` | Line items for each bill |
| `khata` | Customer credit account balances |
| `khata_transactions` | Individual credit/payment entries |
| `catalog_categories` | Product categories with image URLs and display order |
| `product_categories` | Many-to-many product ↔ category mapping |
| `settings` | Store name, UPI ID, printer config, device ID |
| `print_jobs` | Cross-device print job relay queue |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+, Java JDK 17+, Android Studio (for APK builds)
- A Supabase project (free tier works)
- A Groq API key (free tier)
- A Google Gemini API key (free tier)

### 1. Clone & Setup
```bash
git clone https://github.com/gorantlasadwik/kiranaapp.git
cd kiranaapp/app
npm install
```

### 2. Configure Environment
Create `app/.env`:
```env
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_GROQ_API_KEY=your_groq_key
VITE_GEMINI_API_KEY=your_gemini_key
```

### 3. Run Web Dev Server (Billing PC)
```bash
npm run dev
# Opens at http://localhost:5173
```

### 4. Run Image Worker Server
```bash
node image_manager_server.js
# Starts on http://localhost:3000
# Listens for new products and auto-fetches images
```

### 5. Build Android APK
```bash
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

### 6. Run Bulk Image Fetch
```bash
node auto_images.js
# Fetches images for ALL products missing images
# Takes 10-30 minutes for 600+ products
```

---

## 🛡️ Security Notes

- `.env` files are **gitignored** — never committed
- APK binaries are **gitignored** — contain compiled env variables
- Pre-compiled static bundles (`admin/public/pos/`) are **gitignored** — may contain embedded credentials
- All API keys are loaded at build time via Vite environment variables

---

## 🛠️ Tech Stack

### Frontend & Native
<p>
  <img src="https://img.shields.io/badge/React-19.2-61DAFB?style=flat-square&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Vite-8.0-646CFF?style=flat-square&logo=vite&logoColor=white" />
  <img src="https://img.shields.io/badge/Capacitor-8.4-119EFF?style=flat-square&logo=capacitor&logoColor=white" />
  <img src="https://img.shields.io/badge/Android-APK-34A853?style=flat-square&logo=android&logoColor=white" />
</p>

### Backend & Database
<p>
  <img src="https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square&logo=supabase&logoColor=white" />
  <img src="https://img.shields.io/badge/Supabase-Realtime-3ECF8E?style=flat-square&logo=supabase&logoColor=white" />
  <img src="https://img.shields.io/badge/Supabase-Storage-3ECF8E?style=flat-square&logo=supabase&logoColor=white" />
  <img src="https://img.shields.io/badge/SQLite-Local_DB-003B57?style=flat-square&logo=sqlite&logoColor=white" />
  <img src="https://img.shields.io/badge/Node.js-Express-339933?style=flat-square&logo=node.js&logoColor=white" />
</p>

### AI & Search
<p>
  <img src="https://img.shields.io/badge/Groq-Llama--3.3--70b-FF6B35?style=flat-square&logo=meta&logoColor=white" />
  <img src="https://img.shields.io/badge/Google-Gemini_Vision-4285F4?style=flat-square&logo=google&logoColor=white" />
  <img src="https://img.shields.io/badge/DuckDuckGo-Image_Search-DE5833?style=flat-square&logo=duckduckgo&logoColor=white" />
  <img src="https://img.shields.io/badge/Google-Image_Search-4285F4?style=flat-square&logo=google&logoColor=white" />
</p>

### UI, State & Utilities
<p>
  <img src="https://img.shields.io/badge/Zustand-State_Manager-FF9900?style=flat-square&logo=npm&logoColor=white" />
  <img src="https://img.shields.io/badge/Lucide-React_Icons-F56565?style=flat-square&logo=lucide&logoColor=white" />
  <img src="https://img.shields.io/badge/Fuse.js-Fuzzy_Search-00ADD8?style=flat-square&logo=npm&logoColor=white" />
  <img src="https://img.shields.io/badge/jsPDF-PDF_Generator-C8102E?style=flat-square&logo=adobe&logoColor=white" />
  <img src="https://img.shields.io/badge/canvas--confetti-Celebrations-FFD700?style=flat-square&logo=npm&logoColor=black" />
</p>

### Hardware & Scanning
<p>
  <img src="https://img.shields.io/badge/Bluetooth-ESC%2FPOS_Printer-0082FC?style=flat-square&logo=bluetooth&logoColor=white" />
  <img src="https://img.shields.io/badge/Quagga2-Barcode_Scanner-8B4513?style=flat-square&logo=npm&logoColor=white" />
  <img src="https://img.shields.io/badge/html5--qrcode-QR_Scanner-E34F26?style=flat-square&logo=html5&logoColor=white" />
  <img src="https://img.shields.io/badge/jsQR-QR_Decoder-000000?style=flat-square&logo=npm&logoColor=white" />
  <img src="https://img.shields.io/badge/Haptics-Capacitor-119EFF?style=flat-square&logo=capacitor&logoColor=white" />
</p>

### Voice & Speech
<p>
  <img src="https://img.shields.io/badge/Android-SpeechRecognition_Plugin-34A853?style=flat-square&logo=android&logoColor=white" />
  <img src="https://img.shields.io/badge/Web_Speech-API_Fallback-4285F4?style=flat-square&logo=google-chrome&logoColor=white" />
</p>
