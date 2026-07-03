/**
 * User accounts in built-in store (Blob / local-json) — no Neon / external DB.
 */

import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';
import { store } from './store.js';

function userKey(username) {
  return `user:${String(username).trim().toLowerCase()}`;
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const h = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (h.length !== expected.length) return false;
  return timingSafeEqual(h, expected);
}

export function validateCredentials(username, password) {
  const u = String(username || '').trim();
  const p = String(password || '');
  if (u.length < 3 || u.length > 64) {
    return 'Username must be 3–64 characters';
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(u)) {
    return 'Username may only contain letters, numbers, . _ -';
  }
  if (p.length < 6) return 'Password must be at least 6 characters';
  return null;
}

export async function createUser(username, password) {
  const key = userKey(username);
  const existing = await store.get(key);
  if (existing) throw new Error('username taken');

  const user = {
    id: randomUUID(),
    username: String(username).trim(),
    passwordHash: hashPassword(password),
    createdAt: Date.now(),
  };
  await store.set(key, user);
  await store.set(`userid:${user.id}`, { username: user.username });
  return { id: user.id, username: user.username };
}

export async function authenticateUser(username, password) {
  const user = await store.get(userKey(username));
  if (!user?.passwordHash) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return { id: user.id, username: user.username };
}
