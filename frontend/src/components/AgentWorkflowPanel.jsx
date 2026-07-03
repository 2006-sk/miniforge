import { useEffect, useMemo, useRef, useState } from 'react';

const STEP_ICONS = {
  'profile.load': '👤',
  'vision.extract_label': '🔍',
  'ingredients.lookup': '🧪',
  'risk.analyze': '⚠️',
  'tool.web_search': '🌐',
  'verdict.final': '⚖️',
  error: '❌',
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Lightweight JSON syntax coloring — no highlight library. */
function highlightJson(value) {
  const json = JSON.stringify(value ?? null, null, 2);
  const escaped = escapeHtml(json);
  return escaped.replace(
    /("(?:\\.|[^"\\])*")\s*:|"((?:\\.|[^"\\])*)"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b/g,
    (match, key, str, num, bool, nul) => {
      if (key !== undefined) {
        return `<span class="json-key">${key}</span>:`;
      }
      if (str !== undefined) {
        return `<span class="json-string">"${str}"</span>`;
      }
      if (num !== undefined) {
        return `<span class="json-number">${num}</span>`;
      }
      if (bool !== undefined) {
        return `<span class="json-bool">${bool}</span>`;
      }
      if (nul !== undefined) {
        return `<span class="json-null">${nul}</span>`;
      }
      return match;
    },
  );
}

function StepCard({ event }) {
  const [open, setOpen] = useState(false);
  const icon = STEP_ICONS[event.step] || '⚙️';
  const running = event.status === 'running';
  const errored = event.status === 'error';

  return (
    <div className={`step-card ${running ? 'running' : errored ? 'error' : 'done'}`}>
      <div className="step-header">
        <span className="step-icon" aria-hidden>
          {icon}
        </span>
        <div className="step-meta">
          <div className="step-name">{event.step}</div>
          <div className="step-summary">
            {event.summary || (running ? 'Working…' : errored ? 'Error' : 'Done')}
          </div>
        </div>
        <span className="step-status" aria-label={event.status}>
          {running ? '…' : errored ? '❌' : '✅'}
        </span>
      </div>

      {event.payload !== undefined && (
        <>
          <button
            type="button"
            className={`json-toggle ${open ? 'open' : ''}`}
            onClick={() => setOpen((v) => !v)}
          >
            {'{ }'} JSON
          </button>
          {open && (
            <pre
              className="json-payload"
              dangerouslySetInnerHTML={{ __html: highlightJson(event.payload) }}
            />
          )}
        </>
      )}
    </div>
  );
}

export default function AgentWorkflowPanel({ steps, filter = '' }) {
  const endRef = useRef(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return steps;
    return steps.filter((evt) => {
      const hay = [
        evt.step,
        evt.summary,
        evt.status,
        evt.payload != null ? JSON.stringify(evt.payload) : '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [steps, filter]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [filtered]);

  return (
    <section className="workflow-panel" aria-live="polite">
      <h2>Agent workflow</h2>

      {steps.length === 0 ? (
        <div className="workflow-empty">Waiting for agent steps…</div>
      ) : filtered.length === 0 ? (
        <div className="workflow-empty">No steps match “{filter.trim()}”</div>
      ) : (
        <div className="timeline">
          {filtered.map((evt, i) => (
            <StepCard key={`${evt.step}-${evt._id ?? i}`} event={evt} />
          ))}
          <div ref={endRef} />
        </div>
      )}
    </section>
  );
}
