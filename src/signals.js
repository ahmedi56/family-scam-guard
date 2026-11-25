// Rule-based scam signals and "remembered scammer" helpers. No imports on purpose: the extension's
// content script loads this same file on every website, so it must stay plain and fast.

export const SIGNALS = [
  [/\b(urgent|immediately|within \d+ ?(hours|minutes)|act now|last warning|urgent(e|ement)?|عاجل|فورا)\b/i, 'Pressure to act fast'],
  [/\b(bvn|otp|pin|password|cvv|verification code|code de v[ée]rification|mot de passe|رمز)\b/i, 'Asks for a code, PIN or password'],
  [/\b(won|winner|prize|lottery|gagn[ée]|gagnant|loterie|ربحت|جائزة)\b/i, 'Prize or lottery claim'],
  [/\b(bit\.ly|tinyurl|t\.co|cutt\.ly|wa\.me)\/\S+/i, 'Shortened link hides the real address'],
  [/\b(suspend(ed)?|blocked|locked|verify your account|compte (suspendu|bloqu[ée])|حسابك)\b/i, 'Threat that an account will be blocked'],
  [/\b(send|transfer|virement|envoyer|gift ?card|western union|crypto|usdt)\b/i, 'Asks you to send money or gift cards'],
];

export function matchSignals(text, extra = []) {
  return [...SIGNALS, ...extra].filter(([re]) => re.test(text)).map(([, label]) => label);
}

// Plain-language reasons a message looks safe, built from what is NOT in it.
export function whySafe(text) {
  const has = (i) => SIGNALS[i][0].test(text);
  const out = [];
  if (!/https?:\/\/|www\.|\.(com|net|org|ng|tn|info|xyz)\b/i.test(text)) out.push('No link to click');
  if (!has(5) && !has(1)) out.push('Does not ask for money, codes or passwords');
  if (!has(0) && !has(4)) out.push('No pressure or threats');
  return out.slice(0, 3);
}

// Links, phone numbers and emails in a message, normalized so the same scammer matches next time.
export function indicators(text) {
  const out = new Set();
  for (const m of text.matchAll(/\b(?:https?:\/\/|www\.)[^\s"'<>]+|\b(?:bit\.ly|tinyurl\.com|t\.co|cutt\.ly|wa\.me)\/[^\s"'<>]+/gi))
    out.add(m[0].toLowerCase().replace(/^https?:\/\/(www\.)?|^www\./, '').replace(/[.,;:!?)\]]+$/, ''));
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) out.add(m[0].toLowerCase().replace(/[.,;:]+$/, ''));
  for (const m of text.matchAll(/\+?\d[\d\s().-]{7,}\d/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 15) out.add(digits.slice(-9)); // last 9 digits: ignores +234 / 0 prefixes
  }
  return [...out];
}

// Remembered scammers live in chrome.storage.local inside the extension (shared with the content
// script) and in localStorage on the web app. Never uploaded.
const KEY = 'fsg-flagged-v1';
const ext = () => typeof chrome !== 'undefined' && chrome.storage?.local;

export async function loadFlagged() {
  try {
    if (ext()) return (await chrome.storage.local.get(KEY))[KEY] || [];
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export async function rememberScammer(text) {
  const found = indicators(text);
  if (!found.length) return [];
  const all = [...new Set([...found, ...(await loadFlagged())])].slice(0, 500);
  try {
    if (ext()) await chrome.storage.local.set({ [KEY]: all });
    else localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: skip */
  }
  return found;
}

// Short id for a message, so the popup can tell the page Guardian which message its AI verdict is for.
export function textKey(text) {
  let h = 5381;
  const s = text.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}
export const VERDICT_KEY = 'fsg-verdict-v1';

// Human wording for a stored indicator: phone numbers are kept as their last 9 digits.
export const describe = (x) => (/^\d+$/.test(x) ? `phone number ending ${x.slice(-4)}` : x);

// Which remembered scammer details appear in this text.
export function flaggedIn(text, flagged) {
  if (!flagged.length) return [];
  const mine = indicators(text);
  return mine.filter((x) => flagged.includes(x));
}
