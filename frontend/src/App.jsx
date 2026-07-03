import { useCallback, useEffect, useRef, useState } from 'react';
import { getProfile, readCachedProfile, runScanStream } from './api';
import ProfileSetup from './components/ProfileSetup';
import ScanScreen from './components/ScanScreen';
import AgentWorkflowPanel from './components/AgentWorkflowPanel';
import VerdictCard from './components/VerdictCard';

let stepSeq = 0;

/** Upsert step events: update last running match, else append (supports 0..n web_search). */
export function upsertStep(steps, evt) {
  const next = [...steps];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].step === evt.step) {
      if (next[i].status === 'running') {
        next[i] = { ...next[i], ...evt };
        return next;
      }
      break;
    }
  }
  next.push({ ...evt, _id: ++stepSeq });
  return next;
}

function normalizeLevel(verdict) {
  if (!verdict || typeof verdict !== 'object') return null;
  const raw = (
    verdict.level ||
    verdict.status ||
    verdict.verdict ||
    ''
  )
    .toString()
    .toLowerCase()
    .trim();

  if (!raw) return null;
  if (raw.includes('safe') || raw === 'green') return 'safe';
  if (raw.includes('avoid') || raw.includes('danger') || raw === 'red') return 'avoid';
  if (raw.includes('caution') || raw.includes('warn') || raw === 'yellow') return 'caution';
  return null;
}

const LEVEL_LABEL = {
  safe: 'SAFE',
  caution: 'CAUTION',
  avoid: 'AVOID',
};

function profileInitials(profile) {
  if (!profile) return '?';
  const meds = medsDisplay(profile);
  if (meds) return meds.slice(0, 2).toUpperCase();
  if (profile.allergies?.length) return profile.allergies[0].slice(0, 2).toUpperCase();
  return 'MS';
}

