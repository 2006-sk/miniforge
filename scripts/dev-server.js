/**
 * Local Node harness that mounts the same Makers function handlers.
 * Deployed artifact remains pure cloud-functions/ — this file is local-only.
 */

import { createServer } from 'node:http';
import { Readable } from 'node:stream';

const PORT = Number(process.env.PORT || 3000);

const profile = await import('../cloud-functions/api/profile/index.js');
const parseReport = await import('../cloud-functions/api/profile/parse-report.js');
const scan = await import('../cloud-functions/api/scan/index.js');
const scanStream = await import('../cloud-functions/api/scan/stream.js');

function nodeToWebRequest(req, bodyBuf) {
  const host = req.headers.host || `localhost:${PORT}`;
  const url = `http://${host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  const init = { method: req.method, headers };
  if (bodyBuf && bodyBuf.length && req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = bodyBuf;
    init.duplex = 'half';
  }
  return new Request(url, init);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function matchHandler(pathname) {
  if (pathname === '/api/profile/parse-report') return parseReport;
  if (pathname === '/api/profile') return profile;
  if (pathname === '/api/scan') return scan;
  if (pathname === '/api/scan/stream') return scanStream;
  return null;
}

async function webToNode(webRes, res) {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!webRes.body) {
    res.end();
    return;
  }
  const nodeStream = Readable.fromWeb(webRes.body);
  nodeStream.pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const mod = matchHandler(url.pathname);
    if (!mod) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'not found', path: url.pathname }));
      return;
    }

    const bodyBuf = await readBody(req);
    const request = nodeToWebRequest(req, bodyBuf);
    const context = { request, params: {}, env: process.env };

    let webRes;
    const method = (req.method || 'GET').toUpperCase();
    if (method === 'OPTIONS' && mod.onRequestOptions) {
      webRes = await mod.onRequestOptions(context);
    } else if (method === 'GET' && mod.onRequestGet) {
      webRes = await mod.onRequestGet(context);
    } else if (method === 'POST' && mod.onRequestPost) {
      webRes = await mod.onRequestPost(context);
    } else if (mod.onRequest) {
      webRes = await mod.onRequest(context);
    } else {
      webRes = new Response(JSON.stringify({ error: 'method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await webToNode(webRes, res);
  } catch (err) {
    console.error('[dev-server]', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err?.message || 'internal error' }));
  }
});

server.listen(PORT, () => {
  console.log(`[medscan] local API on http://localhost:${PORT}`);
  console.log('  POST /api/profile');
  console.log('  GET  /api/profile?userId=…');
  console.log('  POST /api/profile/parse-report');
  console.log('  POST /api/scan?stream=1');
  console.log('  POST /api/scan  →  GET /api/scan/stream?scanId=…');
});
