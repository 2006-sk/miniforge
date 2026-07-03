/**
 * Smoke test: POST profile, POST scan?stream=1 with sample image, print SSE events.
 *
 * Place a label photo at test-assets/sample-label.jpg (see test-assets/README.md).
 * If missing, a tiny placeholder JPEG is used (vision will likely return readability=poor).
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const BASE = `http://localhost:${PORT}`;
const SAMPLE = resolve(ROOT, 'test-assets/sample-label.jpg');

// Minimal valid 1x1 JPEG
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=',
  'base64',
);

function ensureSample() {
  const dir = resolve(ROOT, 'test-assets');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(SAMPLE)) {
    writeFileSync(SAMPLE, TINY_JPEG);
    console.log('[smoke] wrote placeholder test-assets/sample-label.jpg (replace with a real label photo)');
  }
  return readFileSync(SAMPLE);
}

async function main() {
  ensureSample();
  const imageBuf = readFileSync(SAMPLE);
  const userId = 'smoke-user-1';

  console.log('[smoke] POST /api/profile');
  const profRes = await fetch(`${BASE}/api/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      allergies: ['peanuts', 'sulfites'],
      conditions: ['hypertension'],
      medications: ['lisinopril'],
    }),
  });
  console.log('  status', profRes.status, await profRes.json());

  console.log('[smoke] GET /api/profile');
  const getRes = await fetch(`${BASE}/api/profile?userId=${userId}`);
  console.log('  status', getRes.status, await getRes.json());

  console.log('[smoke] POST /api/scan?stream=1 (SSE)');
  const form = new FormData();
  form.append('userId', userId);
  form.append('image', new Blob([imageBuf], { type: 'image/jpeg' }), 'sample-label.jpg');

  const scanRes = await fetch(`${BASE}/api/scan?stream=1`, {
    method: 'POST',
    body: form,
  });
  console.log('  status', scanRes.status, scanRes.headers.get('content-type'));

  const text = await scanRes.text();
  const events = text
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => {
      try {
        return JSON.parse(chunk.slice(6));
      } catch {
        return { raw: chunk };
      }
    });

  for (const ev of events) {
    console.log('  SSE', JSON.stringify(ev));
  }

  console.log(`[smoke] done — ${events.length} event(s)`);
  if (!events.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[smoke] failed:', err);
  process.exitCode = 1;
});
