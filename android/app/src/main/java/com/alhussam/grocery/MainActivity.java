package com.alhussam.grocery;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
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

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private boolean webViewBridgeAttached = false;

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

        if (!webViewBridgeAttached) {
            webView.addJavascriptInterface(new AndroidFileBridge(), "AndroidFileBridge");
            webViewBridgeAttached = true;
        }
    }

    private String computeCertFingerprint(byte[] certBytes, String algorithm) {
        try {
            MessageDigest md = MessageDigest.getInstance(algorithm);
            byte[] digest = md.digest(certBytes);
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < digest.length; i++) {
                if (i > 0) sb.append(':');
                sb.append(String.format("%02X", digest[i] & 0xFF));
            }
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private String getStringResourceOrEmpty(String resName) {
        int resId = getResources().getIdentifier(resName, "string", getPackageName());
        if (resId == 0) return "";
        try {
            return getString(resId);
        } catch (Exception e) {
            return "";
        }
    }

    private class AndroidFileBridge {
        @JavascriptInterface
        public String getOAuthDiagnostics() {
            JSONObject obj = new JSONObject();
            try {
                String pkgName = getPackageName();
                obj.put("packageName", pkgName);

                String webClientId = getStringResourceOrEmpty("default_web_client_id");
                String googleAppId = getStringResourceOrEmpty("google_app_id");
                String projectId = getStringResourceOrEmpty("project_id");
                obj.put("defaultWebClientId", webClientId);
                obj.put("hasGoogleAppId", !googleAppId.isEmpty());
                obj.put("googleAppId", googleAppId);
                obj.put("projectId", projectId);

                String sha1 = "";
                String sha256 = "";
                PackageManager pm = getPackageManager();
                Signature[] signatures = null;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    PackageInfo pkgInfo = pm.getPackageInfo(pkgName, PackageManager.GET_SIGNING_CERTIFICATES);
                    if (pkgInfo.signingInfo != null) {
                        signatures = pkgInfo.signingInfo.hasMultipleSigners()
                            ? pkgInfo.signingInfo.getApkContentsSigners()
                            : pkgInfo.signingInfo.getSigningCertificateHistory();
                    }
                } else {
                    @SuppressWarnings("deprecation")
                    PackageInfo pkgInfo = pm.getPackageInfo(pkgName, PackageManager.GET_SIGNATURES);
                    signatures = pkgInfo.signatures;
                }
                if (signatures != null && signatures.length > 0) {
                    byte[] rawCert = signatures[0].toByteArray();
                    sha1 = computeCertFingerprint(rawCert, "SHA-1");
                    sha256 = computeCertFingerprint(rawCert, "SHA-256");
                }
                obj.put("sha1", sha1);
                obj.put("sha256", sha256);
            } catch (Exception e) {
                try {
                    obj.put("error", e.getMessage());
                } catch (Exception ignored) {
                    // ignore
                }
            }
            return obj.toString();
        }

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
