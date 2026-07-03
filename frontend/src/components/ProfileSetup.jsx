import { useRef, useState } from 'react';
import { parseMedicalReport, saveProfile } from '../api';
import { compressImage } from '../compressImage';

const CONDITIONS = [
  'diabetes',
  'kidney disease',
  'pregnancy',
  'hypertension',
  'other',
];

function FormDecor() {
  return (
    <div className="form-decor" aria-hidden>
      <span className="spark spark-1" />
      <span className="spark spark-2" />
      <span className="spark spark-3" />
      <span className="spark spark-4" />
      <span className="spark spark-5" />
      <span className="spark spark-6" />

      <div className="decor-pin">
        <svg viewBox="0 0 48 48" width="48" height="48">
          <path
            d="M24 4c-7.2 0-13 5.8-13 13 0 9.8 13 27 13 27s13-17.2 13-27c0-7.2-5.8-13-13-13z"
            fill="#ff8fab"
          />
          <circle cx="24" cy="17" r="6" fill="#fff" />
          <path
            d="M24 13v8M20 17h8"
            stroke="#ff8fab"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <svg className="decor-scene" viewBox="0 0 280 260" fill="none">
        {/* ground shadow */}
        <ellipse cx="140" cy="232" rx="88" ry="14" fill="#c8b8e8" opacity="0.55" />

        {/* cart base */}
        <rect x="78" y="188" width="124" height="14" rx="4" fill="#6ec6ff" />
        <rect x="72" y="198" width="136" height="10" rx="3" fill="#4db0f0" />
        <circle cx="96" cy="214" r="10" fill="#3a3a4a" />
        <circle cx="96" cy="214" r="4" fill="#9aa0b0" />
        <circle cx="184" cy="214" r="10" fill="#3a3a4a" />
        <circle cx="184" cy="214" r="4" fill="#9aa0b0" />

        {/* medicine boxes */}
        <rect x="96" y="148" width="52" height="40" rx="4" fill="#d4a574" />
        <rect x="96" y="148" width="52" height="10" rx="4" fill="#c49564" />
        <rect x="108" y="162" width="28" height="6" rx="2" fill="#fff" opacity="0.7" />

        <rect x="118" y="118" width="56" height="42" rx="4" fill="#e8b88a" />
        <rect x="118" y="118" width="56" height="10" rx="4" fill="#d4a574" />
        <rect x="130" y="134" width="32" height="6" rx="2" fill="#fff" opacity="0.7" />

        <rect x="140" y="88" width="50" height="40" rx="4" fill="#c49564" />
        <rect x="140" y="88" width="50" height="10" rx="4" fill="#b07f50" />
        <rect x="150" y="104" width="30" height="6" rx="2" fill="#fff" opacity="0.7" />
        {/* medical cross on top box */}
        <rect x="160" y="100" width="10" height="18" rx="2" fill="#ff6b6b" />
        <rect x="156" y="104" width="18" height="10" rx="2" fill="#ff6b6b" />

        {/* character */}
        {/* head */}
        <circle cx="70" cy="100" r="22" fill="#f5c6a0" />
        {/* hair */}
        <path
          d="M50 96c2-18 16-28 32-24 4 10-2 22-10 26-8 2-18 2-22-2z"
          fill="#f0a050"
        />
        <path d="M48 98c-2 8 2 16 8 18" stroke="#f0a050" strokeWidth="8" strokeLinecap="round" />
        {/* face */}
        <circle cx="64" cy="100" r="2.2" fill="#3a3a4a" />
        <circle cx="78" cy="100" r="2.2" fill="#3a3a4a" />
        <path d="M66 108c2 3 8 3 10 0" stroke="#3a3a4a" strokeWidth="1.6" strokeLinecap="round" />
        {/* body / shirt */}
        <path
          d="M48 128c4-10 40-10 44 0l6 52c-8 8-48 8-56 0l6-52z"
          fill="#ffe066"
        />
        {/* arm leaning */}
        <path
          d="M90 140c18 8 28 24 30 40"
          stroke="#f5c6a0"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d="M90 140c18 8 28 24 30 40"
          stroke="#ffe066"
          strokeWidth="8"
          strokeLinecap="round"
        />
        {/* other arm */}
        <path
          d="M52 145c-12 14-14 28-10 40"
          stroke="#f5c6a0"
          strokeWidth="12"
          strokeLinecap="round"
        />
        {/* pants */}
        <path d="M54 178h16l2 36h-18z" fill="#9b7ed9" />
        <path d="M74 178h16l-2 36h-16z" fill="#8a6bc8" />
        {/* shoes */}
        <ellipse cx="55" cy="216" rx="12" ry="5" fill="#3a3a4a" />
        <ellipse cx="85" cy="216" rx="12" ry="5" fill="#3a3a4a" />
        {/* phone / scan device in hand */}
        <rect x="112" y="168" width="18" height="28" rx="3" fill="#2d3142" />
        <rect x="115" y="172" width="12" height="18" rx="1.5" fill="#7eb8ff" />
      </svg>
    </div>
  );
}

