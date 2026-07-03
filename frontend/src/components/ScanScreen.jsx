import { useCallback, useEffect, useRef, useState } from 'react';
import { compressImage } from '../compressImage';

function ScanDecor() {
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
        <ellipse cx="140" cy="232" rx="88" ry="14" fill="#c8b8e8" opacity="0.55" />

        <rect x="78" y="188" width="124" height="14" rx="4" fill="#6ec6ff" />
        <rect x="72" y="198" width="136" height="10" rx="3" fill="#4db0f0" />
        <circle cx="96" cy="214" r="10" fill="#3a3a4a" />
        <circle cx="96" cy="214" r="4" fill="#9aa0b0" />
        <circle cx="184" cy="214" r="10" fill="#3a3a4a" />
        <circle cx="184" cy="214" r="4" fill="#9aa0b0" />

        <rect x="96" y="148" width="52" height="40" rx="4" fill="#d4a574" />
        <rect x="96" y="148" width="52" height="10" rx="4" fill="#c49564" />
        <rect x="108" y="162" width="28" height="6" rx="2" fill="#fff" opacity="0.7" />

        <rect x="118" y="118" width="56" height="42" rx="4" fill="#e8b88a" />
        <rect x="118" y="118" width="56" height="10" rx="4" fill="#d4a574" />
        <rect x="130" y="134" width="32" height="6" rx="2" fill="#fff" opacity="0.7" />

        <rect x="140" y="88" width="50" height="40" rx="4" fill="#c49564" />
        <rect x="140" y="88" width="50" height="10" rx="4" fill="#b07f50" />
        <rect x="150" y="104" width="30" height="6" rx="2" fill="#fff" opacity="0.7" />
        <rect x="160" y="100" width="10" height="18" rx="2" fill="#ff6b6b" />
        <rect x="156" y="104" width="18" height="10" rx="2" fill="#ff6b6b" />

        <circle cx="70" cy="100" r="22" fill="#f5c6a0" />
        <path
          d="M50 96c2-18 16-28 32-24 4 10-2 22-10 26-8 2-18 2-22-2z"
          fill="#f0a050"
        />
        <path d="M48 98c-2 8 2 16 8 18" stroke="#f0a050" strokeWidth="8" strokeLinecap="round" />
        <circle cx="64" cy="100" r="2.2" fill="#3a3a4a" />
        <circle cx="78" cy="100" r="2.2" fill="#3a3a4a" />
        <path d="M66 108c2 3 8 3 10 0" stroke="#3a3a4a" strokeWidth="1.6" strokeLinecap="round" />
        <path
          d="M48 128c4-10 40-10 44 0l6 52c-8 8-48 8-56 0l6-52z"
          fill="#ffe066"
        />
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
        <path
          d="M52 145c-12 14-14 28-10 40"
          stroke="#f5c6a0"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path d="M54 178h16l2 36h-18z" fill="#9b7ed9" />
        <path d="M74 178h16l-2 36h-16z" fill="#8a6bc8" />
        <ellipse cx="55" cy="216" rx="12" ry="5" fill="#3a3a4a" />
        <ellipse cx="85" cy="216" rx="12" ry="5" fill="#3a3a4a" />
        <rect x="112" y="168" width="18" height="28" rx="3" fill="#2d3142" />
        <rect x="115" y="172" width="12" height="18" rx="1.5" fill="#7eb8ff" />
      </svg>
    </div>
  );
}

export default function ScanScreen({ onImageReady, registerTrigger, busy = false }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  useEffect(() => {
    registerTrigger?.(openPicker);
    return () => registerTrigger?.(null);
  }, [registerTrigger, openPicker]);

  async function onFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const blob = await compressImage(file);
      await onImageReady?.(blob);
    } catch (err) {
      setError(err.message || 'Scan failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="scan-screen">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={onFileChange}
      />

      <div className="scan-decor-card">
        <div className="scan-hero-content">
          <h2>Scan a product</h2>
          <p className="scan-hint">
            Photograph the product or ingredient list. If ingredients aren&apos;t
            visible, the agent looks them up online.
          </p>

          <button
            type="button"
            className="btn scan-btn"
            onClick={openPicker}
            disabled={uploading || busy}
          >
            {uploading || busy ? 'Uploading…' : '📷 Scan a product'}
            <span className="submit-arrow" aria-hidden>→</span>
          </button>

          {error && (
            <div className="error-banner">
              <span>{error}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={openPicker}>
                Retry
              </button>
            </div>
          )}
        </div>

        <div className="checkout-decor-col">
          <ScanDecor />
        </div>
      </div>

      <div className="how-it-works">
        <div className="how-card">
          <span className="how-num">1</span>
          <h3>Capture the label</h3>
          <p>Photograph the ingredients list so the agent can read it clearly.</p>
        </div>
        <div className="how-card">
          <span className="how-num">2</span>
          <h3>Watch the agent work</h3>
          <p>Live workflow steps stream in as vision, risk, and search run.</p>
        </div>
        <div className="how-card">
          <span className="how-num">3</span>
          <h3>Get your verdict</h3>
          <p>See SAFE, CAUTION, or AVOID with reasons and alternatives.</p>
        </div>
      </div>
    </div>
  );
}
