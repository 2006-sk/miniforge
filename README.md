# MedScan — Backend

Hackathon backend for **MedScan**: store a medical profile once, photograph any product (food / cosmetic / medicine), and an agent **reads the label from the image with a vision model**, checks it against the profile, live-searches safer alternatives, and streams every step as SSE.

> **Important:** Analysis is **vision-based on the uploaded photo**, not a file parser for `sample-label.jpg`. That file is only a local test fixture. Any JPEG/PNG the client uploads is sent as base64 to Nebius `Qwen/Qwen2.5-VL-72B-Instruct`, which identifies the product and transcribes ingredients. There is no OCR library, no special-case path for the sample asset, and no hardcoded product data.

Frontend SPA is built separately — this repo’s backend only.

---

## How it works

```
Client uploads product photo + userId
        │
        ▼
 profile.load     → load allergies / conditions / medications from store
        │
        ▼
 vision.extract_label  → vision model looks at the image pixels
        │                 (product name always; ingredients only if visible)
        │
        ├─ ingredients visible on photo ─────────────────────┐
        │                                                    │
        └─ ingredients NOT visible                           │
              ▼                                              │
         ingredients.lookup                                  │
              → SerpApi: "<product> ingredients list"        │
              → text model extracts ingredients from results │
              → (fallback: model knowledge if search fails)  │
                                                    │        │
                                                    ▼        ▼
 risk.analyze     → text model compares ingredients vs profile
        │
        ▼
 tool.web_search  → agentic SerpApi search for safer alternatives
        │
        ▼
 verdict.final    → SAFE | CAUTION | AVOID + alternatives + disclaimer
                    (includes ingredientsSource: "label" | "web" | "model")
```

Each agent step emits **two** SSE events (`running` then `done`), except errors which end the stream.

---

## Project layout

```
mini-forge/
├── cloud-functions/              # EdgeOne Makers Cloud Functions (deployable)
│   ├── api/
│   │   ├── profile.js            # POST/GET /api/profile
│   │   └── scan/
│   │       ├── index.js          # POST /api/scan[?stream=1]
│   │       └── stream.js         # GET  /api/scan/stream?scanId=
│   └── _lib/                     # shared modules (not routes)
│       ├── agent.js              # async generator: full scan agent
│       ├── llm.js                # gateway + Nebius routing, JSON retry
│       ├── store.js              # Blob / local-json profile storage
│       ├── multipart.js          # image + userId form parsing
│       ├── scans.js              # in-memory Map for split-flow scanIds
│       └── sse.js                # SSE + JSON response helpers
├── scripts/
│   ├── dev-server.js             # local Node harness (same handlers)
│   ├── smoke.js                  # quick profile + SSE smoke test
│   └── check-nebius.js           # list Nebius models
├── test-assets/
│   ├── sample-label.jpg          # test photo only (not special-cased)
│   ├── e2e-results.json          # last E2E capture
│   └── README.md
├── .env.example
├── package.json
└── README.md
```

Deployed artifact = `cloud-functions/` only. `scripts/dev-server.js` is local-only.

---

