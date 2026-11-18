import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const EXPECTED_PACKAGE = 'com.alhussam.grocery';
const EXPECTED_PROJECT_ID = 'dogwood-program-zw2pc';
const EXPECTED_SENDER_ID = '721494882410';

const issues = [];
const warnings = [];

function readText(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

// 1. Check firebase-applet-config.json
const fbConfig = JSON.parse(readText('firebase-applet-config.json'));
if (fbConfig.projectId !== EXPECTED_PROJECT_ID) {
  issues.push(`firebase-applet-config.json projectId is "${fbConfig.projectId}", expected "${EXPECTED_PROJECT_ID}".`);
}
if (fbConfig.messagingSenderId !== EXPECTED_SENDER_ID) {
  issues.push(`firebase-applet-config.json messagingSenderId is "${fbConfig.messagingSenderId}", expected "${EXPECTED_SENDER_ID}".`);
}
if (!fbConfig.oAuthClientId) {
  issues.push('firebase-applet-config.json is missing oAuthClientId.');
}

// 2. Check package name consistency
const capConfig = readText('capacitor.config.ts');
if (!capConfig.includes(`appId: '${EXPECTED_PACKAGE}'`)) {
  issues.push(`capacitor.config.ts appId does not match ${EXPECTED_PACKAGE}.`);
}
const gradleApp = readText('android/app/build.gradle');
if (!gradleApp.includes(`applicationId "${EXPECTED_PACKAGE}"`) || !gradleApp.includes(`namespace = "${EXPECTED_PACKAGE}"`)) {
  issues.push(`android/app/build.gradle namespace/applicationId does not match ${EXPECTED_PACKAGE}.`);
}
const stringsXml = readText('android/app/src/main/res/values/strings.xml');
if (!stringsXml.includes(`<string name="package_name">${EXPECTED_PACKAGE}</string>`)) {
  issues.push(`android/app/src/main/res/values/strings.xml package_name does not match ${EXPECTED_PACKAGE}.`);
}
const mainActivity = readText('android/app/src/main/java/com/alhussam/grocery/MainActivity.java');
if (!mainActivity.startsWith(`package ${EXPECTED_PACKAGE};`)) {
  issues.push(`MainActivity.java package declaration does not match ${EXPECTED_PACKAGE}.`);
}

// 3. Check keystore and extract SHA-1 / SHA-256
let keystoreSha1 = '';
let keystoreSha256 = '';
const keystorePropsPath = path.join(root, 'android/keystore.properties');
const keystorePath = path.join(root, 'android/alhussam-release.keystore');
if (!fs.existsSync(keystorePropsPath) || !fs.existsSync(keystorePath)) {
  issues.push('Missing android/keystore.properties or android/alhussam-release.keystore.');
} else {
  const props = Object.fromEntries(
    readText('android/keystore.properties')
      .split(/\r?\n/)
      .filter((l) => l.includes('='))
      .map((l) => {
        const idx = l.indexOf('=');
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
      })
  );
  try {
    const pass = props.storePassword || '';
    const cmd = `openssl pkcs12 -in "${keystorePath}" -passin "pass:${pass}" -nokeys -nodes 2>/dev/null`;
    const sha1Out = execSync(`${cmd} | openssl x509 -noout -sha1 -fingerprint`, { encoding: 'utf8' }).trim();
    const sha256Out = execSync(`${cmd} | openssl x509 -noout -sha256 -fingerprint`, { encoding: 'utf8' }).trim();
    keystoreSha1 = sha1Out.split('=')[1]?.trim() || '';
    keystoreSha256 = sha256Out.split('=')[1]?.trim() || '';
  } catch (e) {
    warnings.push(`Could not extract certificate fingerprints with openssl: ${e.message}`);
  }
}

// 4. Check android/app/google-services.json
const gsPath = path.join(root, 'android/app/google-services.json');
if (!fs.existsSync(gsPath)) {
  issues.push(
    'Missing android/app/google-services.json. Register Android app com.alhussam.grocery with SHA-1 & SHA-256 in Firebase Console and place google-services.json at android/app/google-services.json.'
  );
} else {
  try {
    const gs = JSON.parse(fs.readFileSync(gsPath, 'utf8'));
    const projectId = gs?.project_info?.project_id || '';
    if (projectId !== EXPECTED_PROJECT_ID) {
      issues.push(`google-services.json project_id is "${projectId}", expected "${EXPECTED_PROJECT_ID}".`);
    }
    const client = (gs?.client || []).find(
      (c) => c?.client_info?.android_client_info?.package_name === EXPECTED_PACKAGE
    );
    if (!client) {
      issues.push(`google-services.json does not contain package "${EXPECTED_PACKAGE}".`);
    } else {
      const oauthClients = client.oauth_client || [];
      const androidClients = oauthClients.filter((o) => o.client_type === 1);
      const webClients = oauthClients.filter((o) => o.client_type === 3);
      if (androidClients.length === 0) {
        issues.push('google-services.json has no Android OAuth client (client_type: 1). Add SHA-1 & SHA-256 in Firebase Console and re-download google-services.json.');
      } else if (keystoreSha1) {
        const normalizedKeystoreSha1 = keystoreSha1.replace(/:/g, '').toLowerCase();
        const sha1Matched = androidClients.some(
          (o) => (o?.android_info?.certificate_hash || '').replace(/:/g, '').toLowerCase() === normalizedKeystoreSha1
        );
        if (!sha1Matched) {
          issues.push(`google-services.json Android OAuth certificate_hash does not match keystore SHA-1 (${keystoreSha1}).`);
        }
      }
      if (webClients.length === 0) {
        issues.push('google-services.json has no Web OAuth client (client_type: 3). Enable Google Sign-In in Firebase Authentication and re-download google-services.json.');
      } else if (!webClients.some((w) => w.client_id === fbConfig.oAuthClientId)) {
        warnings.push(
          `google-services.json client_type 3 client_id (${webClients.map((w) => w.client_id).join(', ')}) differs from firebase-applet-config.json oAuthClientId (${fbConfig.oAuthClientId}). Gradle will use google-services.json value.`
        );
      }
    }
  } catch (e) {
    issues.push(`Invalid JSON in android/app/google-services.json: ${e.message}`);
  }
}

console.log('=== AlHussam Android OAuth Verification ===');
console.log('Package Name :', EXPECTED_PACKAGE);
console.log('Project ID   :', EXPECTED_PROJECT_ID);
console.log('Web Client ID:', fbConfig.oAuthClientId);
console.log('Keystore SHA1:', keystoreSha1 || 'N/A');
console.log('Keystore SHA256:', keystoreSha256 || 'N/A');

if (warnings.length > 0) {
  console.log('\nWarnings:');
  for (const w of warnings) console.log(' -', w);
}

if (issues.length > 0) {
  console.log('\nErrors / Missing Setup:');
  for (const err of issues) console.log(' x', err);
  process.exitCode = 1;
} else {
  console.log('\nAll Android OAuth & Firebase checks passed.');
}
