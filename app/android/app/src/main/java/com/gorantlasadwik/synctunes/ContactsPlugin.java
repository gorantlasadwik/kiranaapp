package com.gorantlasadwik.synctunes;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ContactsPlugin")
public class ContactsPlugin extends Plugin {

    @PluginMethod
    public void pickContact(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
        startActivityForResult(call, intent, "pickContactResult");
    }

    @ActivityCallback
    private void pickContactResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        if (result.getResultCode() == Activity.RESULT_OK) {
            Intent data = result.getData();
            if (data != null) {
                Uri contactUri = data.getData();
                if (contactUri != null) {
                    String[] projection = new String[]{
                        ContactsContract.CommonDataKinds.Phone.NUMBER,
                        ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME
                    };

                    try (Cursor cursor = getContext().getContentResolver().query(contactUri, projection, null, null, null)) {
                        if (cursor != null && cursor.moveToFirst()) {
                            int numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                            int nameIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                            
                            String number = numberIndex != -1 ? cursor.getString(numberIndex) : "";
                            String name = nameIndex != -1 ? cursor.getString(nameIndex) : "";

                            JSObject ret = new JSObject();
                            ret.put("name", name);
                            ret.put("phone", number);
                            call.resolve(ret);
                            return;
                        }
                    } catch (Exception e) {
                        call.reject("Failed to query contact data: " + e.getMessage());
                        return;
                    }
                }
            }
            call.reject("No contact data returned");
        } else {
            call.reject("Contact selection cancelled");
        }
    }
}
