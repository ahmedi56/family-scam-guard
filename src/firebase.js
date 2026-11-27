import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'firebase/ai';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config';

const env = import.meta.env;

export const firebaseConfigured = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID);

const app = firebaseConfigured
  ? initializeApp({
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    })
  : null;

// ---- App Check (required by Firebase AI Logic) -------------------------------------------
// A debug token is used for local dev and for the Chrome extension, where reCAPTCHA can't load.
if (app) {
  if (env.VITE_APPCHECK_DEBUG_TOKEN) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_APPCHECK_DEBUG_TOKEN;
  }
  const enterpriseKey = env.VITE_RECAPTCHA_ENTERPRISE_KEY;
  if (env.VITE_APPCHECK_DEBUG_TOKEN || enterpriseKey || env.VITE_RECAPTCHA_SITE_KEY) {
    // The console registration decides which provider is valid. Enterprise is used when its key is set.
    const provider = enterpriseKey
      ? new ReCaptchaEnterpriseProvider(enterpriseKey)
      : new ReCaptchaV3Provider(env.VITE_RECAPTCHA_SITE_KEY || 'debug-placeholder');
    initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
  }
}

export const auth = app ? getAuth(app) : null;
// Offline cache: history, family alerts and community reports keep working without a connection.
function makeDb() {
  if (!app) return null;
  try {
    return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch {
    return getFirestore(app);
  }
}
export const db = makeDb();

// ---- Remote Config: tune the prompt / model without redeploying ------------------------
export const DEFAULTS = {
  cloud_model: 'gemini-3.5-flash-lite',
  cloud_model_fallback: 'gemini-3.8-flash',
  scam_prompt_extra: '',
  scam_rules: '[]',
};
let remoteConfig = null;
if (app) {
  remoteConfig = getRemoteConfig(app);
  remoteConfig.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
  remoteConfig.defaultConfig = DEFAULTS;
}

export async function loadRemoteConfig() {
  if (!remoteConfig) return DEFAULTS;
  try {
    await fetchAndActivate(remoteConfig);
  } catch (e) {
    console.warn('Remote Config fetch failed, using defaults', e);
  }
  return {
    cloud_model: getValue(remoteConfig, 'cloud_model').asString() || DEFAULTS.cloud_model,
    cloud_model_fallback: getValue(remoteConfig, 'cloud_model_fallback').asString() || DEFAULTS.cloud_model_fallback,
    scam_prompt_extra: getValue(remoteConfig, 'scam_prompt_extra').asString(),
    scam_rules: getValue(remoteConfig, 'scam_rules').asString() || DEFAULTS.scam_rules,
  };
}

// ---- Anonymous auth so history and family alerts need no email ------------------------
export async function ensureUser() {
  if (!auth) return null;
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

// ---- Firebase AI Logic: hybrid inference ---------------------------------------------
export const MODES = {
  auto: InferenceMode.PREFER_ON_DEVICE, // on-device first, cloud fallback
  cloud: InferenceMode.ONLY_IN_CLOUD, // used in the demo to show the cloud path
};

let ai = null;
export function getHybridModel(mode, cloudModel) {
  if (!app) throw new Error('Firebase is not configured. Copy .env.example to .env first.');
  ai ??= getAI(app, { backend: new GoogleAIBackend() });
  return getGenerativeModel(ai, {
    mode,
    inCloudParams: {
      model: cloudModel,
      // The answer is a short JSON verdict; capping it keeps each check cheap on the free quota.
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 1024 },
    },
  });
}

// ---- Performance Monitoring: time on-device vs cloud checks (best effort, never blocks) ----
export async function startTrace(name) {
  if (!app) return null;
  try {
    const { getPerformance, trace } = await import('firebase/performance');
    const t = trace(getPerformance(app), name);
    t.start();
    return t;
  } catch {
    return null;
  }
}
