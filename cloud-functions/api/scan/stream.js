/**
 * GET /api/scan/stream?scanId=… — stream agent for a previously uploaded scan
 */

import { pendingScans } from '../../_lib/scans.js';
import { runScanAgent } from '../../_lib/agent.js';
import { sseResponse, jsonResponse, corsPreflight } from '../../_lib/sse.js';

export async function onRequestOptions() {
  return corsPreflight();
}

async function* unknownScan() {
  yield {
    step: 'error',
    status: 'error',
    summary: 'please re-upload',
    payload: {},
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const scanId = url.searchParams.get('scanId');
  if (!scanId) return jsonResponse({ error: 'scanId required' }, 400);

  const scan = pendingScans.get(scanId);
  if (!scan) {
    return sseResponse(unknownScan());
  }

  pendingScans.delete(scanId);
  return sseResponse(
    runScanAgent({
      userId: scan.userId,
      imageBase64: scan.imageBase64,
      mime: scan.mime,
      profile: scan.profile || null,
    }),
  );
}

export async function onRequest(context) {
  const method = context.request.method.toUpperCase();
  if (method === 'OPTIONS') return onRequestOptions();
  if (method === 'GET') return onRequestGet(context);
  return jsonResponse({ error: 'method not allowed' }, 405);
}
