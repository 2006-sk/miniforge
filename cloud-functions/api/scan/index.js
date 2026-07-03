/**
 * POST /api/scan?stream=1  — run full agent, stream SSE
 * POST /api/scan           — store upload, return { scanId }
 */

import { randomUUID } from 'node:crypto';
import { readScanForm } from '../../_lib/multipart.js';
import { runScanAgent } from '../../_lib/agent.js';
import { pendingScans } from '../../_lib/scans.js';
import { sseResponse, jsonResponse, corsPreflight } from '../../_lib/sse.js';

export async function onRequestOptions() {
  return corsPreflight();
}

export async function onRequestPost(context) {
  const url = new URL(context.request.url);
  const stream = url.searchParams.get('stream');

  let form;
  try {
    form = await readScanForm(context.request);
  } catch (err) {
    return jsonResponse({ error: err?.message || 'bad request' }, 400);
  }

  if (stream === '1' || stream === 'true') {
    return sseResponse(runScanAgent(form));
  }

  const scanId = randomUUID();
  pendingScans.set(scanId, {
    userId: form.userId,
    imageBase64: form.imageBase64,
    mime: form.mime,
    profile: form.profile || null,
    createdAt: Date.now(),
  });

  // Expire after 10 minutes
  setTimeout(() => pendingScans.delete(scanId), 10 * 60 * 1000).unref?.();

  return jsonResponse({ scanId });
}

export async function onRequest(context) {
  const method = context.request.method.toUpperCase();
  if (method === 'OPTIONS') return onRequestOptions();
  if (method === 'POST') return onRequestPost(context);
  return jsonResponse({ error: 'method not allowed' }, 405);
}
