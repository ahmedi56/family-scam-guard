import { defineConfig } from 'vite';

// base './' so the same build works on Firebase Hosting, as a PWA and inside a Chrome extension popup.
export default defineConfig(({ mode }) => {
  // The hosted site must never ship the App Check debug token (anyone could reuse it to call the AI).
  // It uses reCAPTCHA Enterprise instead. The extension build (--mode extension) keeps the token.
  if (mode === 'production') process.env.VITE_APPCHECK_DEBUG_TOKEN = '';
  // Extensions can't load the reCAPTCHA script, so the extension keeps working exactly as before.
  // 'judges' is the public zip: same as the extension, but with its own revocable token from .env.judges.
  if (mode === 'extension' || mode === 'judges') process.env.VITE_RECAPTCHA_ENTERPRISE_KEY = '';
  return { base: './' };
});
