import { getHybridModel, loadRemoteConfig, startTrace, DEFAULTS, MODES } from './firebase.js';
import { matchSignals, whySafe } from './signals.js';

const LANGS = {
  auto: 'exactly the language the MESSAGE itself is written in (if the message is English, answer in English; never switch to a different language)',
  en: 'English',
  fr: 'French',
  ar: 'Arabic',
  pcm: 'Nigerian Pidgin',
};

// Cheap local signals (src/signals.js, shared with the extension's page scanner). They never replace
// the model, but they make the verdict steadier on small on-device models and give concrete red flags.
// Extra rules come from Remote Config (key "scam_rules"), so new scam patterns can ship without a redeploy.
// Format: [{"pattern":"mtn.*momo","flags":"i","label":"Mobile money pressure"}]
let extraRules = [];
export function setExtraRules(json) {
  try {
    extraRules = JSON.parse(json || '[]')
      .map((r) => [new RegExp(r.pattern, r.flags || 'i'), String(r.label)])
      .filter(([, label]) => label);
  } catch {
    extraRules = [];
  }
}

export function localSignals(text) {
  return matchSignals(text, extraRules);
}

// Instant verdict from rules alone, shown while the AI is still thinking.
export function quickVerdict(text) {
  const signals = localSignals(text);
  const verdict = signals.length >= 3 ? 'scam' : signals.length >= 1 ? 'suspicious' : 'unknown';
  return { verdict, signals };
}

// ---- tiny result cache so a repeated message answers instantly -------------------------
const CACHE_KEY = 'fsg-cache-v2'; // v2: safe answers now carry reasons
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}
function readCache(k) {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')[k];
  } catch {
    return undefined;
  }
}
function writeCache(k, v) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const keys = Object.keys(all);
    if (keys.length >= 30) delete all[keys[0]];
    all[k] = v;
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: skip caching */
  }
}

function buildPrompt(text, lang, extra, compact = false) {
  const schema = compact
    ? '{"verdict":"scam"|"suspicious"|"safe","confidence":0-100,"reasons":["1 or 2 short reasons, max 8 words each"],"category":"scam type such as fake bank alert, delivery scam, prize scam, job scam, phishing link, family emergency, or none","advice":"one short sentence, max 15 words"}'
    : '{"verdict":"scam"|"suspicious"|"safe","confidence":0-100,"reasons":["up to 3 short red flags or reasons it looks safe"],"advice":"one or two simple sentences telling the person what to do","category":"short scam type that matches the reasons, such as fake bank alert, delivery scam, prize scam, job scam, phishing link, family emergency, or none"}';
  return `You are a scam-detection assistant protecting ordinary people, including elderly users, from fraud by SMS, WhatsApp, email and social media messages.
Analyze the MESSAGE below. Reply with ONLY a JSON object, no markdown, with exactly these keys:
${schema}
Write category and advice${compact ? '' : ' and reasons'} in ${LANGS[lang] || LANGS.auto}. Keep the JSON keys and the verdict values in English. Use very simple words a grandparent could understand.
Never ask the person to share the message with anyone. ${extra || ''}
MESSAGE:
"""${text}"""`;
}

function normalize(obj) {
  const verdict = ['scam', 'suspicious', 'safe'].includes(obj.verdict) ? obj.verdict : 'suspicious';
  return {
    verdict,
    confidence: Math.max(0, Math.min(100, Number(obj.confidence) || 50)),
    category: String(obj.category || 'none'),
    reasons: Array.isArray(obj.reasons) ? obj.reasons.slice(0, 3).map(String) : [],
    advice: String(obj.advice || ''),
  };
}

