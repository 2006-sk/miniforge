/**
 * Start API (3000) + Vite frontend (5173) together.
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(name, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => {
    console.log(`[${name}] exited (${code})`);
    process.exit(code ?? 1);
  });
  return child;
}

const api = run('api', 'node', ['--env-file=.env', 'scripts/dev-server.js'], root);
// 0.0.0.0 so both http://127.0.0.1:5173 and http://localhost:5173 work
// (macOS often resolves "localhost" to IPv6 ::1 only).
const web = run('web', 'npm', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', '5173', '--strictPort'], resolve(root, 'frontend'));

function shutdown() {
  api.kill('SIGTERM');
  web.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
