import { RUNTIME_ENV } from './runtime-env.js';

export function env(name, fallback = '') {
  // Prefer non-empty process.env; empty strings from the platform must not
  // block RUNTIME_ENV (Makers may inject blank keys).
  const fromProcess = process.env[name];
  if (fromProcess != null && String(fromProcess).trim() !== '') {
    return String(fromProcess).trim();
  }
  const fromBundle = RUNTIME_ENV[name];
  if (fromBundle != null && String(fromBundle).trim() !== '') {
    return String(fromBundle).trim();
  }
  return String(fallback ?? '').trim();
}
