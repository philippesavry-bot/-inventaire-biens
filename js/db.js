const DB_NAME = 'inventaire-biens';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'k' });
      }
      if (!db.objectStoreNames.contains('records')) {
        db.createObjectStore('records', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const result = fn(store);
        transaction.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      })
  );
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getMeta(k) {
  return tx('meta', 'readonly', (store) => reqToPromise(store.get(k)));
}

export async function putMeta(entry) {
  return tx('meta', 'readwrite', (store) => store.put(entry));
}

export async function getAllRecords() {
  return tx('records', 'readonly', (store) => reqToPromise(store.getAll()));
}

export async function putRecord(record) {
  return tx('records', 'readwrite', (store) => store.put(record));
}

export async function deleteRecord(id) {
  return tx('records', 'readwrite', (store) => store.delete(id));
}

export async function deleteRecords(ids) {
  return tx('records', 'readwrite', (store) => {
    ids.forEach((id) => store.delete(id));
  });
}

export async function clearAll() {
  return tx('records', 'readwrite', (store) => store.clear());
}

export async function deleteMeta(k) {
  return tx('meta', 'readwrite', (store) => store.delete(k));
}
