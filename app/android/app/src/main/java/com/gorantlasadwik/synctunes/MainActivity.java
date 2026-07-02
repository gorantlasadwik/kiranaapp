package com.gorantlasadwik.synctunes;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

import androidx.work.Constraints;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.ExistingPeriodicWorkPolicy;
import java.util.concurrent.TimeUnit;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ContactsPlugin.class);
        registerPlugin(SpeechPlugin.class);
        registerPlugin(BluetoothStatusPlugin.class);
        registerPlugin(BarcodeScannerPlugin.class);
        super.onCreate(savedInstanceState);

        // Force the WebView to ignore system font scaling
        if (this.getBridge() != null && this.getBridge().getWebView() != null) {
            this.getBridge().getWebView().getSettings().setTextZoom(100);
        }

        // Schedule native background sync worker using Android WorkManager
        scheduleBackgroundSync();
        
        // Request Bluetooth, Location, and Contacts permissions dynamically on startup for Android 12+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            List<String> permissionsNeeded = new ArrayList<>();
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                permissionsNeeded.add(Manifest.permission.BLUETOOTH_SCAN);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                permissionsNeeded.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                permissionsNeeded.add(Manifest.permission.ACCESS_FINE_LOCATION);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
                permissionsNeeded.add(Manifest.permission.READ_CONTACTS);
            }
            
            if (!permissionsNeeded.isEmpty()) {
                ActivityCompat.requestPermissions(this, permissionsNeeded.toArray(new String[0]), 101);
            }
        } else {
            // Request Location and Contacts permissions for Android 11 and below
            List<String> permissionsNeeded = new ArrayList<>();
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                permissionsNeeded.add(Manifest.permission.ACCESS_FINE_LOCATION);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
                permissionsNeeded.add(Manifest.permission.READ_CONTACTS);
            }
            
            if (!permissionsNeeded.isEmpty()) {
                ActivityCompat.requestPermissions(this, permissionsNeeded.toArray(new String[0]), 102);
            }
        }
    }

    private void scheduleBackgroundSync() {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        PeriodicWorkRequest syncRequest = new PeriodicWorkRequest.Builder(
                SyncWorker.class,
                15, TimeUnit.MINUTES
        )
                .setConstraints(constraints)
                .build();

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
                "SaiRamKiranaBackgroundSync",
                ExistingPeriodicWorkPolicy.KEEP,
                syncRequest
        );
        android.util.Log.i("MainActivity", "Scheduled periodic background sync task via WorkManager.");
    }
}
