# 🛡️ Family Scam Guard

Paste a suspicious SMS, WhatsApp message, email or link and get a simple verdict (scam / be careful / looks safe) in plain words and in your language. The check runs **on your device first** and only falls back to the cloud when needed. If a family code is set, guardians get an alert (never the message) when a risky message arrives.

Built for the #BuildHybridAI 2026 hackathon with **Firebase AI Logic hybrid inference**.

## How it uses Firebase AI Logic
- `getGenerativeModel(ai, { mode: PREFER_ON_DEVICE, inCloudParams })` in `src/firebase.js`.
- Gemini Nano in Chrome (Prompt API) analyzes the message locally. If the on-device model is missing (other browsers, phones, low-end devices) the same prompt runs on Gemini in the cloud.
- The result shows which path was used (`response.inferenceSource`): "Analyzed on your device" or "Analyzed in the cloud".
- Other Firebase pieces: **App Check** (required), **Remote Config** (cloud model and prompt tuning without redeploying), **Firestore** (scan history, family alerts, community scam patterns), **Anonymous Auth** (no email needed).

## Features
- **Guardian (Chrome extension):** an animated robot in the corner of every website (WhatsApp Web, Gmail, Facebook…). It reads new messages on the page with instant local rules, reacts when one shows scam signs (red outline, red flags, system notification) and offers **Check with AI**. The AI verdict comes back to Guardian: safe, be careful or scam, with reasons.
- **Instant first answer:** rule-based red flags show in about 0.2 s while the AI confirms.
- **Real reasons for safe messages:** a safe verdict explains why (no link, no request for money or codes, no pressure).
- **Remembers scammers:** links and phone numbers from confirmed scams are kept on the device and flagged if they show up again.
- **Fast mode:** skip the on-device model and ask the cloud directly (2 to 5 s on slow computers).
- **Result cache:** a message checked before answers instantly.
- **Read aloud** and answers in English, French, Arabic or Nigerian Pidgin.
- **Family alerts** and a **community scam-pattern feed** (Firestore), never the message text.
- **Remote Config `scam_rules`:** ship new scam patterns without a redeploy. Format: `[{"pattern":"mtn.*momo","flags":"i","label":"Mobile money pressure"}]`.
- **Offline cache** for Firestore and **Performance Monitoring** traces for each check.

## Privacy
The original message text is never uploaded. Firestore only stores the verdict, scam type and the short reasons. Guardian reads pages only on your computer; Chrome's "read and change all your data on all websites" warning is explained on the welcome page shown after install.

## Platforms
- Chrome extension (desktop, Chrome 139+): Guardian on every website, toolbar popup and right-click "Check with Family Scam Guard".
- Installable web app (PWA) for phones and desktop. On-device web inference is desktop Chrome only, so phones use the cloud fallback.

## Setup
```bash
npm install
cp .env.example .env     # fill in your Firebase web config
npm run dev
```
On Windows PowerShell use `Copy-Item .env.example .env` instead of `cp`.
1. Create a Firebase project. In the console open **AI Services > AI Logic**, choose the **Gemini Developer API** (no billing needed) and finish the guided setup.
2. Enable **Authentication > Anonymous**, **Firestore**, **App Check** and **Remote Config** (optional keys: `cloud_model`, `scam_prompt_extra`).
3. In **App Check > Apps > Manage debug tokens**, register the value you put in `VITE_APPCHECK_DEBUG_TOKEN`.
4. Deploy `firestore.rules`.
5. For on-device testing use desktop Chrome 139+ and enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, then restart.

### Chrome extension
```bash
npm run build:ext
```
Open `chrome://extensions`, turn on Developer mode, **Load unpacked**, choose `dist-ext/`.

### Hosted web app
```bash
npm run build && firebase deploy --only hosting
```
## Project structure
| Path | What it does |
| --- | --- |
| `src/firebase.js` | Firebase init, App Check, Remote Config, anonymous Auth, Firestore, hybrid model (`getHybridModel`) |
| `src/detector.js` | Prompt, tolerant JSON parsing, on-device timeout, cloud retry and backup model, result cache |
| `src/signals.js` | Instant rule-based red flags, reasons for safe messages, remembered scammer links and numbers (shared with the extension) |
| `src/store.js` | Firestore scan history, family alerts, community reports |
| `src/main.js` | Web app and popup UI |
| `extension/` | Manifest V3 extension: Guardian page watcher (`content.js`), background worker, welcome page |
| `firestore.rules` | Security rules (no message text is ever stored) |

## License
Apache-2.0, see `LICENSE`.
