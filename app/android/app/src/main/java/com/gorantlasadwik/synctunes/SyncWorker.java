package com.gorantlasadwik.synctunes;

import android.app.ActivityManager;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

public class SyncWorker extends Worker {
    private static final String TAG = "SyncWorker";
    private static final int MAX_RETRIES = 5;

    public SyncWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();

        // 1. Skip sync if the app is currently in the foreground (let the JS engine handle it)
        if (isAppInForeground(context)) {
            Log.d(TAG, "App is in foreground. Skipping background sync worker execution.");
            return Result.success();
        }

        Log.d(TAG, "Starting background sync worker execution...");

        // 2. Locate and open SQLite database
        File dbFile = context.getDatabasePath("sairamkiranaSQLite.db");
        if (!dbFile.exists()) {
            dbFile = context.getDatabasePath("sairamkirana.db");
        }
        if (!dbFile.exists()) {
            Log.w(TAG, "SQLite database file not found. Skipping sync.");
            return Result.success();
        }

        SQLiteDatabase db = null;
        try {
            db = SQLiteDatabase.openDatabase(dbFile.getAbsolutePath(), null, SQLiteDatabase.OPEN_READWRITE);

            // 3. Retrieve Supabase URL and Anon Key from local_store
            String supabaseUrl = getLocalStoreValue(db, "supabase_url");
            String supabaseAnonKey = getLocalStoreValue(db, "supabase_anon_key");

            if (supabaseUrl == null || supabaseUrl.isEmpty() || supabaseAnonKey == null || supabaseAnonKey.isEmpty()) {
                Log.w(TAG, "Supabase URL or API key not found in local SQLite database. Skipping sync.");
                db.close();
                return Result.success();
            }

            // 4. Retrieve settings for initialization status and last sync time
            String settingsJson = getLocalStoreValue(db, "sr_settings");
            boolean isInitialized = false;
            String deviceId = "unknown";
            String lastSyncAt = "1970-01-01T00:00:00.000Z";

            if (settingsJson != null && !settingsJson.isEmpty()) {
                try {
                    JSONObject settingsObj = new JSONObject(settingsJson);
                    isInitialized = "true".equals(settingsObj.optString("local_database_initialized", "false"));
                    deviceId = settingsObj.optString("device_id", "unknown");
                    lastSyncAt = settingsObj.optString("last_sync_at", "1970-01-01T00:00:00.000Z");
                } catch (Exception e) {
                    Log.e(TAG, "Failed to parse settings JSON: ", e);
                }
            }

            if (!isInitialized) {
                Log.w(TAG, "Local SQLite database is not yet initialized. Skipping sync.");
                db.close();
                return Result.success();
            }

            // 5. Run push queue & pull sync
            Map<String, String> headers = new HashMap<>();
            headers.put("apikey", supabaseAnonKey);
            headers.put("Authorization", "Bearer " + supabaseAnonKey);
            headers.put("Content-Type", "application/json");

            db.beginTransaction();
            try {
                // Step A: Push local pending changes from queue
                pushSyncQueue(db, supabaseUrl, headers, deviceId);

                // Step B: Pull remote updates and merge
                pullRemoteChanges(db, supabaseUrl, headers, lastSyncAt, deviceId);

                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }

        } catch (Exception e) {
            Log.e(TAG, "Background sync transaction failed: ", e);
            return Result.retry();
        } finally {
            if (db != null && db.isOpen()) {
                db.close();
            }
        }

