const DB_NAME = 'viral-history';
const DB_VERSION = 1;

export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('tweets')) {
        db.createObjectStore('tweets', { keyPath: 'tweet_id' });
      }
      if (!db.objectStoreNames.contains('samples')) {
        const s = db.createObjectStore('samples', { keyPath: 'id', autoIncrement: true });
        s.createIndex('by_tweet', 'tweet_id', { unique: false });
        s.createIndex('by_tweet_ts', ['tweet_id', 'ts'], { unique: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, names, mode) {
  return db.transaction(names, mode);
}

function pwrap(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

export async function upsertTweet(db, tweet) {
  const t = tx(db, ['tweets'], 'readwrite');
  await pwrap(t.objectStore('tweets').put(tweet));
}

export async function getTweet(db, tweetId) {
  const t = tx(db, ['tweets'], 'readonly');
  return pwrap(t.objectStore('tweets').get(tweetId));
}

export async function listTweets(db) {
  const t = tx(db, ['tweets'], 'readonly');
  return pwrap(t.objectStore('tweets').getAll());
}

export async function putSample(db, sample) {
  const t = tx(db, ['samples'], 'readwrite');
  try {
    await pwrap(t.objectStore('samples').add(sample));
  } catch (e) {
    if (e?.name !== 'ConstraintError') throw e;
  }
}

export async function getSamples(db, tweetId) {
  const t = tx(db, ['samples'], 'readonly');
  const idx = t.objectStore('samples').index('by_tweet_ts');
  const range = IDBKeyRange.bound([tweetId, -Infinity], [tweetId, Infinity]);
  return pwrap(idx.getAll(range));
}

export async function getLastSample(db, tweetId) {
  const t = tx(db, ['samples'], 'readonly');
  const idx = t.objectStore('samples').index('by_tweet_ts');
  const range = IDBKeyRange.bound([tweetId, -Infinity], [tweetId, Infinity]);
  return new Promise((res, rej) => {
    const req = idx.openCursor(range, 'prev');
    req.onsuccess = () => res(req.result ? req.result.value : null);
    req.onerror = () => rej(req.error);
  });
}