function medsList(profile) {
  if (!profile?.medications) return [];
  if (Array.isArray(profile.medications)) {
    return profile.medications.map(String).map((s) => s.trim()).filter(Boolean);
  }
  return String(profile.medications)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function medsCount(profile) {
  return medsList(profile).length;
}

function medsDisplay(profile) {
  return medsList(profile).join(', ');
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2Zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function App() {
  const [profile, setProfile] = useState(null);
  const [steps, setSteps] = useState([]);
  const [verdict, setVerdict] = useState(null);
  const [phase, setPhase] = useState('boot'); // boot | profile | scan | running | verdict
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const abortRef = useRef(null);
  const scanTriggerRef = useRef(null);
  const pendingScanOpenRef = useRef(false);

  const registerScanTrigger = useCallback((fn) => {
    scanTriggerRef.current = fn;
    if (fn && pendingScanOpenRef.current) {
      pendingScanOpenRef.current = false;
      fn();
    }
  }, []);

  const closeStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const cached = readCachedProfile();
        if (cached && !cancelled) {
          setProfile(cached);
          setPhase('scan');
        }
        const p = await getProfile();
        if (cancelled) return;
        if (p) {
          setProfile(p);
          setPhase('scan');
        } else if (!cached) {
          setPhase('profile');
        }
      } catch {
        if (!cancelled) {
          const cached = readCachedProfile();
          if (cached) {
            setProfile(cached);
            setPhase('scan');
          } else {
            setPhase('profile');
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      closeStream();
    };
  }, [closeStream]);

  function handleProfileSaved(p) {
    setProfile(p);
    setPhase('scan');
  }

  async function handleImageReady(blob) {
    closeStream();
    const ac = new AbortController();
    abortRef.current = ac;

    setSteps([]);
    setVerdict(null);
    setError(null);
    setSearchQuery('');
    setPhase('running');

    try {
      await runScanStream(blob, profile, {
        signal: ac.signal,
        onEvent: (evt) => {
          setSteps((prev) => upsertStep(prev, evt));
          if (evt.status === 'error') {
            setError(evt.summary || 'Agent error');
            return;
          }
          if (evt.step === 'verdict.final' && evt.status === 'done') {
            setVerdict(evt.payload);
            setPhase('verdict');
          }
        },
      });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setError(err?.message || 'stream');
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }

  function handleScanAnother() {
    closeStream();
    setSteps([]);
    setVerdict(null);
    setError(null);
    setSearchQuery('');
    setPhase('scan');
  }

  function goToScan() {
    if (phase === 'profile' || phase === 'boot') return;
    if (phase === 'running' || phase === 'verdict') {
      handleScanAnother();
    } else {
      setPhase('scan');
    }
  }

  function triggerScan() {
    if (phase === 'profile' || phase === 'boot') return;
    if (phase === 'running') return;
    if (phase === 'verdict') {
      pendingScanOpenRef.current = true;
      handleScanAnother();
      return;
    }
    scanTriggerRef.current?.();
  }

  const activeTab =
    phase === 'profile'
      ? 'profile'
      : phase === 'running'
        ? 'workflow'
        : phase === 'verdict'
          ? 'verdict'
          : 'overview';

  const navActive =
    phase === 'profile' ? 'profile' : phase === 'boot' ? 'scan' : 'scan';

  const level = normalizeLevel(verdict);
  const allergyCount = profile?.allergies?.length ?? 0;
  const conditionCount = profile?.conditions?.length ?? 0;
  const medicationCount = medsCount(profile);

  return (
    <div className="app">
      <header className="top-nav">
        <div className="nav-left">
          <div className="logo-mark" aria-hidden />
          <nav aria-label="Primary">
            <ul className="nav-links">
              <li>
                <button
                  type="button"
                  className={navActive === 'scan' ? 'active' : ''}
                  onClick={goToScan}
                >
                  Scan
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={navActive === 'profile' ? 'active' : ''}
                  onClick={() => {
                    if (phase === 'boot') return;
                    if (!profile) setPhase('profile');
                  }}
                >
                  Profile
                </button>
              </li>
              <li>
                <button type="button" title="Informational only — confirm with your doctor">
                  Help
                </button>
              </li>
            </ul>
          </nav>
          <label className="nav-search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search steps…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={phase !== 'running' && phase !== 'verdict'}
              aria-label="Search workflow steps"
            />
          </label>
        </div>

        <div className="nav-right">
          <div className="nav-bell" aria-label="Notifications">
            <BellIcon />
            {(phase === 'running' || error) && <span className="badge-dot" />}
          </div>
          <div className="nav-profile-chip">
            <div className="chip-text">
              <div className="chip-name">{profile ? 'Your profile' : 'Guest'}</div>
              <div className="chip-role">{profile ? 'MedScan user' : 'Setup required'}</div>
            </div>
            <div className="avatar" aria-hidden>
              {profileInitials(profile)}
            </div>
          </div>
        </div>
      </header>

      <div className="app-body">
        <main className="main-column">
          <div className="main-header">
            <h1>MedScan Dashboard</h1>
            <div className="main-header-actions">
              {phase === 'verdict' && (
                <button type="button" className="btn btn-sm" onClick={handleScanAnother}>
                  Scan another
                </button>
              )}
              {(phase === 'scan' || phase === 'verdict') && (
                <button type="button" className="btn btn-sm btn-secondary" onClick={triggerScan}>
                  Scan product
                </button>
              )}
            </div>
          </div>

          <div className="phase-tabs" aria-label="Dashboard sections">
            <span className={activeTab === 'overview' || activeTab === 'profile' ? 'active' : ''}>
              {phase === 'profile' ? 'Profile' : 'Overview'}
            </span>
            <span className={activeTab === 'workflow' ? 'active' : ''}>Workflow</span>
            <span className={activeTab === 'verdict' ? 'active' : ''}>Verdict</span>
          </div>

          {error && (
            <div className="error-banner">
              <span>
                {error === 'stream'
                  ? 'Connection lost. Agent stream interrupted.'
                  : error}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleScanAnother}
              >
                Scan again
              </button>
            </div>
          )}

          <div className="main-content">
            {phase === 'boot' && (
              <p className="boot-status">Loading profile…</p>
            )}

            {phase === 'profile' && (
              <ProfileSetup onSaved={handleProfileSaved} />
            )}

            {phase === 'scan' && (
              <ScanScreen
                onImageReady={handleImageReady}
                registerTrigger={registerScanTrigger}
              />
            )}

            {(phase === 'running' || phase === 'verdict') && (
              <div className={`running-layout ${phase === 'verdict' && verdict ? 'has-verdict' : ''}`}>
                <AgentWorkflowPanel steps={steps} filter={searchQuery} />
                {phase === 'verdict' && verdict && (
                  <VerdictCard verdict={verdict} onScanAnother={handleScanAnother} />
                )}
              </div>
            )}
          </div>
        </main>

        <aside className="sidebar">
          {profile ? (
            <>
              <div className="sidebar-profile">
                <div className="profile-name">Medical profile</div>
                <div className="verified-badge">
                  <span className="check" aria-hidden>✓</span>
                  Profile on file
                </div>
                <div className="sidebar-stats">
                  <div className="stat">
                    <span className="stat-value">{allergyCount}</span>
                    <span className="stat-label">Allergies</span>
                  </div>
                  <div className="stat">
                    <span className="stat-value">{conditionCount}</span>
                    <span className="stat-label">Conditions</span>
                  </div>
                  <div className="stat">
                    <span className="stat-value">{medicationCount}</span>
                    <span className="stat-label">Meds</span>
                  </div>
                </div>
              </div>

              <div className="sidebar-card">
                <h3>Profile details</h3>
                <div className="card-balance">{allergyCount + conditionCount + medicationCount}</div>
                <div className="card-meta">Items on file</div>
                <ul className="card-meta-list">
                  {profile.allergies?.length > 0 && (
                    <li>
                      <strong>Allergies:</strong> {profile.allergies.join(', ')}
                    </li>
                  )}
                  {profile.conditions?.length > 0 && (
                    <li>
                      <strong>Conditions:</strong> {profile.conditions.join(', ')}
                    </li>
                  )}
                  {medsDisplay(profile) && (
                    <li>
                      <strong>Meds:</strong> {medsDisplay(profile)}
                    </li>
                  )}
                  {!allergyCount && !conditionCount && !medicationCount && (
                    <li>No details recorded yet</li>
                  )}
                </ul>
              </div>

              <div className="sidebar-card">
                <h3>Latest verdict</h3>
                {level ? (
                  <>
                    <span className={`verdict-pill ${level}`}>{LEVEL_LABEL[level]}</span>
                    {typeof verdict?.riskScore === 'number' && (
                      <div className="card-balance" style={{ fontSize: '1.25rem', marginTop: 10 }}>
                        Risk {verdict.riskScore}/100
                      </div>
                    )}
                    <p className="card-meta" style={{ marginTop: 12 }}>
                      From your most recent scan
                    </p>
                  </>
                ) : (
                  <p className="card-meta">Scan a product to see your safety verdict here.</p>
                )}
              </div>

              {(phase === 'scan' || phase === 'verdict') && (
                <div className="sidebar-card">
                  <h3>Quick action</h3>
                  <button type="button" className="btn btn-block" onClick={triggerScan}>
                    Scan a product
                  </button>
                </div>
              )}

              {phase === 'running' && (
                <div className="sidebar-card">
                  <h3>Status</h3>
                  <div className="card-balance" style={{ fontSize: '1.1rem' }}>
                    Analyzing…
                  </div>
                  <p className="card-meta">{steps.length} agent step{steps.length === 1 ? '' : 's'}</p>
                </div>
              )}
            </>
          ) : (
            <div className="sidebar-card sidebar-setup-prompt">
              <div className="avatar lg" style={{ margin: '0 auto 12px' }} aria-hidden>
                ?
              </div>
              <p>Complete your medical profile to personalize safety checks.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
