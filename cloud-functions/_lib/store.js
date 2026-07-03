/**
 * Persistent profile storage.
 *
 * Deployed: EdgeOne Blob (`@edgeone/pages-blob`) — store.get / store.set.
 * Local:    ./local-store.json when writable.
 * Fallback: in-memory Map (EdgeOne FS is read-only if Blob is unavailable).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCAL_PATH = resolve(process.cwd(), 'local-store.json');
const BLOB_NS = 'medscan';

let backend = null; // 'blob' | 'local-json' | 'memory'
let blobStore = null;
let memory = Object.create(null);
let logged = false;
let localWritable = null;

function logBackend() {
  if (logged) return;
  logged = true;
  const msg =
    backend === 'blob'
      ? '[store] ACTIVE BACKEND: edgeone-blob (namespace=medscan)'
      : backend === 'local-json'
        ? '[store] ACTIVE BACKEND: local-json (./local-store.json)'
        : '[store] ACTIVE BACKEND: memory (ephemeral)';
  console.log(msg);
}

function canWriteLocal() {
  if (localWritable != null) return localWritable;
  try {
    writeFileSync(LOCAL_PATH, existsSync(LOCAL_PATH) ? readFileSync(LOCAL_PATH) : '{}');
    localWritable = true;
  } catch {
    localWritable = false;
  }
  return localWritable;
}

function loadLocal() {
  if (!canWriteLocal()) return memory;
  try {
    if (!existsSync(LOCAL_PATH)) return memory;
    const data = JSON.parse(readFileSync(LOCAL_PATH, 'utf8'));
    memory = { ...memory, ...data };
    return memory;
  } catch {
    return memory;
  }
}

function saveLocal(data) {
  memory = data;
  if (!canWriteLocal()) {
    backend = 'memory';
    logBackend();
    return;
  }
  try {
    writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2));
    backend = 'local-json';
    logBackend();
  } catch {
    backend = 'memory';
    logBackend();
  }
}

async function ensureBlob() {
  if (backend === 'local-json' || backend === 'memory') return null;
  if (blobStore) return blobStore;
  try {
    const mod = await import('@edgeone/pages-blob');
    const getStore = mod.getStore ?? mod.default?.getStore;
    if (typeof getStore !== 'function') throw new Error('getStore not exported');
    // Prefer string form (auto-creates namespace inside Makers)
    blobStore = getStore(BLOB_NS);
    return blobStore;
  } catch (err) {
    console.warn('[store] Blob SDK init failed:', err?.message || err);
    return null;
  }
}

export const store = {
  async get(key) {
    const s = await ensureBlob();
    if (s) {
      try {
        const val = await s.get(key, { type: 'json', consistency: 'strong' });
        backend = 'blob';
        logBackend();
        return val ?? null;
      } catch (err) {
        console.warn('[store] Blob get failed:', err?.message || err);
      }
    }
    const data = loadLocal();
    if (backend !== 'blob') {
      backend = canWriteLocal() ? 'local-json' : 'memory';
      logBackend();
    }
    return data[key] ?? null;
  },

  async set(key, val) {
    const s = await ensureBlob();
    if (s) {
      try {
        if (typeof s.setJSON === 'function') {
          await s.setJSON(key, val);
        } else {
          await s.set(key, JSON.stringify(val));
        }
        backend = 'blob';
        logBackend();
        return;
      } catch (err) {
        console.warn('[store] Blob set failed:', err?.message || err);
      }
    }
    const data = loadLocal();
    data[key] = val;
    saveLocal(data);
  },
};
