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

// A dangerous link alone is enough.
assert(scam('Your parcel is waiting: http://dhl-delivery-fee.xyz/pay'));
assert(scam('Log in here to keep your account: paypal-secure-login.com/verify'));
assert(scam('See the photos http://45.77.12.9/album'));
assert(!scam('Router settings: http://192.168.1.1/admin'), 'home router flagged');
assert(scam('Open https://xn--pypal-4ve.com/login'));
assert(scam('Click http://www.paypal.com@evil.example/login'));

// Real brand websites and ordinary links stay quiet.
for (const t of [
  'Your PayPal receipt: https://www.paypal.com/myaccount/transactions',
  'Track it at https://www.dhl.com/track?id=123 and see you soon',
  'Docs: https://developer.apple.com/documentation and https://groups.google.com/g/test',
  'Join the call at https://meet.google.com/abc-defg-hij',
]) assert(!scam(t), `false alarm on: ${t}`);

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
