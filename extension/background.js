// Right-click check, Guardian's "Check with AI", scam notifications, and the welcome page.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.contextMenus.create({ id: 'check', title: 'Check with Family Scam Guard', contexts: ['selection'] });
  if (reason === 'install') chrome.tabs.create({ url: 'welcome.html' });
});

async function openCheck(text) {
  await chrome.storage.session.set({ pending: text });
  try {
    await chrome.action.openPopup();
  } catch {
    // Popup could not open (window not focused, older Chrome): use a small window instead.
    chrome.windows.create({ url: 'index.html', type: 'popup', width: 440, height: 720 });
  }
}

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'check' && info.selectionText) openCheck(info.selectionText);
});

// Guardian's automatic check runs in a hidden copy of the popup page (Firebase AI Logic needs a page).
// Two tabs can ask at the same moment, and Chrome allows only one hidden page: share one creation.
let creating = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: 'index.html?offscreen=1',
      reasons: ['LOCAL_STORAGE'],
      justification: 'Run the Firebase AI Logic scam check for Guardian in the background.',
    })
    .finally(() => (creating = null));
  await creating;
}

// A freshly created hidden page needs a moment before it listens: retry instead of failing silently.
async function askOffscreen(text) {
  for (let i = 0; ; i++) {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'offscreen-check', text });
      if (r !== undefined) return r;
    } catch (e) {
      if (i >= 20 || !/Receiving end does not exist|Could not establish connection/i.test(String(e?.message || e))) throw e;
    }
    if (i >= 20) return { error: 'The AI page did not answer' };
    await new Promise((r) => setTimeout(r, 500));
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!sender.tab) return;
  if (msg?.type === 'ai-check' && typeof msg.text === 'string') {
    ensureOffscreen()
      .then(() => askOffscreen(msg.text))
      .then(reply, (e) => reply({ error: String(e?.message || e) }));
    return true; // answer asynchronously
  }
  if (msg?.type === 'check' && typeof msg.text === 'string') openCheck(msg.text.slice(0, 4000));
  // The notification names the site only, never the message.
  if (msg?.type === 'alert') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'Guardian: possible scam',
      message: `A message on ${String(msg.site || 'this page').slice(0, 60)} looks like a scam. Do not click links or send codes or money.`,
      priority: 2,
    });
  }
});
