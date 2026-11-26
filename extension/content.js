// Guardian: the always-on page watcher. Runs on every website, entirely on this computer: instant
// rule checks only, no AI and no network from here. When a message looks risky, Guardian reacts and
// offers an AI check, which runs in the extension popup through Firebase AI Logic (on-device first,
// cloud fallback). The popup writes the verdict back to chrome.storage.local and Guardian shows it.
(async () => {
  const { matchSignals, isScamShaped, linkRisks, flaggedIn, loadFlagged, describe, textKey, VERDICT_KEY } = await import(chrome.runtime.getURL('signals.js'));
  let flagged = await loadFlagged();

  // ---- Guardian UI, in a closed shadow root so the page's CSS cannot break it ---------------
  const host = document.createElement('div');
  host.id = 'fsg-host';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none'; // only the robot and bubble take clicks
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host{all:initial}
    .w{display:flex;flex-direction:column;align-items:flex-end;gap:8px;font:15px/1.45 system-ui,sans-serif}
    .b{background:#fff;color:#0f172a;border:2px solid var(--c);border-radius:16px;padding:12px 14px;max-width:300px;max-height:calc(100vh - 160px);overflow:auto;box-shadow:0 8px 28px #0f172a40}
    .b[hidden]{display:none} .b h3{margin:0 0 4px;font-size:16px;color:var(--c)} .b p{margin:4px 0}
    .b ul{margin:6px 0;padding-left:18px} .b q{display:block;color:#64748b;font-size:12px;margin:4px 0}
    .b button{font:inherit;font-size:14px;border:0;border-radius:10px;padding:7px 12px;cursor:pointer;margin:6px 6px 0 0}
    .go{background:var(--c);color:#fff} .x{background:#e2e8f0;color:#0f172a}
    .g{width:96px;height:96px;border:0;padding:0;background:none;cursor:pointer;border-radius:18px}
    .g:focus-visible{outline:3px solid #f59e0b;outline-offset:3px}
    svg{width:96px;height:96px;display:block;overflow:visible}
    #f,#eyes,#tip,#shadow{transform-box:fill-box;transform-origin:center}
    .eye{transition:fill .3s} #card{opacity:0;transition:opacity .3s}
    #f{animation:float 3s ease-in-out infinite} #shadow{animation:shadow 3s ease-in-out infinite}
    #eyes{animation:blink 4s infinite} #tip{animation:pulse 2.4s ease-in-out infinite}
    .warn #tip,.bad #tip{animation-duration:.6s}
    .scan #card{opacity:1} .scan #scanl{animation:sweep 1.1s ease-in-out infinite alternate}
    .ok #f{animation:hop .5s ease-out 3} .bad #f{animation:shake .35s ease-in-out 4}
    @keyframes float{50%{transform:translateY(-8px)}} @keyframes shadow{50%{transform:scaleX(.82);opacity:.3}}
    @keyframes blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
    @keyframes pulse{50%{transform:scale(1.35);opacity:.6}} @keyframes sweep{to{transform:translateY(40px)}}
    @keyframes hop{40%{transform:translateY(-18px)}} @keyframes shake{25%{transform:translateX(-7px) rotate(-3deg)}75%{transform:translateX(7px) rotate(3deg)}}
    .i{width:1.15em;height:1.15em;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:-.2em;margin-right:6px}
    .b h3{display:flex;align-items:center} .b ul.f{list-style:none;padding:0} .b ul.f li{display:flex;align-items:flex-start;margin:3px 0} .b ul.f .i{color:#b91c1c;margin-top:.15em}
    .meta{display:flex;align-items:center;font-size:12px;color:#64748b}
    .w{pointer-events:none} .b,.g{pointer-events:auto}
    /* Quiet state: shrink with transform only (no layout animation); hit area shrinks with it. */
    .g{transform-origin:bottom right;transition:transform .3s,opacity .3s}
    .mini .g{transform:scale(.46);opacity:.75} .mini .g:hover,.mini .g:focus-visible{opacity:1}
    .mini #f,.mini #shadow,.mini #tip,.mini #eyes{animation:none}
    @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
  </style>
  <div class="w watch">
    <div class="b" role="status" aria-live="polite" hidden></div>
    <button class="g" aria-label="Guardian from Family Scam Guard. Click to see what it is doing.">
      <svg viewBox="70 30 270 300" aria-hidden="true">
        <defs>
          <linearGradient id="sBody" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F8FAFC"/><stop offset=".6" stop-color="#CBD5E1"/><stop offset="1" stop-color="#94A3B8"/></linearGradient>
          <linearGradient id="sTeal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5EEAD4"/><stop offset="1" stop-color="#0D9488"/></linearGradient>
          <linearGradient id="sGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FEF3C7"/><stop offset="1" stop-color="#F59E0B"/></linearGradient>
          <linearGradient id="beamG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2DD4BF" stop-opacity="0"/><stop offset=".5" stop-color="#2DD4BF" stop-opacity=".6"/><stop offset="1" stop-color="#2DD4BF" stop-opacity="0"/></linearGradient>
        </defs>
        <ellipse id="shadow" cx="165" cy="318" rx="68" ry="12" fill="#020617" opacity=".45"/>
        <g id="f">
          <path d="M118 196c0-20 94-20 94 0l-8 72c-4 20-74 20-78 0Z" fill="url(#sBody)"/>
          <path d="M165 208l23 8v18c0 14-12 24-23 28-11-4-23-14-23-28v-18Z" fill="url(#sTeal)"/>
          <path d="M157 234l6 6 12-14" fill="none" stroke="#0F172A" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
          <rect x="94" y="114" width="18" height="46" rx="9" fill="url(#sTeal)"/><rect x="218" y="114" width="18" height="46" rx="9" fill="url(#sTeal)"/>
          <line x1="165" y1="78" x2="165" y2="54" stroke="#94A3B8" stroke-width="6" stroke-linecap="round"/>
          <circle id="tip" cx="165" cy="48" r="9" fill="url(#sGold)"/>
          <rect x="105" y="76" width="120" height="106" rx="44" fill="url(#sBody)"/>
          <path d="M130 86q35-8 70 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".7"/>
          <rect x="119" y="96" width="92" height="66" rx="26" fill="#0B1120"/>
          <g id="eyes"><rect class="eye" x="136" y="118" width="16" height="22" rx="8" fill="#5EEAD4"/><rect class="eye" x="178" y="118" width="16" height="22" rx="8" fill="#5EEAD4"/>
            <circle cx="141" cy="124" r="3" fill="#fff"/><circle cx="183" cy="124" r="3" fill="#fff"/></g>
          <circle cx="88" cy="228" r="18" fill="url(#sBody)"/><circle cx="88" cy="228" r="10" fill="url(#sTeal)"/>
          <circle cx="242" cy="218" r="18" fill="url(#sBody)"/><circle cx="256" cy="202" r="16" fill="#0F172A" stroke="url(#sGold)" stroke-width="5"/><circle cx="256" cy="202" r="7" fill="#38BDF8" opacity=".8"/>
        </g>
        <g id="card">
          <rect x="242" y="108" width="88" height="62" rx="12" fill="#1E293B" stroke="#38BDF8" stroke-width="2.5"/>
          <line x1="256" y1="126" x2="314" y2="126" stroke="#94A3B8" stroke-width="5" stroke-linecap="round"/><line x1="256" y1="140" x2="300" y2="140" stroke="#94A3B8" stroke-width="5" stroke-linecap="round"/><line x1="256" y1="154" x2="284" y2="154" stroke="#FBBF24" stroke-width="5" stroke-linecap="round"/>
          <rect id="scanl" x="244" y="112" width="84" height="14" rx="4" fill="url(#beamG)"/>
        </g>
      </svg>
    </button>
  </div>`;
  document.documentElement.appendChild(host);
  const wrap = root.querySelector('.w');
  const bubble = root.querySelector('.b');
  // Darker shades keep bubble titles and white button text above 4.5:1 contrast.
  const COLORS = { watch: '#0f766e', warn: '#b45309', scan: '#0369a1', ok: '#047857', bad: '#b91c1c' };
  const EYES = { watch: '#5EEAD4', warn: '#FBBF24', scan: '#38BDF8', ok: '#34D399', bad: '#F87171' };

  let current = null; // { text, key, block } the message Guardian is talking about
  function setState(state, html) {
    // Quiet by default: a small still button until there is something to say.
    wrap.className = `w ${state}${state === 'watch' && !html ? ' mini' : ''}`;
    wrap.style.setProperty('--c', COLORS[state]);
    root.querySelectorAll('.eye').forEach((e) => e.setAttribute('fill', EYES[state]));
    bubble.hidden = !html;
    bubble.innerHTML = html || '';
  }
  // Same outline icons as the app (the shadow root can't use the popup's SVG sprite).
  const P = {
    scam: '<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>',
    warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    safe: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    flag: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  };
  const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
  const li = (items) => items.map((s) => `<li>${esc(s)}</li>`).join('');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const buttons = (check) => `${check ? '<button class="go">Check with AI</button>' : ''}<button class="x">OK</button>`;

  function bindButtons() {
    root.querySelector('.x')?.addEventListener('click', () => setState('watch'));
    root.querySelector('.go')?.addEventListener('click', () => {
      setState('scan', `<h3>${ic('search')}Checking…</h3><p>I am asking the AI, on your device first. The message stays private.</p>`);
      chrome.runtime.sendMessage({ type: 'check', text: current.text });
      current.block.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  root.querySelector('.g').addEventListener('click', () => {
    if (!bubble.hidden) return setState('watch');
    setState('watch', `<h3>Guardian is watching</h3>
      <p>I have checked <b>${checked}</b> message${checked === 1 ? '' : 's'} on this page${risky ? `, and <b>${risky}</b> looked risky` : '. Nothing risky so far'}.</p>
      <p>I react on my own when a message shows scam signs. To check any text yourself, select it, right-click, and choose <b>Check with Family Scam Guard</b>.</p>
      <p class="meta">${ic('lock')}I read only on this computer and never save or share your messages.</p>${buttons(false)}`);
    bindButtons();
  });
  let checked = 0;
  let risky = 0;

  // Say hello once, so a new user knows Guardian is alive and what it does.
  chrome.storage.local.get('fsg-greeted').then(({ 'fsg-greeted': greeted }) => {
    if (greeted || current || risky) return;
    chrome.storage.local.set({ 'fsg-greeted': true });
    setState('watch', `<h3>${ic('hand')}Hi, I am Guardian</h3><p>I watch the messages on the pages you visit and warn you when one looks like a scam. Click me any time to see what I have checked.</p>${buttons(false)}`);
    bindButtons();
  });

  // Only called for scam-shaped messages (see scan); the AI confirms on request.
  function react(block, text, signals, before) {
    current = { text, key: textKey(text), block };
    risky++;
    block.style.outline = '2px solid #dc2626';
    block.style.outlineOffset = '2px';
    const flags = [...signals, ...(before.length ? [`Flagged as a scam before: ${before.map(describe).join(', ')}`] : [])];
    setState('bad', `<h3>${ic('scam')}This looks like a scam</h3>
      <q>${esc(text.slice(0, 90))}${text.length > 90 ? '…' : ''}</q><ul class="f">${flags.map((f) => `<li>${ic('flag')}<span>${esc(f)}</span></li>`).join('')}</ul>
      <p><b>Do not click links or send codes or money yet.</b></p>${buttons(true)}`);
    bindButtons();
    chrome.runtime.sendMessage({ type: 'alert', site: location.hostname });
  }

  // The popup's AI verdict for the message Guardian asked about.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes['fsg-flagged-v1']) flagged = await loadFlagged();
    const v = changes[VERDICT_KEY]?.newValue;
    if (!v || !current || v.key !== current.key) return;
    const state = v.verdict === 'safe' ? 'ok' : v.verdict === 'scam' ? 'bad' : 'warn';
    const title = v.verdict === 'safe' ? `${ic('safe')}The AI says this looks safe` : v.verdict === 'scam' ? `${ic('scam')}The AI confirms: likely a scam` : `${ic('warn')}The AI says: be careful`;
    if (state === 'ok') current.block.style.outline = '2px solid #059669';
    setState(state, `<h3>${title}</h3><ul>${li(v.reasons || [])}</ul><p><b>${esc(v.advice || '')}</b></p>
      <p class="meta">${v.source === 'on_device' ? `${ic('lock')}Checked on your device` : v.source === 'cache' ? `${ic('clock')}Checked before` : `${ic('cloud')}Checked in the cloud`}</p>${buttons(false)}`);
    bindButtons();
  });

  // ---- page scanning ---------------------------------------------------------------------------
  let seen = new WeakMap(); // block -> text already scanned
  const warned = new Set(); // texts Guardian already reacted to on this page
  const BLOCKS = 'p,li,td,blockquote,article,[role="row"],[role="listitem"],[data-pre-plain-text],div';

  function scan(rootNode) {
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    const blocks = new Set();
    for (let n = walker.nextNode(), i = 0; n && i < 2000; n = walker.nextNode(), i++) {
      const el = n.parentElement;
      if (!el || n.textContent.trim().length < 3 || el.closest('input,textarea,[contenteditable="true"],script,style,pre,code,.markdown-body')) continue;
      const block = el.closest(BLOCKS);
      if (block) blocks.add(block);
    }
    for (const block of blocks) {
      const text = (block.innerText || '').trim();
      if (text.length < 25 || text.length > 1500 || seen.get(block) === text) continue;
      seen.set(block, text);
      checked++;
      // Also read where links really go: an email's "Click here" can hide a fake address.
      const hrefs = [...block.querySelectorAll('a[href^="http"]')].slice(0, 20).map((a) => a.href).join(' ');
      const signals = matchSignals(`${text} ${hrefs}`);
      const before = flaggedIn(text, flagged);
      if ((isScamShaped(signals) || before.length) && !warned.has(text)) {
        warned.add(text);
        react(block, text, signals, before);
      }
    }
  }

  // "Scan this page" from the extension popup: re-read everything and always answer.
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type !== 'scan-page') return;
    seen = new WeakMap();
    warned.clear();
    checked = 0;
    const before = risky;
    scan(document.body);
    const found = risky - before;
    if (!found) {
      setState('ok', `<h3>${ic('safe')}No scam signs on this page</h3><p>I checked <b>${checked}</b> message${checked === 1 ? '' : 's'} and found nothing suspicious.</p>${buttons(false)}`);
      bindButtons();
    }
    reply({ checked, found });
  });

  setState('watch');
  // Is the website itself fake? (an address copying a bank or brand, a bare number address, look-alike letters)
  const siteRisks = linkRisks(location.href);
  if (siteRisks.length) {
    risky++;
    setState('bad', `<h3>${ic('scam')}This website may be fake</h3><p class="meta">${esc(location.hostname)}</p>
      <ul class="f">${siteRisks.map((f) => `<li>${ic('flag')}<span>${esc(f)}</span></li>`).join('')}</ul>
      <p><b>Do not enter passwords, codes or card details on this site.</b></p>${buttons(false)}`);
    bindButtons();
    chrome.runtime.sendMessage({ type: 'alert', site: location.hostname });
  }
  scan(document.body);
  // Rescan only what changes (new chat messages, new emails), at most every 700 ms.
  const pending = new Set();
  let timer;
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') pending.add(m.target.parentElement);
      for (const n of m.addedNodes) pending.add(n.nodeType === 1 ? n : n.parentElement);
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const n of pending) if (n?.isConnected) scan(n);
      pending.clear();
    }, 700);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
})();
