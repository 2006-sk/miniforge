import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const rootEl = document.getElementById('root');

function showBootError(err) {
  const el = document.getElementById('boot-error');
  if (el) {
    el.style.display = 'block';
    el.textContent =
      'Failed to start MedScan:\n' +
      (err && err.stack ? err.stack : String(err));
  }
  if (rootEl) {
    rootEl.innerHTML =
      '<p id="boot-status" style="padding:24px;color:#ffb4b4">MedScan failed to start. See error below.</p>';
  }
  console.error(err);
}

try {
  if (!rootEl) throw new Error('#root element missing');
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (err) {
  showBootError(err);
}