function mergeUnique(existing, incoming) {
  const out = [...existing];
  for (const item of incoming || []) {
    const v = String(item).trim();
    if (!v) continue;
    const lower = v.toLowerCase();
    if (!out.some((x) => x.toLowerCase() === lower)) out.push(v);
  }
  return out;
}

export default function ProfileSetup({ onSaved }) {
  const reportInputRef = useRef(null);
  const [allergies, setAllergies] = useState([]);
  const [allergyInput, setAllergyInput] = useState('');
  const [conditions, setConditions] = useState([]);
  const [medications, setMedications] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  const [parseNote, setParseNote] = useState(null);
  const [touched, setTouched] = useState({});

  function addAllergy(raw) {
    const value = raw.trim();
    if (!value) return;
    setAllergies((prev) =>
      prev.includes(value) ? prev : [...prev, value],
    );
    setAllergyInput('');
  }

  function onAllergyKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addAllergy(allergyInput.replace(/,/g, ''));
    } else if (e.key === 'Backspace' && !allergyInput && allergies.length) {
      setAllergies((prev) => prev.slice(0, -1));
    }
  }

  function toggleCondition(name) {
    setConditions((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name],
    );
    setTouched((t) => ({ ...t, conditions: true }));
  }

  async function onReportSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setParsing(true);
    setError(null);
    setParseNote(null);
    try {
      const blob = await compressImage(file);
      const parsed = await parseMedicalReport(blob, file.name || 'report.jpg');
      setAllergies((prev) => mergeUnique(prev, parsed.allergies));
      setConditions((prev) => {
        const next = [...prev];
        for (const raw of parsed.conditions || []) {
          const low = String(raw).toLowerCase();
          const match = CONDITIONS.find((k) => low.includes(k) || k.includes(low));
          if (match) {
            if (!next.includes(match)) next.push(match);
          } else if (!next.includes('other')) {
            next.push('other');
          }
        }
        return next;
      });
      if (Array.isArray(parsed.medications) && parsed.medications.length) {
        setMedications((prev) => {
          const existing = prev
            .split(/[,;\n]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          return mergeUnique(existing, parsed.medications).join(', ');
        });
      }
      setTouched({ allergies: true, conditions: true, medications: true });
      setParseNote(
        `Extracted ${parsed.allergies?.length || 0} allergies, ${parsed.conditions?.length || 0} conditions, ${parsed.medications?.length || 0} medications from your report. Review and save.`,
      );
    } catch (err) {
      setError(err.message || 'Could not parse medical report');
    } finally {
      setParsing(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!agreed) {
      setError('Please agree to the informational disclaimer to continue.');
      return;
    }

    setSaving(true);
    setError(null);

    const pending = allergyInput.trim();
    const finalAllergies = pending
      ? allergies.includes(pending)
        ? allergies
        : [...allergies, pending]
      : allergies;

    const profile = {
      allergies: finalAllergies,
      conditions,
      medications: medications.trim(),
    };

    try {
      const saved = await saveProfile(profile);
      onSaved(saved ?? profile);
    } catch (err) {
      setError(err.message || 'Could not save profile');
    } finally {
      setSaving(false);
    }
  }

  const allergiesValid = allergies.length > 0 || allergyInput.trim().length > 0;
  const medsValid = medications.trim().length > 0;
  const conditionsValid = conditions.length > 0;

  return (
    <div className="checkout-shell">
      <form className="checkout-card" onSubmit={handleSubmit}>
        <div className="checkout-form-col">
          <h2 className="checkout-title">Your profile</h2>

          <div className="report-upload-block">
            <input
              ref={reportInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={onReportSelected}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={parsing || saving}
              onClick={() => reportInputRef.current?.click()}
            >
              {parsing ? 'Reading report…' : '📄 Upload medical report'}
            </button>
            <p className="checkout-hint">
              Photo of an allergy list, clinic note, or discharge summary — we extract
              allergies, conditions, and meds with AI. You can still edit everything below.
            </p>
            {parseNote && <p className="parse-note">{parseNote}</p>}
          </div>

          <div className={`checkout-field ${touched.allergies && allergiesValid ? 'is-valid' : ''}`}>
            <label htmlFor="allergies">Allergies</label>
            <div className="chips">
              {allergies.map((a) => (
                <span key={a} className="chip">
                  {a}
                  <button
                    type="button"
                    aria-label={`Remove ${a}`}
                    onClick={() =>
                      setAllergies((prev) => prev.filter((x) => x !== a))
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="checkout-input-wrap">
              <input
                id="allergies"
                type="text"
                placeholder="For example, penicillin, peanuts"
                value={allergyInput}
                onChange={(e) => setAllergyInput(e.target.value)}
                onKeyDown={onAllergyKeyDown}
                onBlur={() => {
                  addAllergy(allergyInput);
                  setTouched((t) => ({ ...t, allergies: true }));
                }}
              />
              {touched.allergies && allergiesValid && (
                <span className="field-check" aria-hidden>✓</span>
              )}
            </div>
          </div>

          <div className={`checkout-field ${touched.conditions && conditionsValid ? 'is-valid' : ''}`}>
            <label>Conditions</label>
            <p className="checkout-hint">Which conditions apply to you?</p>
            <div className="checkout-options">
              {CONDITIONS.map((name) => (
                <label key={name} className="checkout-option">
                  <input
                    type="checkbox"
                    checked={conditions.includes(name)}
                    onChange={() => toggleCondition(name)}
                  />
                  <span className="option-radio" />
                  <span>{name.charAt(0).toUpperCase() + name.slice(1)}</span>
                </label>
              ))}
            </div>
          </div>

          <div className={`checkout-field ${touched.medications && medsValid ? 'is-valid' : ''}`}>
            <label htmlFor="medications">Current medications</label>
            <div className="checkout-input-wrap">
              <textarea
                id="medications"
                placeholder="For example, metformin, lisinopril"
                value={medications}
                onChange={(e) => setMedications(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, medications: true }))}
              />
              {touched.medications && medsValid && (
                <span className="field-check field-check-top" aria-hidden>✓</span>
              )}
            </div>
          </div>

          {error && <p className="checkout-error">{error}</p>}

          <div className="checkout-footer">
            <label className="checkout-agree">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>
                I agree this is{' '}
                <span className="checkout-link">informational only</span>
                {' '}— confirm with your doctor.
              </span>
            </label>
            <button type="submit" className="checkout-submit" disabled={saving}>
              {saving ? 'Saving…' : 'Continue'}
              <span className="submit-arrow" aria-hidden>→</span>
            </button>
          </div>
        </div>

        <div className="checkout-decor-col">
          <FormDecor />
        </div>
      </form>
    </div>
  );
}
