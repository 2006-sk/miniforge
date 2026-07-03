# MedScan — Frontend

Photo → personalized medical safety verdict, with a live agent-workflow viewer (Cursor-style step + JSON payload stream).

## Stack
- **Single React SPA** (Vite) — deployed on EdgeOne Makers Pages
- No UI library needed; plain CSS or Tailwind
- Talks to backend via `POST /api/scan` (multipart image) and listens on **SSE** stream `/api/scan/stream?scanId=...` for live agent events

## Pages / Components (only 4 — do not add more)

### 1. `ProfileSetup`
- Shown on first visit (check via `GET /api/profile` — backed by EdgeOne memory)
- Simple form: allergies (chips input), conditions (checkboxes: diabetes, kidney disease, pregnancy, hypertension, other), current medications (free text)
- `POST /api/profile` → stored in EdgeOne Makers built-in memory
- Keep it to ONE screen, < 6 fields

### 2. `ScanScreen`
- Big central button: **"📷 Scan a product"**
- `<input type="file" accept="image/*" capture="environment" hidden>` — on mobile this opens the camera directly; on laptop it opens file picker (both work for demo)
- On file select: compress client-side to ≤ 1024px wide (canvas.toBlob, quality 0.8) — cuts upload time and vision-token cost
- POST to `/api/scan`, receive `{ scanId }`, immediately open SSE connection

### 3. `AgentWorkflowPanel`  ← the "live fireup" (the demo centerpiece)
- Renders the SSE event stream as an animated vertical timeline
- Each event = one step card that appears with a slide-in + pulse animation while `status: "running"`, then settles to ✅ when `status: "done"`
- Step card layout:
  - Icon + step name (e.g. `🔍 vision.extract_label`)
  - One-line human summary (e.g. "Reading ingredient list from photo…")
  - **Collapsible `{ } JSON` toggle** — expands to show the raw event payload in a monospace `<pre>`, syntax-highlighted (just wrap keys/strings in colored spans, don't add a highlight library)
- Expected event sequence from backend:
  1. `profile.load` — payload: the stored medical profile
  2. `vision.extract_label` — payload: product name + extracted ingredients[]
  3. `risk.analyze` — payload: conflicts[] matched against profile
  4. `tool.web_search` — payload: Serper query + top results (may fire 1–2 times as the agent searches for alternatives; UI must handle 0..n occurrences of this step)
  5. `verdict.final` — payload: full verdict object
- Auto-scroll to newest step. This panel IS the wow factor — spend your polish minutes here.

### 4. `VerdictCard`
- Renders when `verdict.final` arrives
- Big color-coded banner: 🟢 SAFE / 🟡 CAUTION / 🔴 AVOID
- Sections: "Why" (bullet conflicts, each naming the ingredient + the profile item it conflicts with), "Alternatives" (2–3 chips), disclaimer line: *"Informational only — confirm with your doctor or pharmacist."*
- "Scan another" button resets to ScanScreen (profile persists via memory)

## SSE handling
```js
const es = new EventSource(`/api/scan/stream?scanId=${scanId}`);
es.onmessage = (e) => {
  const evt = JSON.parse(e.data); // { step, status, summary, payload, ts }
  upsertStep(evt);
  if (evt.step === "verdict.final") { setVerdict(evt.payload); es.close(); }
};
es.onerror = () => { es.close(); showRetry(); };
```

## State (useState only, no state library)
- `profile` | `scanId` | `steps: Map<stepName, event>` | `verdict` | `phase: "profile" | "scan" | "running" | "verdict"`

## Visual style
- Dark background, one accent color, monospace for JSON, generous animation on step arrival (this is what makes it look "alive" like the reference)
- Loading during vision call is COVERED by the workflow panel itself — the running steps ARE the loading state, so latency becomes theater

## Deploy
- `git push` → EdgeOne Makers auto-deploys (or `edgeone deploy` via CLI)
- Frontend and backend live in the SAME Makers project — API routes are same-origin, zero CORS config

## Local development
```bash
npm install
npm run dev
```
API calls use relative `/api/*` paths. Vite proxies them to `http://localhost:3000` (override with `VITE_API_PROXY`).

## Timebox (frontend total: ~30 min)
- 0–8 min: ProfileSetup + ScanScreen skeleton, deploy immediately (get live URL existing)
- 8–22 min: AgentWorkflowPanel + SSE wiring
- 22–30 min: VerdictCard + animations
- Cut first if behind: JSON syntax coloring → profile chips (use plain text input) → animations
