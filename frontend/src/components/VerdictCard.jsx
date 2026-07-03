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

const BANNER = {
  safe: { emoji: '🟢', label: 'SAFE' },
  caution: { emoji: '🟡', label: 'CAUTION' },
  avoid: { emoji: '🔴', label: 'AVOID' },
};

function formatConflict(conflict) {
  if (typeof conflict === 'string') return conflict;
  if (!conflict || typeof conflict !== 'object') return String(conflict);

  const ingredient =
    conflict.ingredient || conflict.item || conflict.substance || 'Unknown ingredient';
  const profileItem =
    conflict.conflictsWith ||
    conflict.profileItem ||
    conflict.profile_item ||
    conflict.condition ||
    conflict.allergy ||
    conflict.medication ||
    conflict.with;
  const why = conflict.why || conflict.reason || conflict.message;

  if (profileItem && why) {
    return `${ingredient} ↔ ${profileItem}: ${why}`;
  }
  if (profileItem) {
    return `${ingredient} conflicts with ${profileItem}`;
  }
  if (why) return `${ingredient}: ${why}`;
  return JSON.stringify(conflict);
}

function riskTone(score) {
  if (score >= 70) return 'avoid';
  if (score > 0) return 'caution';
  return 'safe';
}

export default function VerdictCard({ verdict, onScanAnother }) {
  const level = normalizeLevel(verdict);
  if (!level) return null;

  const banner = BANNER[level];
  const riskScore =
    typeof verdict?.riskScore === 'number'
      ? verdict.riskScore
      : Number(verdict?.riskScore) || 0;

  const reasons = Array.isArray(verdict?.reasons)
    ? verdict.reasons
    : Array.isArray(verdict?.why)
      ? verdict.why.filter((x) => typeof x === 'string')
      : [];

  const conflicts = Array.isArray(verdict?.conflicts) ? verdict.conflicts : [];

  const alternatives = Array.isArray(verdict?.alternatives)
    ? verdict.alternatives
    : [];

  return (
    <section className="verdict-card">
      <div className={`verdict-banner ${level}`}>
        {banner.emoji} {banner.label}
      </div>

      <div className={`risk-score-block ${riskTone(riskScore)}`}>
        <div className="risk-score-label">Risk score</div>
        <div className="risk-score-value">
          {riskScore}
          <span className="risk-score-max">/100</span>
        </div>
        <div className="risk-score-bar" aria-hidden>
          <div className="risk-score-fill" style={{ width: `${Math.min(100, riskScore)}%` }} />
        </div>
      </div>

      {verdict?.product && (
        <p className="verdict-product">
          Product: <strong>{verdict.product}</strong>
          {verdict.ingredientsSource && verdict.ingredientsSource !== 'label' && (
            <span className="muted"> (ingredients from {verdict.ingredientsSource})</span>
          )}
        </p>
      )}

      <div className="verdict-section">
        <h3>Why</h3>
        {reasons.length > 0 ? (
          <ul>
            {reasons.map((r, i) => (
              <li key={`r-${i}`}>{r}</li>
            ))}
          </ul>
        ) : conflicts.length === 0 ? (
          <p className="muted">No specific concerns for your profile.</p>
        ) : null}
        {conflicts.length > 0 && (
          <ul className="conflict-list">
            {conflicts.map((c, i) => (
              <li key={`c-${i}`}>{formatConflict(c)}</li>
            ))}
          </ul>
        )}
      </div>

      {alternatives.length > 0 && (
        <div className="verdict-section">
          <h3>Safer alternatives</h3>
          <div className="alt-chips">
            {alternatives.map((alt, i) => (
              <span
                key={i}
                className="alt-chip"
                title={typeof alt === 'object' ? alt.reason || '' : ''}
              >
                {typeof alt === 'string' ? alt : alt.name || alt.title || JSON.stringify(alt)}
              </span>
            ))}
          </div>
          <ul className="alt-reasons">
            {alternatives
              .filter((a) => a && typeof a === 'object' && a.reason)
              .map((alt, i) => (
                <li key={`ar-${i}`}>
                  <strong>{alt.name}</strong> — {alt.reason}
                </li>
              ))}
          </ul>
        </div>
      )}

      <p className="disclaimer">
        {verdict?.disclaimer ||
          'Informational only — confirm with your doctor or pharmacist.'}
      </p>

      <button type="button" className="btn btn-block" onClick={onScanAnother}>
        Scan another
      </button>
    </section>
  );
}