// Small on-device models sometimes return slightly broken JSON. Try strict parsing, then a repair
// pass, then pull the fields out with regexes. Throws only if nothing usable is found.
function parseJson(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  const body = (m ? m[0] : raw).replace(/[\u201C\u201D]/g, '"');
  try {
    return normalize(JSON.parse(body));
  } catch {
    /* fall through to repair */
  }
  try {
    return normalize(JSON.parse(body.replace(/,\s*([}\]])/g, '$1').replace(/\n/g, ' ')));
  } catch {
    /* fall through to regex extraction */
  }
  const pick = (key) => (body.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`)) || [])[1];
  const verdict = pick('verdict');
  if (!verdict) throw new Error('Model did not return a usable answer');
  const reasonsBlock = (body.match(/"reasons"\s*:\s*\[([\s\S]*?)\]/) || [])[1] || '';
  return normalize({
    verdict,
    confidence: (body.match(/"confidence"\s*:\s*(\d+)/) || [])[1],
    category: pick('category'),
    reasons: [...reasonsBlock.matchAll(/"([^"]+)"/g)].map((x) => x[1]),
    advice: pick('advice'),
  });
}

/**
 * Classify a message with Firebase AI Logic hybrid inference.
 * mode "auto" prefers the on-device model (Gemini Nano in Chrome) and falls back to the cloud.
 * Returns the verdict plus where it ran: "on_device" or "in_cloud".
 */
// Gemini Nano can take 15-30 s on older computers, so give it room before falling back to the cloud.
const ON_DEVICE_TIMEOUT_MS = 40000;
let cfgPromise = null;
const getConfig = () => (cfgPromise ??= loadRemoteConfig());

function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error('On-device model took too long')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

export async function checkMessage(text, { mode = 'auto', lang = 'auto', onStatus = () => {}, onQuick = () => {} } = {}) {
  // The on-device model only supports a few output languages (en, fr, es, de, ja).
  if (lang === 'ar' || lang === 'pcm') mode = 'cloud';
  const t0 = performance.now();
  // Never wait long for remote settings: fall back to defaults so the first answer is instant.
  const cfg = await Promise.race([getConfig(), new Promise((r) => setTimeout(() => r(DEFAULTS), 1200))]);
  setExtraRules(cfg.scam_rules);
  const cacheKey = hash(`${lang}|${text.trim().toLowerCase()}`);
  const hit = readCache(cacheKey);
  if (hit) return { ...hit, source: 'cache', ms: Math.round(performance.now() - t0) };
  onQuick(quickVerdict(text));
  const tracePromise = startTrace('scam_check');
  const prompt = buildPrompt(text, lang, cfg.scam_prompt_extra);
  const compactPrompt = buildPrompt(text, lang, cfg.scam_prompt_extra, true);
  const signals = localSignals(text);

  async function run(m, modelName = cfg.cloud_model) {
    const model = getHybridModel(MODES[m], modelName);
    const work = model.generateContent(m === 'auto' ? compactPrompt : prompt).then((r) => {
      const response = r.response;
      return { parsed: parseJson(response.text()), source: response.inferenceSource ?? 'unknown' };
    });
    // Only the "auto" mode can land on the slower on-device model, so only it gets a time limit.
    return m === 'auto' ? withTimeout(work, ON_DEVICE_TIMEOUT_MS) : work;
  }

  // Google sometimes answers "high demand" (500/503/429). Retry once, then use the backup model.
  const isBusy = (e) => /\b(429|500|503)\b|high demand|overloaded|unavailable|try again/i.test(String(e?.message || e));
  async function runCloud() {
    try {
      return await run('cloud');
    } catch (e) {
      if (!isBusy(e)) throw e;
      onStatus('The AI is busy, trying again…');
      await new Promise((r) => setTimeout(r, 1500));
      try {
        return await run('cloud');
      } catch (e2) {
        if (!isBusy(e2)) throw e2;
        onStatus('Trying a backup model…');
        return run('cloud', cfg.cloud_model_fallback);
      }
    }
  }

  let out;
  try {
    onStatus(mode === 'auto' ? 'Confirming on your device… older computers can take up to 40 seconds.' : 'Confirming with the cloud AI…');
    out = mode === 'auto' ? await run('auto') : await runCloud();
  } catch (e) {
    // On-device was too slow, unusable, or the cloud was busy: retry once in the cloud.
    if (mode === 'cloud') throw e;
    console.warn('On-device result unusable or slow, retrying in the cloud', e);
    onStatus('Taking longer than expected, switching to the cloud…');
    out = await runCloud();
  }

  const parsed = out.parsed;
  // If the model says "safe" but several hard red flags are present, do not stay silent.
  if (parsed.verdict === 'safe' && signals.length >= 2) parsed.verdict = 'suspicious';
  // The small on-device model over-warns. With no rule-based red flags and low confidence, call it safe.
  if (out.source === 'on_device' && parsed.verdict === 'suspicious' && signals.length === 0 && parsed.confidence < 85) {
    parsed.verdict = 'safe';
    parsed.reasons = []; // the model's reasons argued "suspicious"; replace them below
    if (parsed.category === 'none') parsed.advice = parsed.advice || 'No obvious scam signs. Stay careful with unknown senders.';
  }
  // A "safe" answer must say why, not just "looks safe".
  if (parsed.verdict === 'safe' && !parsed.reasons.length) parsed.reasons = whySafe(text);

  const result = { ...parsed, signals, source: out.source, ms: Math.round(performance.now() - t0) };
  if (result.source !== 'unknown') writeCache(cacheKey, result);
  tracePromise.then((t) => {
    if (!t) return;
    t.putAttribute('source', String(result.source));
    t.putAttribute('verdict', String(result.verdict));
    t.putMetric('duration_ms', result.ms);
    t.stop();
  });
  return result;
}

export async function warmUpOnDevice(onProgress) {
  // Only claim "ready" when Chrome really exposes the on-device Prompt API.
  const LM = globalThis.LanguageModel;
  if (!LM) return { ready: false, availability: 'no LanguageModel API (use Chrome 139+ with the flag on)' };
  let availability = 'unknown';
  try {
    availability = await LM.availability();
    if (availability === 'unavailable') return { ready: false, availability };
    const cfg = await getConfig();
    const model = getHybridModel(MODES.auto, cfg.cloud_model);
    await model.initializeDeviceModel?.(onProgress);
    return { ready: true, availability };
  } catch (e) {
    console.info('On-device model not available, cloud fallback will be used.', e);
    return { ready: false, availability: `${availability}: ${e.message || e}` };
  }
}
