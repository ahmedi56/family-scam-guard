import './style.css';
import { firebaseConfigured, ensureUser } from './firebase.js';
import { checkMessage, warmUpOnDevice } from './detector.js';
import { saveScan, alertFamily, watchFamilyAlerts, reportPattern, watchCommunity } from './store.js';
import { loadFlagged, flaggedIn, rememberScammer, describe, textKey, VERDICT_KEY } from './signals.js';

const $ = (id) => document.getElementById(id);
// Firestore data comes from other users: tolerate anything that isn't a list of strings.
const listText = (v) => (Array.isArray(v) ? v.map(String).join(' · ') : '');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Icons come from the SVG sprite in index.html.
const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const VERDICT = {
  scam: { icon: 'scam', label: "Scam. Don't reply.", short: 'Likely a scam', cls: 'bad' },
  suspicious: { icon: 'warn', label: 'Be careful', short: 'Be careful', cls: 'warn' },
  safe: { icon: 'safe', label: 'Looks safe', short: 'Looks safe', cls: 'ok' },
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
function setEngine(text, cls, iconName, detail = '') {
  const el = $('engine');
  el.innerHTML = `${iconName ? icon(iconName) : ''}${esc(text)}`;
  el.title = detail;
  el.className = `pill ${cls || ''}`;
}

async function initEngine() {
  if (!firebaseConfigured) return setEngine('Setup needed', 'warn', 'warn', 'Add the Firebase config to .env');
  setEngine('Getting ready…');
  try {
    await ensureUser();
  } catch (e) {
    console.warn('Anonymous sign-in failed', e);
  }
  const r = await warmUpOnDevice((p) => setEngine(`Getting private mode ready ${Math.round(p * 100)}%`));
  // Plain words for grandparents; the technical status stays in the tooltip.
  if (r.ready) setEngine('Private mode', 'ok', 'lock', `AI runs on this device (${r.availability})`);
  else setEngine('Cloud mode', '', 'cloud', `On-device AI not available here (${r.availability})`);
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
            const at = a.createdAt?.toDate ? when.format(a.createdAt.toDate()) : 'Just now';
            return `<li class="${v.cls}"><b>${icon(v.icon)}${esc(a.category)}</b><small>${esc(listText(a.reasons))}<br>${at}</small></li>`;
          })
          .join('')
      : '<li class="muted">No alerts yet. Your family is safe so far.</li>';
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
    .map((r) => `<li><b>${icon('flag')}${esc(r.category)}</b><small>${esc(listText(r.reasons))}</small></li>`)
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
  return signals.length ? `<ul class="flags">${signals.map((s) => `<li>${icon('flag')}<span>${esc(s)}</span></li>`).join('')}</ul>` : '';
}

// Instant card from rules alone, shown while the AI confirms.
function renderPending(out, q) {
  const v = VERDICT[q.verdict];
  out.className = `result pending ${v ? v.cls : ''}`;
  out.innerHTML = `
    <h2 class="verdict">${icon(v ? v.icon : 'search')}${v ? (q.verdict === 'scam' ? 'Looks like a scam' : 'Looks risky') : 'Checking…'}<small>Quick check</small></h2>
    <div class="body">${flagsHtml(q.signals)}
    <p class="where"><span class="spinner"></span><span id="statusLine">Starting…</span></p></div>`;
}
const setStatus = (s) => { const el = $('statusLine'); if (el) el.textContent = s; };