        Log.d(TAG, "Background sync worker completed successfully.");
        return Result.success();
    }

    private String getLocalStoreValue(SQLiteDatabase db, String key) {
        String val = null;
        Cursor c = null;
        try {
            c = db.rawQuery("SELECT val FROM local_store WHERE key = ?", new String[]{key});
            if (c.moveToFirst()) {
                val = c.getString(0);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to query local_store key: " + key, e);
        } finally {
            if (c != null) c.close();
        }
        return val;
    }

    private void pushSyncQueue(SQLiteDatabase db, String supabaseUrl, Map<String, String> headers, String deviceId) {
        String queueVal = getLocalStoreValue(db, "sr_sync_queue");
        if (queueVal == null || queueVal.isEmpty() || "[]".equals(queueVal)) return;

        try {
            JSONArray queue = new JSONArray(queueVal);
            JSONArray updatedQueue = new JSONArray();
            int pushedCount = 0;

            for (int i = 0; i < queue.length(); i++) {
                JSONObject item = queue.getJSONObject(i);
                String status = item.optString("status", "pending");
                int retryCount = item.optInt("retry_count", 0);

                if ("synced".equals(status) || retryCount >= MAX_RETRIES) {
                    continue; // Skip already synced or dead items
                }

                boolean success = syncRecord(item, supabaseUrl, headers, deviceId);
                if (success) {
                    pushedCount++;
                    // Item synced successfully, omit it from the updated queue
                } else {
                    item.put("status", "failed");
                    item.put("retry_count", retryCount + 1);
                    updatedQueue.put(item); // Retain item in queue
                }
            }

            if (pushedCount > 0 || updatedQueue.length() != queue.length()) {
                db.execSQL("INSERT OR REPLACE INTO local_store (key, val) VALUES ('sr_sync_queue', ?)", new Object[]{updatedQueue.toString()});
                Log.d(TAG, "Sync queue updated. Pushed " + pushedCount + " items, remaining queue size: " + updatedQueue.length());
            }
        } catch (Exception e) {
            Log.e(TAG, "Error pushing sync queue: ", e);
        }
    }

    private boolean syncRecord(JSONObject item, String supabaseUrl, Map<String, String> headers, String deviceId) {
        try {
            String table = item.getString("table_name");
            String action = item.getString("action");
            String recordId = item.getString("record_id");
            JSONObject payload = new JSONObject(item.getString("payload"));

            // ── RPC triggers for Bills ──
            if ("bills".equals(table)) {
                if ("INSERT".equals(action)) {
                    JSONObject body = new JSONObject();
                    body.put("p_bill_id", payload.optString("bill_id", ""));
                    body.put("p_customer_id", payload.isNull("customer_id") ? JSONObject.NULL : payload.optInt("customer_id"));
                    body.put("p_customer_name", payload.optString("customer_name", "Customer"));
                    body.put("p_customer_phone", payload.optString("customer_phone", "NA"));
                    body.put("p_subtotal", payload.optDouble("subtotal", 0.0));
                    body.put("p_discount", payload.optDouble("discount", 0.0));
                    body.put("p_grand_total", payload.optDouble("grand_total", 0.0));
                    body.put("p_payment_mode", payload.optString("payment_mode", "Cash"));
                    body.put("p_status", payload.optString("status", "Completed"));

                    JSONArray items = payload.optJSONArray("items");
                    JSONArray pItems = new JSONArray();
                    if (items != null) {
                        for (int k = 0; k < items.length(); k++) {
                            JSONObject itemObj = items.getJSONObject(k);
                            JSONObject pItem = new JSONObject();
                            pItem.put("product_id", itemObj.optInt("product_id", 0));
                            pItem.put("product_name", itemObj.optString("product_name", ""));
                            pItem.put("quantity", itemObj.optDouble("quantity", 0.0));
                            pItem.put("unit", itemObj.optString("unit", ""));
                            pItem.put("price", itemObj.optDouble("price", 0.0));
                            pItem.put("total", itemObj.optDouble("total", 0.0));
                            pItems.put(pItem);
                        }
                    }
                    body.put("p_items", pItems);
                    body.put("p_created_at", payload.optString("created_at", ""));

                    HttpResult res = sendHttpRequest(supabaseUrl + "/rest/v1/rpc/checkout_bill_v1", "POST", body.toString(), headers);
                    return res.code >= 200 && res.code < 300;
                }

                if ("UPDATE".equals(action)) {
                    String status = payload.optString("status", "");
                    if ("Cancelled".equals(status)) {
                        JSONObject body = new JSONObject();
                        body.put("p_bill_id", Integer.parseInt(recordId));
                        HttpResult res = sendHttpRequest(supabaseUrl + "/rest/v1/rpc/cancel_bill_v1", "POST", body.toString(), headers);
                        return res.code >= 200 && res.code < 300;
                    } else if ("Completed".equals(status)) {
                        JSONObject body = new JSONObject();
                        body.put("p_bill_id", Integer.parseInt(recordId));
                        HttpResult res = sendHttpRequest(supabaseUrl + "/rest/v1/rpc/undo_cancel_bill_v1", "POST", body.toString(), headers);
                        return res.code >= 200 && res.code < 300;
                    } else {
                        JSONObject body = new JSONObject();
                        body.put("p_bill", payload);
                        HttpResult res = sendHttpRequest(supabaseUrl + "/rest/v1/rpc/update_bill_v1", "POST", body.toString(), headers);
                        return res.code >= 200 && res.code < 300;
                    }
                }
            }

            // ── Soft deletes check ──
            List<String> softDeleteTables = Arrays.asList("products", "barcodes", "customers", "bills", "khata_transactions", "voice_phrase_cache");

            if ("DELETE".equals(action)) {
                if (softDeleteTables.contains(table)) {
                    JSONObject softDeletePayload = new JSONObject();
                    softDeletePayload.put("is_deleted", true);
                    softDeletePayload.put("updated_by", deviceId);
                    softDeletePayload.put("updated_at", new Date().toString());

                    HttpResult res = sendHttpRequest(supabaseUrl + "/rest/v1/" + table + "?id=eq." + recordId, "PATCH", softDeletePayload.toString(), headers);
                    return res.code >= 200 && res.code < 300;
                } else {
                    HttpResult res = sendHttpRequest(supabaseUrl + "/rest/v1/" + table + "?id=eq." + recordId, "DELETE", null, headers);
                    return res.code >= 200 && res.code < 300;
                }
            }

            // ── Standard INSERT / UPDATE ──
            payload.put("updated_by", deviceId);

            if ("INSERT".equals(action)) {
                Map<String, String> insertHeaders = new HashMap<>(headers);
                insertHeaders.put("Prefer", "resolution=merge-duplicates");
                HttpResult res = sendHttpRequest(supabaseUrl + "/rest/v1/" + table, "POST", payload.toString(), insertHeaders);
                return res.code >= 200 && res.code < 300;
            } else if ("UPDATE".equals(action)) {
                HttpResult res = sendHttpRequest(supabaseUrl + "/rest/v1/" + table + "?id=eq." + recordId, "PATCH", payload.toString(), headers);
                return res.code >= 200 && res.code < 300;
            }

        } catch (Exception e) {
            Log.e(TAG, "Failed to push record: ", e);
        }
        return false;
    }

    private void pullRemoteChanges(SQLiteDatabase db, String supabaseUrl, Map<String, String> headers, String lastSyncAt, String deviceId) {
        try {
            JSONObject body = new JSONObject();
            body.put("p_since", lastSyncAt);

            HttpResult res = sendHttpRequest(supabaseUrl + "/rest/v1/rpc/pull_changes_since", "POST", body.toString(), headers);
            if (res.code < 200 || res.code >= 300) {
                Log.e(TAG, "pull_changes_since RPC failed with code: " + res.code + ", payload: " + res.body);
                return;
            }

            JSONObject data = new JSONObject(res.body);

            // Merge table by table
            mergeTable(db, "sr_products",          data.optJSONArray("products"),          "id", deviceId);
            mergeTable(db, "sr_barcodes",          data.optJSONArray("barcodes"),          "id", deviceId);
            mergeTable(db, "sr_customers",         data.optJSONArray("customers"),         "id", deviceId);
            mergeTable(db, "sr_categories",        data.optJSONArray("categories"),        "id", deviceId);
            mergeTable(db, "sr_voice_cache",       data.optJSONArray("voice_phrase_cache"), "id", deviceId);
            mergeTable(db, "sr_voice_memory",      data.optJSONArray("voice_memory"),      "id", deviceId);
            mergeTable(db, "sr_voice_corrections", data.optJSONArray("voice_corrections"), "id", deviceId);
            mergeTable(db, "sr_voice_logs",         data.optJSONArray("voice_logs"),         "id", deviceId);
            mergeTable(db, "sr_barcode_master",    data.optJSONArray("barcode_master"),    "barcode", deviceId);
            mergeTable(db, "sr_product_aliases",   data.optJSONArray("product_aliases"),   "id", deviceId);
            mergeTable(db, "sr_units",             data.optJSONArray("units"),             "id", deviceId);

            // Merge Print Jobs
            JSONArray printJobs = data.optJSONArray("print_jobs");
            if (printJobs != null && printJobs.length() > 0) {
                mergePrintJobs(db, printJobs);
            }

            // Merge Bills
            JSONArray bills = data.optJSONArray("bills");
            JSONArray billItems = data.optJSONArray("bill_items");
            if (bills != null && bills.length() > 0) {
                mergeBills(db, bills, billItems != null ? billItems : new JSONArray());
            }

            // Merge Khata authoritative snapshots
            JSONArray khata = data.optJSONArray("khata");
            if (khata != null && khata.length() > 0) {
                mergeKhata(db, khata);
            }
            JSONArray khataTxs = data.optJSONArray("khata_transactions");
            if (khataTxs != null && khataTxs.length() > 0) {
                mergeTable(db, "sr_khata_txs", khataTxs, "id", deviceId);
            }

            // Merge Settings (carefully omitting credentials)
            JSONArray settings = data.optJSONArray("settings");
            if (settings != null && settings.length() > 0) {
                mergeSettings(db, settings);
            }

            // Save updated last_sync_at setting
            String settingsVal = getLocalStoreValue(db, "sr_settings");
            if (settingsVal != null && !settingsVal.isEmpty()) {
                JSONObject settingsObj = new JSONObject(settingsVal);
                settingsObj.put("last_sync_at", new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(new Date()));
                db.execSQL("INSERT OR REPLACE INTO local_store (key, val) VALUES ('sr_settings', ?)", new Object[]{settingsObj.toString()});
            }

        } catch (Exception e) {
            Log.e(TAG, "Error pulling remote changes: ", e);
        }
    }

    private void mergeTable(SQLiteDatabase db, String localKey, JSONArray remoteArray, String idFieldName, String deviceId) {
        if (remoteArray == null || remoteArray.length() == 0) return;
        try {
            String localVal = getLocalStoreValue(db, localKey);
            JSONArray localArray = new JSONArray(localVal == null || localVal.isEmpty() ? "[]" : localVal);
            Map<String, JSONObject> localMap = new HashMap<>();

            for (int i = 0; i < localArray.length(); i++) {
                JSONObject obj = localArray.getJSONObject(i);
                if (obj.has(idFieldName)) {
                    if ("sr_khata_txs".equals(localKey) && obj.has("description") && obj.getString("description").startsWith("Credit Purchase - Bill #")) {
                        localMap.put(obj.getString("description"), obj);
                    } else {
                        localMap.put(obj.getString(idFieldName), obj);
                    }
                }
            }

            boolean changed = false;
            for (int i = 0; i < remoteArray.length(); i++) {
                JSONObject remote = remoteArray.getJSONObject(i);
                if (!remote.has(idFieldName)) continue;

                // Echo check: ignore echo updates made by this device
                if (deviceId.equals(remote.optString("updated_by", ""))) {
                    continue;
                }

                String lookupKey = ("sr_khata_txs".equals(localKey) && remote.has("description") && remote.getString("description").startsWith("Credit Purchase - Bill #"))
                        ? remote.getString("description")
                        : remote.getString(idFieldName);

                JSONObject existing = localMap.get(lookupKey);
                if (existing == null) {
                    localMap.put(lookupKey, remote);
                    changed = true;
                } else {
                    int localVer = existing.optInt("version", 0);
                    int remoteVer = remote.optInt("version", 0);
                    long localTime = parseTime(existing.optString("updated_at", ""));
                    long remoteTime = parseTime(remote.optString("updated_at", ""));

                    if (remoteVer > localVer || (remoteVer == localVer && remoteTime > localTime)) {
                        localMap.put(lookupKey, remote);
                        changed = true;
                    }
                }
            }

            if (changed) {
                JSONArray newArray = new JSONArray();
                for (JSONObject obj : localMap.values()) {
                    newArray.put(obj);
                }
                db.execSQL("INSERT OR REPLACE INTO local_store (key, val) VALUES (?, ?)", new Object[]{localKey, newArray.toString()});
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to merge table: " + localKey, e);
        }
    }

    private void mergePrintJobs(SQLiteDatabase db, JSONArray remoteJobs) {
        try {
            String localVal = getLocalStoreValue(db, "sr_print_jobs");
            JSONArray localArray = new JSONArray(localVal == null || localVal.isEmpty() ? "[]" : localVal);
            Map<Integer, JSONObject> localMap = new HashMap<>();

            for (int i = 0; i < localArray.length(); i++) {
                JSONObject obj = localArray.getJSONObject(i);
                localMap.put(obj.optInt("id", 0), obj);
            }

            boolean changed = false;
            for (int i = 0; i < remoteJobs.length(); i++) {
                JSONObject remote = remoteJobs.getJSONObject(i);
                int jobId = remote.optInt("id", 0);
                JSONObject existing = localMap.get(jobId);

                if (existing == null) {
                    localMap.put(jobId, remote);
                    changed = true;
                } else {
                    long localTime = parseTime(existing.optString("updated_at", ""));
                    long remoteTime = parseTime(remote.optString("updated_at", ""));
                    if (remoteTime >= localTime) {
                        localMap.put(jobId, remote);
                        changed = true;
                    }
                }
            }

            if (changed) {
                JSONArray newArray = new JSONArray();
                for (JSONObject obj : localMap.values()) {
                    newArray.put(obj);
                }
                db.execSQL("INSERT OR REPLACE INTO local_store (key, val) VALUES ('sr_print_jobs', ?)", new Object[]{newArray.toString()});
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to merge print jobs: ", e);
        }
    }

    private void mergeBills(SQLiteDatabase db, JSONArray remoteBills, JSONArray remoteBillItems) {
        try {
            String localVal = getLocalStoreValue(db, "sr_bills");
            JSONArray localArray = new JSONArray(localVal == null || localVal.isEmpty() ? "[]" : localVal);
            Map<String, JSONObject> localMap = new HashMap<>();

            for (int i = 0; i < localArray.length(); i++) {
                JSONObject obj = localArray.getJSONObject(i);
                if (obj.has("bill_id")) {
                    localMap.put(obj.getString("bill_id"), obj);
                }
            }

            boolean changed = false;
            for (int i = 0; i < remoteBills.length(); i++) {
                JSONObject remote = remoteBills.getJSONObject(i);
                if (!remote.has("bill_id")) continue;

                String billId = remote.getString("bill_id");
                int remoteId = remote.optInt("id", 0);

                // Build inline items array
                JSONArray itemsForBill = new JSONArray();
                for (int j = 0; j < remoteBillItems.length(); j++) {
                    JSONObject itemObj = remoteBillItems.getJSONObject(j);
                    if (itemObj.optInt("bill_id", -1) == remoteId) {
                        itemsForBill.put(itemObj);
                    }
                }
                remote.put("items", itemsForBill);

                JSONObject existing = localMap.get(billId);
                if (existing == null) {
                    localMap.put(billId, remote);
                    changed = true;
                } else {
                    int localVer = existing.optInt("version", 0);
                    int remoteVer = remote.optInt("version", 0);
                    if (remoteVer > localVer) {
                        localMap.put(billId, remote);
                        changed = true;
                    } else if (existing.optInt("id", 0) != remoteId) {
                        existing.put("id", remoteId);
                        JSONArray existingItems = existing.optJSONArray("items");
                        if (existingItems != null) {
                            for (int k = 0; k < existingItems.length(); k++) {
                                existingItems.getJSONObject(k).put("bill_id", remoteId);
                            }
                        }
                        changed = true;
                    }
                }
            }

            if (changed) {
                JSONArray newArray = new JSONArray();
                for (JSONObject obj : localMap.values()) {
                    newArray.put(obj);
                }
                db.execSQL("INSERT OR REPLACE INTO local_store (key, val) VALUES ('sr_bills', ?)", new Object[]{newArray.toString()});
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to merge bills: ", e);
        }
    }

    private void mergeKhata(SQLiteDatabase db, JSONArray remoteKhata) {
        try {
            String localVal = getLocalStoreValue(db, "sr_khata");
            JSONObject localObj = new JSONObject(localVal == null || localVal.isEmpty() ? "{}" : localVal);
            boolean changed = false;

            for (int i = 0; i < remoteKhata.length(); i++) {
                JSONObject k = remoteKhata.getJSONObject(i);
                String custId = k.optString("customer_id", "");
                double balance = k.optDouble("balance", 0.0);
                if (!custId.isEmpty()) {
                    localObj.put(custId, balance);
                    changed = true;
                }
            }

            if (changed) {
                db.execSQL("INSERT OR REPLACE INTO local_store (key, val) VALUES ('sr_khata', ?)", new Object[]{localObj.toString()});
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to merge khata balances: ", e);
        }
    }

    private void mergeSettings(SQLiteDatabase db, JSONArray remoteSettings) {
        try {
            String localVal = getLocalStoreValue(db, "sr_settings");
            JSONObject localObj = new JSONObject(localVal == null || localVal.isEmpty() ? "{}" : localVal);
            boolean changed = false;

            List<String> pullableKeys = Arrays.asList("store_name", "upi_id", "qr_merchant_name", "current_printer_host", "printer_host_connected", "printer_host_last_seen");

            for (int i = 0; i < remoteSettings.length(); i++) {
                JSONObject s = remoteSettings.getJSONObject(i);
                String key = s.optString("key", "");
                String value = s.optString("value", "");

                if (pullableKeys.contains(key)) {
                    if ("upi_id".equals(key)) {
                        value = normalizeUPISetting(value);
                    }
                    if (!value.equals(localObj.optString(key, ""))) {
                        localObj.put(key, value);
                        changed = true;
                    }
                }
            }

            if (changed) {
                db.execSQL("INSERT OR REPLACE INTO local_store (key, val) VALUES ('sr_settings', ?)", new Object[]{localObj.toString()});
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to merge settings: ", e);
        }
    }

    private String normalizeUPISetting(String value) {
        if (value == null) return "";
        String clean = value.trim();
        if (clean.isEmpty() || "sairamkirana@sbi".equals(clean) || clean.contains("oobe=fos123") || clean.contains("aid=uGFeAgMIAwAFCw")) {
            return "upi://pay?pa=gpay-11232240371@okbizaxis&pn=Sai%20Ram%20Kirana&tn=undefined&am=undefined";
        }
        return clean;
    }

    private long parseTime(String dateStr) {
        if (dateStr == null || dateStr.isEmpty()) return 0;
        try {
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
            return sdf.parse(dateStr).getTime();
        } catch (Exception e) {
            try {
                SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US);
                sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
                return sdf.parse(dateStr).getTime();
            } catch (Exception ex) {
                return 0;
            }
        }
    }

    private boolean isAppInForeground(Context context) {
        ActivityManager activityManager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        List<ActivityManager.RunningAppProcessInfo> appProcesses = activityManager.getRunningAppProcesses();
        if (appProcesses == null) return false;
        String packageName = context.getPackageName();
        for (ActivityManager.RunningAppProcessInfo appProcess : appProcesses) {
            if (appProcess.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
                    && appProcess.processName.equals(packageName)) {
                return true;
            }
        }
        return false;
    }

    private HttpResult sendHttpRequest(String urlStr, String method, String body, Map<String, String> headers) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod(method);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            if (headers != null) {
                for (Map.Entry<String, String> entry : headers.entrySet()) {
                    conn.setRequestProperty(entry.getKey(), entry.getValue());
                }
            }

            if (body != null && !body.isEmpty()) {
                conn.setDoOutput(true);
                OutputStream os = conn.getOutputStream();
                os.write(body.getBytes("UTF-8"));
                os.flush();
                os.close();
            }

            int code = conn.getResponseCode();
            InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
            String response = "";
            if (is != null) {
                BufferedReader br = new BufferedReader(new InputStreamReader(is, "UTF-8"));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) {
                    sb.append(line);
                }
                br.close();
                response = sb.toString();
            }
            return new HttpResult(code, response);
        } catch (Exception e) {
            Log.e(TAG, "HTTP request failed for URL: " + urlStr, e);
            return new HttpResult(-1, e.getMessage());
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private static class HttpResult {
        int code;
        String body;

        HttpResult(int code, String body) {
            this.code = code;
            this.body = body;
        }
    }
}