## Routes

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/api/profile` | JSON `{ userId, allergies[], conditions[], medications[] }` | `{ ok: true }` |
| `GET` | `/api/profile?userId=` | — | profile JSON, or `404 { error: "no profile" }` |
| `POST` | `/api/scan?stream=1` | multipart: `image` file + `userId` | **SSE stream** (primary path) |
| `POST` | `/api/scan` | multipart: `image` file + `userId` | `{ scanId }` (split flow) |
| `GET` | `/api/scan/stream?scanId=` | — | **SSE stream** for prior upload; unknown id → error `"please re-upload"` |

CORS: `Access-Control-Allow-Origin: *` on all responses. `OPTIONS` preflight supported.

### Handler files (Makers file-based routing)

| File | Route |
|------|-------|
| `cloud-functions/api/profile.js` | `/api/profile` |
| `cloud-functions/api/scan/index.js` | `/api/scan` |
| `cloud-functions/api/scan/stream.js` | `/api/scan/stream` |

Exports: `onRequest`, `onRequestGet`, `onRequestPost`, `onRequestOptions` (EdgeOne Makers Node Cloud Functions convention).

---

## Shared modules (`cloud-functions/_lib/`)

### `agent.js` — `runScanAgent({ userId, imageBase64, mime })`

Async generator used by both streaming paths.

| Step | What it does |
|------|----------------|
| `profile.load` | `store.get("profile:"+userId)`; missing → empty profile, summary *"No profile found — generic analysis"* |
| `vision.extract_label` | **Vision model on image bytes**. Always identifies product/brand. Transcribes ingredients only when visible. Empty ingredients is OK if product is known. Unrecognizable product → error *"Product not recognizable…"* |
| `ingredients.lookup` | **Only when ingredients were not on the photo.** SerpApi search `"<product> ingredients list"`, then text model extracts ingredients. Payload includes `source: "web"` (or `"model"` fallback). Fails only if product ingredients cannot be found at all |
| `risk.analyze` | Text model: conflicts must cite specific profile items. JSON: `{ conflicts: [{ ingredient, conflictsWith, severity, why }] }` |
| `tool.web_search` | Text model with `web_search` tool (max 2 iterations). Tool → SerpApi Google search. Failure / no conflicts → model-knowledge alternatives |
| `verdict.final` | `AVOID` if any high severity; `CAUTION` if any conflict; `SAFE` only with zero conflicts. Includes alternatives + medical disclaimer |

### `llm.js` — `llmCall` / `llmJson`

| Path | When | `via` in SSE |
|------|------|----------------|
| Nebius Token Factory | Vision always; text when no Makers key or gateway fails | `"nebius"` |
| EdgeOne model gateway | Text when `MAKERS_MODELS_KEY` set | `"edgeone-gateway"` |

- Base URLs: `https://api.tokenfactory.nebius.com/v1`, `https://ai-gateway.edgeone.link/v1`
- Default vision: `Qwen/Qwen2.5-VL-72B-Instruct`
- Default Nebius text (when `TEXT_MODEL` is a Claude id): `meta-llama/Llama-3.3-70B-Instruct`
- JSON reliability: strip \`\`\`json fences, `JSON.parse`, **one** retry on invalid JSON

No Anthropic dependency.

### `store.js` — `store.get(key)` / `store.set(key, val)`

| Environment | Backend |
|-------------|---------|
| EdgeOne Makers (deployed) | Blob via `@edgeone/pages-blob` (`getStore("medscan")`) |
| Local dev | `./local-store.json` (loud console log on first use) |

Profile key: `profile:<userId>`.

### `multipart.js`

Reads multipart `image` + `userId`, or JSON `{ userId, imageBase64, mime }` for easy local testing. Image → base64 for the vision call.

### `scans.js`

Module-level `Map` for split-flow uploads (`scanId` → image payload), 10-minute TTL.

### `sse.js`

Frozen SSE shape:

```text
data: {"step":"...","status":"running"|"done"|"error","summary":"...","payload":{...},"ts":<epoch ms>}

```

---

## Environment

Copy `.env.example` → `.env`:

| Variable | Purpose |
|----------|---------|
| `NEBIUS_API_KEY` | Nebius Token Factory (vision + text fallback) |
| `SERPAPI_API_KEY` or `SERPER_API_KEY` | SerpApi key (`serpapi.com` — not serper.dev) |
| `MAKERS_MODELS_KEY` | Optional EdgeOne gateway for text |
| `TEXT_MODEL` | Gateway-first text id (Claude ids map to Nebius text on fallback) |
| `NEBIUS_TEXT_MODEL` | Nebius text model when mapping Claude ids |
| `VISION_MODEL` | Vision model id (default Qwen2.5-VL-72B) |
| `PORT` | Local harness port (default `3000`) |

---

## Local run (frontend + backend)

Frontend lives in [`frontend/`](./frontend) (from [2006-sk/miniforge](https://github.com/2006-sk/miniforge)), integrated with this API.

```bash
npm install          # also installs frontend deps
# fill .env (NEBIUS_API_KEY, SERPAPI_API_KEY / SERPER_API_KEY)

