const stores = new Map();

class FakeRequest {
  constructor() {
    this.onsuccess = null;
    this.onerror = null;
    this.result = undefined;
    this.error = null;
  }
}

class FakeStore {
  constructor(keyPath, data) {
    this.keyPath = keyPath;
    this.data = data;
  }

  keyOf(value) {
    return value[this.keyPath];
  }

  get(k) {
    const req = new FakeRequest();
    setTimeout(() => {
      if (this.data.has(k)) req.result = this.data.get(k);
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }

  put(value) {
    const req = new FakeRequest();
    setTimeout(() => {
      this.data.set(this.keyOf(value), value);
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }

  delete(k) {
    const req = new FakeRequest();
    setTimeout(() => {
      this.data.delete(k);
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }

  clear() {
    const req = new FakeRequest();
    setTimeout(() => {
      this.data.clear();
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }

  getAll() {
    const req = new FakeRequest();
    setTimeout(() => {
      req.result = [...this.data.values()];
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }
}

const db = {
  objectStoreNames: {
    contains: (name) => stores.has(name)
  },
  createObjectStore(name, options) {
    const store = new FakeStore(options ? options.keyPath : undefined, new Map());
    stores.set(name, store);
    return store;
  },
  transaction(name) {
    const store = stores.get(name);
    const t = {
      oncomplete: null,
      onerror: null,
      onabort: null,
      objectStore: () => store
    };
    setTimeout(() => {
      if (t.oncomplete) t.oncomplete();
    }, 0);
    return t;
  }
};

export function installMock() {
  globalThis.indexedDB = {
    open(name) {
      const request = {
        result: null,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null
      };
      setTimeout(() => {
        request.result = db;
        if (!stores.has('meta')) request.onupgradeneeded({ result: db });
        if (request.onsuccess) request.onsuccess();
      }, 0);
      return request;
    }
  };
}

export function resetMock() {
  stores.clear();
}
