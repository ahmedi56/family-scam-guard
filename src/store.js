import { addDoc, collection, onSnapshot, orderBy, query, limit, serverTimestamp } from 'firebase/firestore';
import { db, ensureUser } from './firebase.js';

// Privacy rule: the original message text is NEVER uploaded. Only the verdict, scam type and the
// short reasons produced by the model are stored.

export async function saveScan(result) {
  if (!db) return;
  const user = await ensureUser();
  await addDoc(collection(db, 'users', user.uid, 'scans'), {
    verdict: result.verdict,
    category: result.category,
    source: result.source,
    createdAt: serverTimestamp(),
  });
}

export async function alertFamily(code, result) {
  if (!db || !code) return;
  const user = await ensureUser();
  await addDoc(collection(db, 'families', code, 'alerts'), {
    verdict: result.verdict,
    category: result.category,
    reasons: (result.reasons || []).slice(0, 8), // rules allow at most 8
    from: user.uid.slice(0, 6),
    createdAt: serverTimestamp(),
  });
}

// Listeners wait for the anonymous sign-in first, otherwise Firestore rejects them (rules need auth).
function listen(buildQuery, cb, onError) {
  let unsub = () => {};
  let cancelled = false;
  ensureUser()
    .then(() => {
      if (cancelled) return;
      unsub = onSnapshot(
        buildQuery(),
        (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => onError?.(err),
      );
    })
    .catch((err) => onError?.(err));
  return () => {
    cancelled = true;
    unsub();
  };
}

export function watchFamilyAlerts(code, cb, onError) {
  if (!db || !code) return () => {};
  return listen(() => query(collection(db, 'families', code, 'alerts'), orderBy('createdAt', 'desc'), limit(20)), cb, onError);
}

export async function reportPattern(result) {
  if (!db) return;
  const user = await ensureUser();
  await addDoc(collection(db, 'reports'), {
    category: result.category,
    reasons: (result.reasons || []).slice(0, 8), // rules allow at most 8
    uid: user.uid,
    createdAt: serverTimestamp(),
  });
}

export function watchCommunity(cb, onError) {
  if (!db) return () => {};
  return listen(() => query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(15)), cb, onError);
}
