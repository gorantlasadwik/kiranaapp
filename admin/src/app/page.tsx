"use client";

import React, { useState, useEffect } from "react";
import { 
  Smartphone, 
  CheckCircle2, 
  XCircle, 
  Trash2, 
  Database, 
  FileText, 
  BookOpen, 
  TrendingUp, 
  ShieldAlert, 
  Download, 
  RefreshCw, 
  Search, 
  Layers, 
  DollarSign, 
  Users, 
  Clock 
} from "lucide-react";

interface Device {
  id: string;
  device_id: string;
  device_name: string;
  android_version: string;
  app_version: string;
  manufacturer: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  requested_at: string;
}

interface Product {
  id: number;
  display_name: string;
  retail_price: number;
  wholesale_price: number;
  barcode?: string;
  aliases?: string[];
}

interface Customer {
  id: number;
  name: string;
  phone?: string;
  total_bills: number;
  total_purchases: number;
  last_visit?: string;
}

interface Bill {
  id: number;
  bill_number: number;
  customer_name?: string;
  subtotal: number;
  discount: number;
  grand_total: number;
  payment_mode: "Cash" | "UPI" | "Credit";
  status: "Completed" | "Cancelled";
  created_at: string;
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "devices" | "products" | "khata" | "bills">("dashboard");
  const [devices, setDevices] = useState<Device[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [khataMap, setKhataMap] = useState<Record<number, number>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // Load and synchronize shared local storage databases
  useEffect(() => {
    fetch("/api/devices")
      .then(res => res.json())
      .then(data => {
        setDevices(data);
        localStorage.setItem("admin_devices", JSON.stringify(data));
      })
      .catch(err => console.error("Error loading devices", err));

    const loadedBills = JSON.parse(localStorage.getItem("sr_bills") || "[]");
    const loadedProductsRaw = JSON.parse(localStorage.getItem("sr_products") || "[]");
    const loadedBarcodes = JSON.parse(localStorage.getItem("sr_barcodes") || "[]");
    const loadedCustomers = JSON.parse(localStorage.getItem("sr_customers") || "[]");
    const loadedKhata = JSON.parse(localStorage.getItem("sr_khata") || "{}");

    const loadedProducts = loadedProductsRaw.map((p: any) => {
      const activeBarcodes = loadedBarcodes.filter((b: any) => b.product_id === p.id && b.is_active).map((b: any) => b.barcode);
      return {
        ...p,
        barcode: activeBarcodes[0] || "",
        barcodes: activeBarcodes
      };
    });

    setBills(loadedBills);
    setProducts(loadedProducts);
    setCustomers(loadedCustomers);
    setKhataMap(loadedKhata);
  }, [refreshKey]);

  // Handle device approval status modifications
  const handleDeviceAction = (deviceId: string, newStatus: Device["status"]) => {
    fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_status",
        device_id: deviceId,
        status: newStatus
      })
    })
    .then(async (res) => {
      const result = await res.json();
      if (result.success) {
        setDevices(prev => prev.map(dev => dev.device_id === deviceId ? { ...dev, status: newStatus } : dev));
        
        // Sync local settings if it matches active PC simulated device
        const settings = JSON.parse(localStorage.getItem("sr_settings") || "{}");
        if (settings.device_id === deviceId) {
          settings.device_status = newStatus;
          if (newStatus === "approved") {
            settings.trusted_token = "TOKEN-" + Math.floor(Math.random() * 900000 + 100000);
          } else {
            settings.trusted_token = "";
          }
          localStorage.setItem("sr_settings", JSON.stringify(settings));
        }
        setRefreshKey(prev => prev + 1);
      }
    })
    .catch(err => console.error("Error updating status", err));
  };

  // Export JSON Database Backup
  const handleBackupExport = () => {
    const backupData = {
      exported_at: new Date().toISOString(),
      products: JSON.parse(localStorage.getItem("sr_products") || "[]"),
      customers: JSON.parse(localStorage.getItem("sr_customers") || "[]"),
      bills: JSON.parse(localStorage.getItem("sr_bills") || "[]"),
      khata: JSON.parse(localStorage.getItem("sr_khata") || "{}"),
      devices: JSON.parse(localStorage.getItem("admin_devices") || "[]")
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `sairam_kirana_backup_${new Date().toISOString().split("T")[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Statistics Computations
  const activeBills = bills.filter(b => b.status === "Completed");
  const totalRevenue = activeBills.reduce((sum, b) => sum + b.grand_total, 0);
  const cashTotal = activeBills.filter(b => b.payment_mode === "Cash").reduce((sum, b) => sum + b.grand_total, 0);
  const upiTotal = activeBills.filter(b => b.payment_mode === "UPI").reduce((sum, b) => sum + b.grand_total, 0);
  const creditTotal = activeBills.filter(b => b.payment_mode === "Credit").reduce((sum, b) => sum + b.grand_total, 0);
  
  const pendingApprovalsCount = devices.filter(d => d.status === "pending").length;
  const totalOutstandingKhata = Object.values(khataMap).reduce((sum, val) => sum + val, 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-amber-500 selection:text-slate-950">
      
      {/* HEADER SECTION */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center font-black text-lg">SR</div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">SAI RAM KIRANA</h1>
              <p className="text-xs text-slate-400 font-semibold tracking-wider uppercase">Admin Monitoring Panel</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => setRefreshKey(prev => prev + 1)}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              title="Refresh Dashboard"
            >
              <RefreshCw size={18} />
            </button>
            
            <button 
              onClick={handleBackupExport}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-slate-950 hover:bg-amber-400 transition font-bold text-sm rounded-lg"
            >
              <Download size={16} /> Export Backup
            </button>
          </div>
        </div>
      </header>

      {/* DASHBOARD GRID CONTAINER */}
      <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-8">
        
        {/* SIDE BAR NAVIGATION */}
        <aside className="flex flex-col gap-2">
          {[
            { id: "dashboard", label: "Dashboard", icon: <TrendingUp size={16} /> },
            { id: "devices", label: "Device Approvals", icon: <Smartphone size={16} />, badge: pendingApprovalsCount },
            { id: "products", label: "Product Catalog", icon: <Database size={16} /> },
            { id: "khata", label: "Khata Ledger", icon: <BookOpen size={16} /> },
            { id: "bills", label: "Bills Audit Log", icon: <FileText size={16} /> }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id as any); setSearchQuery(""); }}
              className={`flex items-center justify-between px-4 py-3 rounded-lg text-sm font-semibold transition ${
                activeTab === tab.id 
                  ? "bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/10" 
                  : "text-slate-400 hover:text-white hover:bg-slate-900"
              }`}
            >
              <div className="flex items-center gap-3">
                {tab.icon}
                <span>{tab.label}</span>
              </div>
              {tab.badge ? (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${activeTab === tab.id ? "bg-slate-950 text-amber-500" : "bg-amber-500/20 text-amber-400"}`}>
                  {tab.badge}
                </span>
              ) : null}
            </button>
          ))}
        </aside>

        {/* MAIN COMPONENT MODULE */}
        <main className="min-w-0">
          
          {/* TAB 1: DASHBOARD OVERVIEW */}
          {activeTab === "dashboard" && (
            <div className="space-y-8">
              
              {/* Stat Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { label: "Total Revenue", val: `₹${totalRevenue.toFixed(0)}`, icon: <DollarSign size={20} />, color: "border-l-amber-500" },
                  { label: "Cash Sales", val: `₹${cashTotal.toFixed(0)}`, icon: <Clock size={20} />, color: "border-l-emerald-500" },
                  { label: "UPI Payments", val: `₹${upiTotal.toFixed(0)}`, icon: <Layers size={20} />, color: "border-l-blue-500" },
                  { label: "Total Khata Outstanding", val: `₹${totalOutstandingKhata.toFixed(0)}`, icon: <ShieldAlert size={20} />, color: "border-l-rose-500" }
                ].map((stat, i) => (
                  <div key={i} className={`bg-slate-900 border border-slate-800 border-l-4 ${stat.color} rounded-xl p-5 shadow-lg`}>
                    <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
                      <span>{stat.label}</span>
                      {stat.icon}
                    </div>
                    <h2 className="text-2xl font-black mt-2 text-white">{stat.val}</h2>
                  </div>
                ))}
              </div>

              {/* Dynamic SVG sales split */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
                <h3 className="text-base font-bold text-white mb-6">Payment Mode Revenue Split</h3>
                
                {totalRevenue === 0 ? (
                  <div className="text-center py-12 text-slate-500">No active sales records logged yet. Run POS terminal to create sales data.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                    
                    {/* SVG Progress bar split */}
                    <div className="space-y-4">
                      {[
                        { label: "Cash Sales", val: cashTotal, color: "bg-emerald-500" },
                        { label: "UPI Payments", val: upiTotal, color: "bg-blue-500" },
                        { label: "Khata Credit", val: creditTotal, color: "bg-rose-500" }
                      ].map((item, idx) => {
                        const pct = totalRevenue > 0 ? (item.val / totalRevenue) * 100 : 0;
                        return (
                          <div key={idx} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className="font-semibold text-slate-300">{item.label}</span>
                              <span className="font-bold text-white">₹{item.val.toFixed(0)} ({pct.toFixed(0)}%)</span>
                            </div>
                            <div className="w-full h-3 bg-slate-850 rounded-full overflow-hidden">
                              <div className={`h-full ${item.color} rounded-full`} style={{ width: `${pct}%` }}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="bg-slate-850/50 border border-slate-800 rounded-xl p-6 text-center space-y-2">
                      <Users size={32} className="mx-auto text-amber-500" />
                      <h4 className="font-bold text-white">Registered Clients Base</h4>
                      <p className="text-2xl font-black text-white">{customers.length}</p>
                      <p className="text-xs text-slate-400">Unique consumer profiles tracking transaction visits.</p>
                    </div>

                  </div>
                )}
              </div>

            </div>
          )}

          {/* TAB 2: DEVICE APPROVALS */}
          {activeTab === "devices" && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
              <div className="p-6 border-b border-slate-800">
                <h3 className="text-base font-bold text-white">Device Approval Requests</h3>
                <p className="text-xs text-slate-400 mt-1">Approve, reject, or revoke trust tokens to control system access.</p>
              </div>

              {devices.length === 0 ? (
                <div className="p-12 text-center text-slate-500">No device requests received.</div>
              ) : (
                <div className="divide-y divide-slate-800">
                  {devices.map(dev => (
                    <div key={dev.device_id} className="p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                      <div>
                        <div className="flex items-center gap-3">
                          <h4 className="font-bold text-white text-base">{dev.device_name}</h4>
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                            dev.status === "approved" ? "bg-emerald-500/10 text-emerald-400" :
                            dev.status === "pending" ? "bg-amber-500/10 text-amber-400 animate-pulse" :
                            "bg-rose-500/10 text-rose-400"
                          }`}>
                            {dev.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-2 font-mono">
                          ID: {dev.device_id} | Brand: {dev.manufacturer} | Android: {dev.android_version} | App: {dev.app_version}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        {dev.status === "pending" && (
                          <>
                            <button
                              onClick={() => handleDeviceAction(dev.device_id, "approved")}
                              className="px-3 py-1.5 bg-emerald-500 text-slate-950 font-bold text-xs rounded hover:bg-emerald-400 transition"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleDeviceAction(dev.device_id, "rejected")}
                              className="px-3 py-1.5 bg-slate-800 text-rose-400 hover:bg-slate-700 transition font-bold text-xs rounded"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {dev.status === "approved" && (
                          <button
                            onClick={() => handleDeviceAction(dev.device_id, "revoked")}
                            className="px-3 py-1.5 bg-rose-500 text-slate-950 font-bold text-xs rounded hover:bg-rose-400 transition"
                          >
                            Revoke Access
                          </button>
                        )}
                        {dev.status === "revoked" && (
                          <button
                            onClick={() => handleDeviceAction(dev.device_id, "approved")}
                            className="px-3 py-1.5 bg-slate-800 text-slate-100 hover:bg-slate-700 transition font-bold text-xs rounded"
                          >
                            Restore Access
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: PRODUCT CATALOG */}
          {activeTab === "products" && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
              <div className="p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-white">Product Inventory</h3>
                  <p className="text-xs text-slate-400 mt-1">Monitor product prices, barcode matching, and speech search tags.</p>
                </div>

                <div className="relative w-full sm:w-64">
                  <input
                    type="text"
                    placeholder="Search product..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-lg pl-9 pr-4 py-1.5 text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  />
                  <Search size={16} className="absolute left-3 top-2 text-slate-400" />
                </div>
              </div>

              {products.length === 0 ? (
                <div className="p-12 text-center text-slate-500">No products configured in inventory. Add products inside the POS application.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-slate-350">
                    <thead className="bg-slate-850 text-slate-200 text-xs uppercase font-bold border-b border-slate-800">
                      <tr>
                        <th className="px-6 py-4">Display Name</th>
                        <th className="px-6 py-4">MRP</th>
                        <th className="px-6 py-4">Wholesale Rate</th>
                        <th className="px-6 py-4">Speech Aliases</th>
                        <th className="px-6 py-4">UPC Barcode</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {products
                        .filter(p => p.display_name.toLowerCase().includes(searchQuery.toLowerCase()))
                        .map(prod => (
                          <tr key={prod.id} className="hover:bg-slate-850/30">
                            <td className="px-6 py-4 font-bold text-white">{prod.display_name}</td>
                            <td className="px-6 py-4 font-mono">₹{prod.retail_price.toFixed(2)}</td>
                            <td className="px-6 py-4 font-mono">₹{prod.wholesale_price.toFixed(2)}</td>
                            <td className="px-6 py-4 text-xs text-slate-400">{prod.aliases?.join(", ") || "None"}</td>
                            <td className="px-6 py-4 font-mono text-xs text-amber-500">{(prod as any).barcodes && (prod as any).barcodes.length > 0 ? (prod as any).barcodes.join(", ") : "Loose Item"}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: KHATA LEDGER */}
          {activeTab === "khata" && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
              <div className="p-6 border-b border-slate-800">
                <h3 className="text-base font-bold text-white">Khata Balances Tracker</h3>
                <p className="text-xs text-slate-400 mt-1">Outstanding shop credits ledger tracking real-time client balances.</p>
              </div>

              {customers.length === 0 ? (
                <div className="p-12 text-center text-slate-500">No active customer list compiled.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-slate-350">
                    <thead className="bg-slate-850 text-slate-200 text-xs uppercase font-bold border-b border-slate-800">
                      <tr>
                        <th className="px-6 py-4">Client Name</th>
                        <th className="px-6 py-4">VPA Phone</th>
                        <th className="px-6 py-4">Total Purchases</th>
                        <th className="px-6 py-4">Total Invoiced Bills</th>
                        <th className="px-6 py-4 text-right">Credit Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {customers.map(cust => {
                        const bal = khataMap[cust.id] || 0;
                        return (
                          <tr key={cust.id} className="hover:bg-slate-850/30">
                            <td className="px-6 py-4 font-bold text-white">{cust.name}</td>
                            <td className="px-6 py-4 font-mono text-xs">{cust.phone || "NA"}</td>
                            <td className="px-6 py-4 font-mono">₹{cust.total_purchases.toFixed(0)}</td>
                            <td className="px-6 py-4">{cust.total_bills} bills</td>
                            <td className={`px-6 py-4 text-right font-bold font-mono text-base ${bal > 0 ? "text-rose-500" : "text-emerald-500"}`}>
                              ₹{bal.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: BILLS AUDIT LOG */}
          {activeTab === "bills" && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
              <div className="p-6 border-b border-slate-800">
                <h3 className="text-base font-bold text-white">Bills Audit Registry</h3>
                <p className="text-xs text-slate-400 mt-1">Audit trail of all invoices. Cancelled transactions appear crossed out.</p>
              </div>

              {bills.length === 0 ? (
                <div className="p-12 text-center text-slate-500">No invoicing records located.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-slate-350">
                    <thead className="bg-slate-850 text-slate-200 text-xs uppercase font-bold border-b border-slate-800">
                      <tr>
                        <th className="px-6 py-4">Bill No</th>
                        <th className="px-6 py-4">Timestamp</th>
                        <th className="px-6 py-4">Invoiced Client</th>
                        <th className="px-6 py-4">Payment Method</th>
                        <th className="px-6 py-4">State Status</th>
                        <th className="px-6 py-4 text-right">Invoiced Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {bills.map(bill => (
                        <tr 
                          key={bill.id} 
                          className={`hover:bg-slate-850/30 ${bill.status === "Cancelled" ? "line-through opacity-40 bg-rose-950/5" : ""}`}
                        >
                          <td className="px-6 py-4 font-mono font-bold text-amber-500">#{bill.bill_number}</td>
                          <td className="px-6 py-4 text-xs font-mono text-slate-400">{new Date(bill.created_at).toLocaleString()}</td>
                          <td className="px-6 py-4 font-semibold text-white">{bill.customer_name || "Guest Customer"}</td>
                          <td className="px-6 py-4 font-bold">{bill.payment_mode}</td>
                          <td className="px-6 py-4 text-xs uppercase">
                            <span className={`px-2 py-0.5 rounded font-bold ${bill.status === "Completed" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                              {bill.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right font-mono font-bold text-white">₹{bill.grand_total.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </main>
      </div>

    </div>
  );
}
