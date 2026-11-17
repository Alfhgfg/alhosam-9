package com.alhussam.grocery;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.List;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        ensureFirebaseInitialized();
        super.onCreate(savedInstanceState);
        configureWebView();
    }

    private void ensureFirebaseInitialized() {
        try {
            Class<?> firebaseAppClass = Class.forName("com.google.firebase.FirebaseApp");
            Object appsObj = firebaseAppClass.getMethod("getApps", Context.class).invoke(null, this);
            if (appsObj instanceof List && !((List<?>) appsObj).isEmpty()) {
                return;
            }
            Class<?> optionsClass = Class.forName("com.google.firebase.FirebaseOptions");
            Class<?> builderClass = Class.forName("com.google.firebase.FirebaseOptions$Builder");
            Object builder = builderClass.getConstructor().newInstance();
            builderClass.getMethod("setProjectId", String.class).invoke(builder, "dogwood-program-zw2pc");
            builderClass.getMethod("setApplicationId", String.class).invoke(builder, "1:721494882410:web:4e45cc1846297b59947213");
            builderClass.getMethod("setApiKey", String.class).invoke(builder, "AIzaSyAiNP7urLNqNaJ6xMoxnRposKaEBIgyaNg");
            builderClass.getMethod("setStorageBucket", String.class).invoke(builder, "dogwood-program-zw2pc.firebasestorage.app");
            builderClass.getMethod("setGcmSenderId", String.class).invoke(builder, "721494882410");
            Object options = builderClass.getMethod("build").invoke(builder);
            firebaseAppClass.getMethod("initializeApp", Context.class, optionsClass).invoke(null, this, options);
        } catch (Throwable ignored) {
            // google-services.json or Firebase SDK handles initialization when present
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        configureWebView();
    }

    private void configureWebView() {
        if (this.bridge == null || this.bridge.getWebView() == null) {
            return;
        }
        WebView webView = this.bridge.getWebView();
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        String ua = settings.getUserAgentString();
        if (ua != null) {
            String cleaned = ua
                .replace("; wv)", ")")
                .replace("; wv;", ";")
                .replace("Version/4.0 ", "");
            if (!cleaned.equals(ua)) {
                settings.setUserAgentString(cleaned);
            }
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new AndroidFileBridge(), "AndroidFileBridge");
    }

    private class AndroidFileBridge {
        @JavascriptInterface
        public boolean saveFile(String base64Data, String fileName, String mimeType) {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                String safeName = fileName.replaceAll("[\\\\/:*?\"<>|]", "_");

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                    values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AlHussam");

                    ContentResolver resolver = getContentResolver();
                    Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) return false;
                    try (OutputStream out = resolver.openOutputStream(uri)) {
                        if (out == null) return false;
                        out.write(bytes);
                        out.flush();
                    }
                } else {
                    File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    File appDir = new File(downloadsDir, "AlHussam");
                    if (!appDir.exists()) {
                        appDir.mkdirs();
                    }
                    File outFile = new File(appDir, safeName);
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        fos.write(bytes);
                        fos.flush();
                    }
                }

                runOnUiThread(() ->
                    Toast.makeText(
                        MainActivity.this,
                        "تم حفظ الملف في مجلد التنزيلات (Downloads/AlHussam): " + safeName,
                        Toast.LENGTH_LONG
                    ).show()
                );
                return true;
            } catch (Exception e) {
                runOnUiThread(() ->
                    Toast.makeText(
                        MainActivity.this,
                        "تعذر حفظ الملف: " + e.getMessage(),
                        Toast.LENGTH_LONG
                    ).show()
                );
                return false;
            }
        }
    }
}
