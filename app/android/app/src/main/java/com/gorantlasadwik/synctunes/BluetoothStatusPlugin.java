package com.gorantlasadwik.synctunes;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BluetoothStatusPlugin")
public class BluetoothStatusPlugin extends Plugin {
    private BroadcastReceiver bluetoothReceiver;

    @Override
    public void load() {
        super.load();
        bluetoothReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (action == null) return;

                if (BluetoothDevice.ACTION_ACL_CONNECTED.equals(action)) {
                    BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (device != null) {
                        String name = "";
                        try {
                            name = device.getName();
                        } catch (SecurityException e) {
                            name = "Unknown Device";
                        }
                        String address = device.getAddress();

                        JSObject ret = new JSObject();
                        ret.put("status", "connected");
                        ret.put("name", name != null ? name : "Unknown Device");
                        ret.put("mac", address);
                        notifyListeners("onPrinterStatusChange", ret);
                    }
                } else if (BluetoothDevice.ACTION_ACL_DISCONNECTED.equals(action)) {
                    BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (device != null) {
                        String name = "";
                        try {
                            name = device.getName();
                        } catch (SecurityException e) {
                            name = "Unknown Device";
                        }
                        String address = device.getAddress();

                        JSObject ret = new JSObject();
                        ret.put("status", "disconnected");
                        ret.put("name", name != null ? name : "Unknown Device");
                        ret.put("mac", address);
                        notifyListeners("onPrinterStatusChange", ret);
                    }
                } else if (BluetoothAdapter.ACTION_STATE_CHANGED.equals(action)) {
                    int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);
                    if (state == BluetoothAdapter.STATE_OFF || state == BluetoothAdapter.STATE_TURNING_OFF) {
                        JSObject ret = new JSObject();
                        ret.put("status", "disconnected");
                        ret.put("reason", "bluetooth_disabled");
                        notifyListeners("onPrinterStatusChange", ret);
                    }
                }
            }
        };

        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_ACL_CONNECTED);
        filter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED);
        filter.addAction(BluetoothAdapter.ACTION_STATE_CHANGED);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(bluetoothReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            getContext().registerReceiver(bluetoothReceiver, filter);
        }
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        if (bluetoothReceiver != null) {
            try {
                getContext().unregisterReceiver(bluetoothReceiver);
            } catch (Exception e) {
                // ignore
            }
        }
    }
}
