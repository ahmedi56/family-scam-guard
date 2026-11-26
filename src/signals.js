// Rule-based scam signals and "remembered scammer" helpers. No imports on purpose: the extension's
// content script loads this same file on every website, so it must stay plain and fast.

// Whole-word match that works for accented and Arabic letters (JS \b only knows ASCII letters).
const words = (src) => new RegExp(String.raw`(?<![\p{L}\d])(?:${src})(?![\p{L}\d])`, 'iu');

export const SIGNALS = [
  [words('urgent|immediately|within \\d+ ?(hours|minutes)|act now|last warning|urgent(e|ement)?|imm[ée]diatement|dernier avertissement|dans les \\d+ ?(heures|minutes)|عاجل|فورا'), 'Pressure to act fast'],
  // Plain "password" or "PIN" is everyday text; only a request to hand one over counts.
  [words('bvn|otp|cvv|verification code|code de v[ée]rification|رمز|(send|share|give|provide|enter|confirm|reply with|tell us|envoyez|donnez|communiquez)( me| us)?( your| the| votre| le)? (pin|password|code|mot de passe)'), 'Asks for a code, PIN or password'],
  [words('won|winner|prize|lottery|gagn[ée]|gagnant|loterie|ربحت|جائزة'), 'Prize or lottery claim'],
  [/\b(bit\.ly|tinyurl|t\.co|cutt\.ly|wa\.me)\/\S+/i, 'Shortened link hides the real address'],
  // A blocked build or pipeline is not a threat; a blocked account, card or SIM is.
  [words('(account|card|sim|line|wallet|atm|bvn|compte|carte)( has been| is| will be| was)?( temporarily| permanently)? (suspended|blocked|locked|deactivated|closed|restricted|frozen)|verify your account|compte (suspendu|bloqu[ée])|حسابك'), 'Threat that an account will be blocked'],
  [words('send( me| us)? (money|cash|funds|airtime|\\d[\\d,.]*k?)|(bank|wire) transfer|transfer (the )?(money|funds|fee)|virement|envoy(er|ez) (de l.argent|l.argent)|gift ?cards?|western union|moneygram|crypto|bitcoin|usdt'), 'Asks you to send money or gift cards'],
];

// ---- dangerous links: a fake-brand, raw-IP or look-alike address is a scam on its own ----------
// Brand word in the address -> the only domains that brand really uses.
const BRANDS = {
  paypal: ['paypal.com', 'paypal-community.com', 'paypalobjects.com'], apple: ['apple.com', 'icloud.com'], icloud: ['icloud.com', 'apple.com'],
  amazon: ['amazon.com', 'amazon.fr', 'amazon.co.uk', 'amazon.de', 'amazonaws.com'], microsoft: ['microsoft.com', 'live.com', 'office.com'],
  netflix: ['netflix.com'], whatsapp: ['whatsapp.com', 'whatsapp.net'], facebook: ['facebook.com', 'fb.com'], instagram: ['instagram.com'],
  dhl: ['dhl.com', 'dhl.de', 'dhl.fr'], fedex: ['fedex.com'], ups: ['ups.com'], mtn: ['mtn.ng', 'mtn.com', 'mtnonline.com'], opay: ['opayweb.com'],
  gtbank: ['gtbank.com'], firstbank: ['firstbanknigeria.com'], zenithbank: ['zenithbank.com'], accessbank: ['accessbankplc.com'],
  binance: ['binance.com'], laposte: ['laposte.fr', 'laposte.tn'],
};
const NAMES = { paypal: 'PayPal', icloud: 'iCloud', whatsapp: 'WhatsApp', gtbank: 'GTBank', mtn: 'MTN', dhl: 'DHL', ups: 'UPS', fedex: 'FedEx', laposte: 'La Poste' };
const URLS = /\bhttps?:\/\/[^\s"'<>]+|\bwww\.[^\s"'<>]+|(?<![@\w.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|info|xyz|top|click|live|site|online|shop|store|ng|tn|co|io|me|cc|vip|icu|buzz|cfd|sbs)(?:\/[^\s"'<>]*)?/gi;

function hostOf(raw) {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// Labels all start with "Link " so isScamShaped can treat them as dangerous on their own.
export function linkRisks(text) {
  const out = new Set();
  for (const [raw] of String(text).matchAll(URLS)) {
    if (/^https?:\/\/[^/]*@/i.test(raw)) out.add('Link hides its real address');
    const host = hostOf(raw);
    if (!host) continue;
    // Home routers and local devices (192.168.x, 10.x, 127.x) use number addresses legitimately.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !/^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) out.add('Link goes to a bare number address, not a real website');
    if (host.split('.').some((l) => l.startsWith('xn--'))) out.add('Link uses look-alike letters to copy a real website');
    for (const token of host.split(/[.-]/)) {
      const official = BRANDS[token];
      if (official && !official.some((d) => host === d || host.endsWith(`.${d}`))) {
        out.add(`Link pretends to be ${NAMES[token] || token[0].toUpperCase() + token.slice(1)} but is not their website`);
      }
    }
  }
  return [...out];
}

// Signs that a message asks you to DO something risky. Scam alerts need at least one.
const ACTION = new Set(['Asks for a code, PIN or password', 'Shortened link hides the real address', 'Asks you to send money or gift cards']);
export const isScamShaped = (signals) =>
  signals.some((s) => s.startsWith('Link ')) || (signals.length >= 3 && signals.some((s) => ACTION.has(s)));

export function matchSignals(text, extra = []) {
  return [...[...SIGNALS, ...extra].filter(([re]) => re.test(text)).map(([, label]) => label), ...linkRisks(text)];
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