async function runCheck() {
  const text = $('msg').value.trim();
  if (!text) return;
  const out = $('result');
  out.hidden = false;
  out.className = 'result pending';
  out.innerHTML = `<h2 class="verdict">${icon('search')}Checking…</h2><div class="body"><p class="where"><span class="spinner"></span><span id="statusLine">Starting…</span></p></div>`;
  // Bring the answer into view, without a smooth scroll for people who prefer less motion.
  out.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
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
      r.source === 'on_device' ? `${icon('lock')}Checked on your device in ${secs}s. The message never left it.`
      : r.source === 'cache' ? `${icon('clock')}Checked before, so this answer is instant.`
      : `${icon('cloud')}Checked by the cloud AI in ${secs}s.`;
    const why = r.reasons.length ? r.reasons : r.signals;
    const slow = r.source === 'on_device' && r.ms > 20000 ? `<p class="tip">${icon('zap')}<span>This device is slow at on-device AI. Turn on <b>Fast mode</b> in Options for answers in a few seconds.</span></p>` : '';
    out.className = `result ${v.cls}`;
    out.innerHTML = `
      <h2 class="verdict">${icon(v.icon)}${v.label}<small>${r.confidence}%</small></h2>
      <div class="body">
      ${/^(none|aucun|لا شيء)?$/i.test(r.category.trim()) ? '' : `<p class="category">${esc(r.category)}</p>`}
      ${r.advice ? `<p class="advice"><b>What to do</b>${esc(r.advice)}</p>` : ''}
      ${r.reasons.length ? `<ul class="why">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${flagsHtml(r.signals)}
      ${seenBefore.length ? `<ul class="flags"><li>${icon('flag')}<span>Flagged as a scam before: ${esc(seenBefore.map(describe).join(', '))}</span></li></ul>` : ''}
      <div class="actions">
        <button id="speak" type="button">${icon('volume')}Read Aloud</button>
        ${r.verdict !== 'safe' ? `<button id="report" type="button">${icon('flag')}Report Pattern</button>` : ''}
      </div>
      <p class="where">${where}</p>${slow}</div>`;
    $('speak').addEventListener('click', () => speak(`${v.short}. ${r.advice}`, $('lang').value));
    $('report')?.addEventListener('click', async (e) => {
      await reportPattern({ ...r, reasons: why });
      const b = e.currentTarget;
      b.innerHTML = `${icon('safe')}Reported, without the message text`;
      b.disabled = true;
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
    const note = (msg, ic = 'warn') => out.querySelector('.body').insertAdjacentHTML('beforeend', `<p class="where">${icon(ic)}${esc(msg)}</p>`);
    saveScan(r).catch((e) => {
      console.warn('saveScan failed', e);
      note(`History not saved: ${e.code || e.message}`);
    });
    if (r.verdict !== 'safe' && $('notify').checked && familyCode()) {
      alertFamily(familyCode(), { ...r, reasons: why })
        .then(() => note('Your family was alerted.', 'users'))
        .catch((e) => {
          console.warn('alertFamily failed', e);
          note(`Family alert not sent: ${e.code || e.message}`);
        });
    }
  } catch (e) {
    console.error(e);
    out.className = 'result warn';
    out.innerHTML = `<h2 class="verdict">${icon('warn')}Couldn't check this message</h2><div class="body"><p>Check your internet connection and try again, or turn on Fast mode in Options.</p><p class="where">${esc(e.message || '')}</p></div>`;
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

// ---- "Scan this page" (extension popup only): ask Guardian on the open tab to re-check it ----
if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
  $('scanBox').hidden = false;
  $('scanPage').addEventListener('click', async () => {
    const status = $('scanStatus');
    status.textContent = 'Guardian is scanning the page…';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'scan-page' });
      status.innerHTML = r.found
        ? `${icon('scam')}Guardian found ${r.found} message${r.found === 1 ? '' : 's'} that look like a scam. Look at the page.`
        : `${icon('safe')}Guardian checked ${r.checked} message${r.checked === 1 ? '' : 's'}: no scam signs.`;
    } catch {
      // No content script there: chrome:// pages, the Web Store, or a tab opened before install.
      status.textContent = "Guardian can't read this page. Chrome blocks extensions on its own pages; on other sites, reload the page and try again.";
    }
  });
}

// The landing section is for the hosted website only, not the extension popup.
if (location.protocol.startsWith('http')) $('landing').hidden = false;

initEngine();
bindFamily();
loadPendingSelection();
