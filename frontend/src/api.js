/** Stable anonymous user id for profile + scan (backend requires userId). */
export function getUserId() {
  const KEY = 'medscan_userId';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `user-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'local-user';
  }
}

const PROFILE_KEY = 'medscan_profile';

export function cacheProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* ignore */
  }
}

export function readCachedProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function getProfile() {
  const cached = readCachedProfile();
  const userId = getUserId();
  try {
    const res = await fetch(`/api/profile?userId=${encodeURIComponent(userId)}`);
    if (res.status === 404) return cached;
    if (!res.ok) return cached;
    const data = await res.json();
    if (!data || data.error === 'no profile') return cached;
    const normalized = {
      userId,
      allergies: data.allergies || [],
      conditions: data.conditions || [],
      medications: Array.isArray(data.medications)
        ? data.medications.join(', ')
        : data.medications || '',
    };
    cacheProfile(normalized);
    return normalized;
  } catch {
    return cached;
  }
}

export async function saveProfile(profile) {
  const userId = getUserId();
  const body = {
    userId,
    allergies: Array.isArray(profile.allergies) ? profile.allergies : [],
    conditions: Array.isArray(profile.conditions) ? profile.conditions : [],
    medications:
      typeof profile.medications === 'string'
        ? profile.medications
        : Array.isArray(profile.medications)
          ? profile.medications.join(', ')
          : '',
  };

  const local = { ...body };
  cacheProfile(local);

  try {
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return local;
    const data = await res.json();
    const saved = {
      userId,
      allergies: data.allergies ?? body.allergies,
      conditions: data.conditions ?? body.conditions,
      medications: Array.isArray(data.medications)
        ? data.medications.join(', ')
        : body.medications,
    };
    cacheProfile(saved);
    return saved;
  } catch {
    return local;
  }
}

/** Upload a medical report photo; LLM extracts allergies / conditions / meds. */
export async function parseMedicalReport(imageBlob, filename = 'report.jpg') {
  const form = new FormData();
  form.append('report', imageBlob, filename);
  const res = await fetch('/api/profile/parse-report', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error || '';
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Failed to parse report (${res.status})`);
  }
  return res.json();
}

/**
 * Primary path: POST /api/scan?stream=1 and read SSE from the response body.
 * Keeps the whole agent on one serverless instance (no split-flow Map).
 */
export async function runScanStream(imageBlob, profile, { onEvent, signal } = {}) {
  const form = new FormData();
  form.append('userId', getUserId());
  form.append('image', imageBlob, 'scan.jpg');
  if (profile) {
    form.append(
      'profile',
      JSON.stringify({
        allergies: profile.allergies || [],
        conditions: profile.conditions || [],
        medications: profile.medications || '',
      }),
    );
  }

  const res = await fetch('/api/scan?stream=1', {
    method: 'POST',
    body: form,
    signal,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error || '';
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Failed to start scan (${res.status})`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response stream');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      const line = part
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        const evt = JSON.parse(line.slice(5).trim());
        onEvent?.(evt);
      } catch {
        /* ignore partial */
      }
    }
  }
}

/** @deprecated split-flow — kept for compatibility */
export async function startScan(imageBlob, filename = 'scan.jpg', profile = null) {
  const form = new FormData();
  form.append('userId', getUserId());
  form.append('image', imageBlob, filename);
  if (profile) form.append('profile', JSON.stringify(profile));
  const res = await fetch('/api/scan', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error || '';
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Failed to start scan (${res.status})`);
  }
  return res.json();
}

export function openScanStream(scanId, { onEvent, onError }) {
  const es = new EventSource(`/api/scan/stream?scanId=${encodeURIComponent(scanId)}`);
  es.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch (err) {
      console.error('Failed to parse SSE event', err);
    }
  };
  es.onerror = () => {
    onError?.(es);
  };
  return es;
}
