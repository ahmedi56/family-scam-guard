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

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender.tab) return;
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
