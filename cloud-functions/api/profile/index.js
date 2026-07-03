/**
 * POST /api/profile  — save medical profile
 * GET  /api/profile?userId=… — load profile
 */

import { store } from '../../_lib/store.js';
import { jsonResponse, corsPreflight } from '../../_lib/sse.js';

export async function onRequestOptions() {
  return corsPreflight();
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: 'invalid json' }, 400);
  }

  const userId = body?.userId;
  if (!userId) return jsonResponse({ error: 'userId required' }, 400);

  const medications = Array.isArray(body.medications)
    ? body.medications.map(String)
    : typeof body.medications === 'string'
      ? body.medications
          .split(/[,;\n]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const profile = {
    userId: String(userId),
    allergies: Array.isArray(body.allergies) ? body.allergies.map(String) : [],
    conditions: Array.isArray(body.conditions) ? body.conditions.map(String) : [],
    medications,
  };

  await store.set(`profile:${profile.userId}`, profile);
  return jsonResponse({ ok: true, ...profile });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const userId = url.searchParams.get('userId');
  if (!userId) return jsonResponse({ error: 'userId required' }, 400);

  const profile = await store.get(`profile:${userId}`);
  if (!profile) return jsonResponse({ error: 'no profile' }, 404);
  return jsonResponse(profile);
}

export async function onRequest(context) {
  const method = context.request.method.toUpperCase();
  if (method === 'OPTIONS') return onRequestOptions();
  if (method === 'POST') return onRequestPost(context);
  if (method === 'GET') return onRequestGet(context);
  return jsonResponse({ error: 'method not allowed' }, 405);
}
