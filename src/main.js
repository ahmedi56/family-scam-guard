import './style.css';
import { firebaseConfigured, ensureUser } from './firebase.js';
import { checkMessage, warmUpOnDevice } from './detector.js';
import { saveScan, alertFamily, watchFamilyAlerts, reportPattern, watchCommunity } from './store.js';
import { loadFlagged, flaggedIn, rememberScammer, describe, textKey, VERDICT_KEY } from './signals.js';

const $ = (id) => document.getElementById(id);
// Firestore data comes from other users: tolerate anything that isn't a list of strings.
const listText = (v) => (Array.isArray(v) ? v.map(String).join(' · ') : '');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const VERDICT = {
  scam: { icon: '🚨', label: 'Likely a scam', cls: 'bad' },
  suspicious: { icon: '⚠️', label: 'Be careful', cls: 'warn' },
  safe: { icon: '✅', label: 'Looks safe', cls: 'ok' },
};

// ---- tabs -------------------------------------------------------------------------------
document.querySelectorAll('nav button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((x) => {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    });
    ['check', 'family', 'community'].forEach((t) => ($(`tab-${t}`).hidden = t !== b.dataset.tab));
  }),
);

// ---- engine badge: shows whether the on-device model is ready --------------------------
function setEngine(text, cls) {
  const el = $('engine');
  el.textContent = text;
  el.className = `badge ${cls || ''}`;
}

async function initEngine() {
  if (!firebaseConfigured) return setEngine('Setup needed: add Firebase config to .env', 'warn');
  setEngine('Preparing on-device model…');
  try {
    await ensureUser();
  } catch (e) {
    console.warn('Anonymous sign-in failed', e);
  }
  const r = await warmUpOnDevice((p) => setEngine(`Downloading on-device model ${Math.round(p * 100)}%`));
  setEngine(r.ready ? `On-device model ready 🔒 (${r.availability})` : `Cloud mode. On-device status: ${r.availability}`, r.ready ? 'ok' : '');
}

// ---- pending text from the extension's right-click menu ---------------------------------
async function loadPendingSelection() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      const { pending } = await chrome.storage.session.get('pending');
      if (pending) {
        $('msg').value = pending;
        await chrome.storage.session.remove('pending');
        runCheck();
      }
    }
  } catch {
    /* not running as an extension */
  }
}

// ---- family code ------------------------------------------------------------------------
let stopFamily = () => {};
function familyCode() {
  return ($('code').value || '').trim().toLowerCase();
}
$('code').value = localStorage.getItem('familyCode') || '';
function bindFamily() {
  localStorage.setItem('familyCode', familyCode());
  stopFamily();
  const code = familyCode();
  if (!code) return ($('alerts').innerHTML = '<li class="muted">Enter a family code to see alerts.</li>');
  stopFamily = watchFamilyAlerts(code, (items) => {
    $('alerts').innerHTML = items.length
      ? items
          .map((a) => {
            const v = VERDICT[a.verdict] || VERDICT.suspicious;
            const when = a.createdAt?.toDate ? a.createdAt.toDate().toLocaleString() : 'just now';
            return `<li class="${v.cls}"><b>${v.icon} ${esc(a.category)}</b><br><small>${esc(listText(a.reasons))}<br>${when}</small></li>`;
          })
          .join('')
      : '<li class="muted">No alerts yet. 🎉</li>';
  }, (e) => {
    console.warn('Family alerts failed', e);
    $('alerts').innerHTML = `<li class="warn">Could not load alerts: ${esc(e.code || e.message)}</li>`;
  });
}
$('code').addEventListener('change', bindFamily);

// ---- community feed ---------------------------------------------------------------------
watchCommunity((items) => {
  if (!items.length) return;
  $('community').innerHTML = items
    .map((r) => `<li><b>${esc(r.category)}</b><br><small>${esc(listText(r.reasons))}</small></li>`)
    .join('');
}, (e) => {
  console.warn('Community feed failed', e);
  $('community').innerHTML = `<li class="warn">Could not load reports: ${esc(e.code || e.message)}</li>`;
});

// ---- check flow -------------------------------------------------------------------------
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
$('cloudOnly').checked = store.get('fast') === '1';
$('cloudOnly').addEventListener('change', () => store.set('fast', $('cloudOnly').checked ? '1' : '0'));

$('paste').addEventListener('click', async () => {
  try {
    $('msg').value = await navigator.clipboard.readText();
    $('msg').focus();
  } catch {
    $('msg').focus(); // clipboard blocked: let the user paste with Ctrl+V
  }
});
$('clear').addEventListener('click', () => {
  $('msg').value = '';
  $('result').hidden = true;
  $('msg').focus();
});

const SPEECH_LANG = { en: 'en-US', fr: 'fr-FR', ar: 'ar', pcm: 'en-NG', auto: undefined };
function speak(text, lang) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (SPEECH_LANG[lang]) u.lang = SPEECH_LANG[lang];
  speechSynthesis.speak(u);
}