npm run dev          # API :3000 + Vite UI :5173
```

| URL | What |
|-----|------|
| http://127.0.0.1:5173/ | **MedScan UI** (use this in the browser) |
| http://localhost:3000/ | API only |

Vite proxies `/api/*` → `http://localhost:3000` (including SSE).

```bash
npm run dev:api      # API only
npm run dev:web      # frontend only (needs API on :3000)
```

### Integration notes

- Frontend stores a stable `userId` in `localStorage` and sends it on profile + scan (backend requires `userId`).
- Scan uses split flow: `POST /api/scan` → `{ scanId }` → `EventSource /api/scan/stream?scanId=…`.
- Workflow panel shows all agent steps, including `ingredients.lookup` when the label isn’t on the photo.
- Medications may be a string in the form and an array in the API; both sides normalize.

### Curl examples

```bash
# Profile
curl -s -X POST http://localhost:3000/api/profile \
  -H 'Content-Type: application/json' \
  -d '{"userId":"u1","allergies":["peanuts","sulfites"],"conditions":["hypertension"],"medications":["lisinopril"]}'

curl -s 'http://localhost:3000/api/profile?userId=u1'

# Primary path — photograph any product (any image file)
curl -sN -X POST 'http://localhost:3000/api/scan?stream=1' \
  -F 'userId=u1' \
  -F 'image=@/path/to/your/product-photo.jpg;type=image/jpeg'

# Split flow
curl -s -X POST 'http://localhost:3000/api/scan' \
  -F 'userId=u1' \
  -F 'image=@/path/to/your/product-photo.jpg;type=image/jpeg'
# → {"scanId":"..."}
curl -sN 'http://localhost:3000/api/scan/stream?scanId=<scanId>'

# Smoke (uses test-assets/sample-label.jpg as a stand-in photo)
npm run smoke
```

Use a **real, well-lit, close-up product label photo** for demos. Blurry or distant shots return `vision.extract_label` error: *"Label unclear — retake the photo closer and well-lit"*.

---

## End-to-end test results (local, 2026-07-03)

Ran against `http://localhost:3000` with:

- **Storage:** `local-json` (`./local-store.json`)
- **Vision / text:** Nebius (`via: "nebius"`)
- **Search:** SerpApi (`via: "serpapi"`)
- **Input image:** generated label photo (pixels only — still analyzed by vision, not parsed as a known file)

### Profile

| Call | Result |
|------|--------|
| `POST /api/profile` | `200 { ok: true }` |
| `GET /api/profile?userId=e2e-user-1` | `200` full profile (peanuts, sulfites, hypertension, lisinopril) |
| `GET` missing user | `404 { error: "no profile" }` |

### Primary scan (`POST /api/scan?stream=1`)

- **Duration:** ~24s
- **Events:** 10 (each step `running` → `done`)
- **Pipeline:**

```
profile.load:running → profile.load:done
vision.extract_label:running → vision.extract_label:done   (via: nebius)
risk.analyze:running → risk.analyze:done                   (via: nebius)
tool.web_search:running → tool.web_search:done             (via: serpapi)
verdict.final:running → verdict.final:done
```

| Step | Outcome |
|------|---------|
| Vision | Product **NATURE CRUNCH GRANOLA BAR**, category `food`, `readability: "good"`, ingredients including peanut butter / peanuts / sulfites |
| Risk | **3 high conflicts** (peanuts ×2, sulfites) cited against profile allergies |
| Search | Query `granola bars without peanut butter, peanuts, sulfites` → **8** organic results |
| Verdict | **`AVOID`** + 3 alternatives (e.g. Nut Free Granola Bars, Nature Valley Mixed Berry Peanut Free, Oat Haus Granola) + disclaimer |

### Split flow

| Call | Result |
|------|--------|
| `POST /api/scan` | `200 { scanId }` |
| `GET /api/scan/stream?scanId=…` | Same 10-step pipeline, verdict **AVOID** |
| Unknown `scanId` | SSE `{ step: "error", summary: "please re-upload" }` |

Raw capture: `test-assets/e2e-results.json`.

### Front-of-pack only (no ingredient list on photo)

Photo: `test-assets/front-only.jpg` — brand/product name only, **no ingredients text**.

| Step | Outcome |
|------|---------|
| Vision | Identified **Nature Valley Crunchy Granola Bars Oats 'n Honey**, `ingredientsSource: "none"` |
| `ingredients.lookup` | SerpApi query `… ingredients list` → **10 ingredients** from the web (`source: "web"`) |
| Risk | 1 conflict (soy lecithin vs soy allergy) |
| Alternatives | SerpApi search for soy-free granola bars |
| Verdict | **`AVOID`**, `ingredientsSource: "web"` |

Pipeline:

```
profile.load → vision.extract_label → ingredients.lookup → risk.analyze → tool.web_search → verdict.final
```

Raw capture: `test-assets/e2e-front-only-results.json`.

### Integration status

| Integration | Status |
|-------------|--------|
| Nebius text (`Llama-3.3-70B-Instruct`) | OK |
| Nebius vision (`Qwen/Qwen2.5-VL-72B-Instruct`) | OK — reads label from image |
| SerpApi web search | OK |
| EdgeOne Blob storage | Falls back to local-json in dev; Blob on deploy |
| EdgeOne model gateway | Not keyed in this run (`MAKERS_MODELS_KEY` empty) |
| Anthropic | Not used |

---

## Deploy notes (manual)

1. Push / deploy as an EdgeOne Makers project (`cloud-functions/` routes auto-map).
2. Set env vars in the Makers console (`NEBIUS_API_KEY`, `SERPAPI_API_KEY`, optional `MAKERS_MODELS_KEY`).
3. First live check: `POST` / `GET` `/api/profile` (proves Blob storage).
4. Then a real product photo through `/api/scan?stream=1`.

Do not commit `.env` or `local-store.json`.

---

## Disclaimer

MedScan output is **informational only**. Users must confirm with a doctor or pharmacist. Not medical advice.
