// Run with: npm test
import assert from 'node:assert';
const { matchSignals, isScamShaped, whySafe, indicators } = await import('../src/signals.js');
const scam = (t) => isScamShaped(matchSignals(t));

// Real scams: Guardian must pop up.
assert(scam('URGENT: your bank account will be blocked today. Send the OTP code we sent you to verify now.'));
assert(scam('Congratulations you won the lottery! Send 5k now to release your prize: bit.ly/claim-now'));
assert(scam('Oga, I don win lottery for you. Send 5k make I release your prize now now immediately'));
assert(scam('Votre compte bloqué! Envoyez votre code de vérification immédiatement'));
assert(scam('مبروك! ربحت جائزة. أرسل رمز التحقق عاجل'));

// Everyday and developer text (GitHub, docs, chats): Guardian must stay quiet.
for (const t of [
  'We send you a notification when the build is blocked. Act now to update your password settings.',
  'Fix: urgent bug when account is locked, send logs please',
  'Send the PR when ready; the pipeline is blocked until review.',
  'Reset your password from the settings page if you forget your PIN.',
  'Hello, the meeting tomorrow is moved to 3pm. See you there.',
]) assert(!scam(t), `false alarm on: ${t}`);

assert.equal(whySafe('Hi mum, dinner at 7?').length, 3);
assert.equal(indicators('call +234 803 555 1234').length, 1);
console.log('signals ok');