function flagsHtml(signals) {
  return signals.length ? `<ul class="flags">${signals.map((s) => `<li>🚩 ${esc(s)}</li>`).join('')}</ul>` : '';
}

// Instant card from rules alone, shown while the AI confirms.
function renderPending(out, q) {
  const v = VERDICT[q.verdict];
  const head = v ? `${v.icon} Looks ${q.verdict === 'scam' ? 'like a scam' : 'risky'}` : '🔎 Checking…';
  out.className = `result pending ${v ? v.cls : ''}`;
  out.innerHTML = `
    <h2>${head} <small>quick check</small></h2>
    ${flagsHtml(q.signals)}
    <p class="where"><span class="spinner"></span><span id="statusLine">Starting…</span></p>`;
}
const setStatus = (s) => { const el = $('statusLine'); if (el) el.textContent = s; };

async function runCheck() {
  const text = $('msg').value.trim();
  if (!text) return;
  const out = $('result');
  out.hidden = false;
  out.className = 'result pending';
  out.innerHTML = '<p class="where"><span class="spinner"></span><span id="statusLine">Starting…</span></p>';
  $('go').disabled = true;
  const fast = $('cloudOnly').checked;
  const seenBefore = flaggedIn(text, await loadFlagged());
  try {
    const r = await checkMessage(text, {
      mode: fast ? 'cloud' : 'auto',
      lang: $('lang').value,
      onQuick: (q) => renderPending(out, q),
      onStatus: setStatus,
    });
    const v = VERDICT[r.verdict];
    const secs = (r.ms / 1000).toFixed(r.ms < 10000 ? 1 : 0);
    const where =
      r.source === 'on_device' ? `🔒 Analyzed on your device in ${secs}s. The message never left your phone or computer.`
      : r.source === 'cache' ? '⚡ Same message checked before. Instant answer.'
      : `☁️ Analyzed in the cloud in ${secs}s.`;
    const why = r.reasons.length ? r.reasons : r.signals;
    const slow = r.source === 'on_device' && r.ms > 20000 ? '<p class="tip">💡 This device is slow at on-device AI. Turn on <b>Fast mode</b> for answers in a few seconds.</p>' : '';
    out.className = `result ${v.cls}`;
    out.innerHTML = `
      <h2>${v.icon} ${v.label} <small>${r.confidence}%</small></h2>
      ${/^(none|aucun|لا شيء)?$/i.test(r.category.trim()) ? '' : `<p><b>${esc(r.category)}</b></p>`}
      ${r.reasons.length ? `<ul>${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${flagsHtml(r.signals)}
      ${seenBefore.length ? `<p class="flags">🚩 Flagged as a scam before: ${esc(seenBefore.map(describe).join(', '))}</p>` : ''}
      <p class="advice">${esc(r.advice)}</p>
      <div class="actions">
        <button id="speak" class="ghost">🔊 Read aloud</button>
        ${r.verdict !== 'safe' ? '<button id="report" class="ghost">Report this scam pattern</button>' : ''}
      </div>
      <p class="where">${where}</p>${slow}`;
    $('speak').addEventListener('click', () => speak(`${v.label}. ${r.advice}`, $('lang').value));
    $('report')?.addEventListener('click', async (e) => {
      await reportPattern({ ...r, reasons: why });
      e.target.textContent = 'Thank you! Reported (no message text shared).';
      e.target.disabled = true;
    });
    // Tell the page Guardian (extension only) what the AI decided. No message text, only its id.
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ [VERDICT_KEY]: { key: textKey(text), verdict: r.verdict, reasons: why, advice: r.advice, source: r.source, t: Date.now() } });
      }
    } catch {
      /* not running as an extension */
    }
    // Remember this scammer's links/numbers on this device so the page scanner warns next time.
    if (r.verdict === 'scam') rememberScammer(text).catch(() => {});
    // Best-effort cloud writes; they must never block the verdict.
    const note = (msg) => out.insertAdjacentHTML('beforeend', `<p class="where">${esc(msg)}</p>`);
    saveScan(r).catch((e) => {
      console.warn('saveScan failed', e);
      note(`History not saved: ${e.code || e.message}`);
    });
    if (r.verdict !== 'safe' && $('notify').checked && familyCode()) {
      alertFamily(familyCode(), { ...r, reasons: why })
        .then(() => note('👪 Family alerted.'))
        .catch((e) => {
          console.warn('alertFamily failed', e);
          note(`Family alert not sent: ${e.code || e.message}`);
        });
    }
  } catch (e) {
    console.error(e);
    out.className = 'result warn';
    out.innerHTML = `<p>Could not check this message. ${esc(e.message || '')}</p><p class="tip">Try again, or turn on Fast mode.</p>`;
  } finally {
    $('go').disabled = false;
  }
}
$('go').addEventListener('click', runCheck);
$('msg').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runCheck();
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

initEngine();
bindFamily();
loadPendingSelection();
