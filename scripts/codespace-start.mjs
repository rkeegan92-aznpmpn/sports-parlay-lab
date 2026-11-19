import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Inspect the forwarded port before spawning: Next must never silently choose 3001.
export async function previewState(port = 3000) {
  const listening = await new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
  });
  if (!listening) return 'stopped';
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(10000) });
    const health = await response.json();
    if (response.ok && health.database === 'ready' && typeof health.oddsApiKeyConfigured === 'boolean') return 'ready';
  } catch { /* An occupied or unhealthy port must not spawn a second server. */ }
  return 'occupied-or-unhealthy';
}

async function main() {
  const state = await previewState();
  if (state === 'ready') { console.log('NFL Parlay Lab is already ready on port 3000.'); return; }
  if (state !== 'stopped') throw new Error('Port 3000 is occupied or unhealthy. No process was killed and no second server was started. Inspect .codespace/app.log and the existing port owner.');
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  await mkdir(new URL('../.codespace/', import.meta.url), { recursive: true });
  const log = await open(new URL('../.codespace/app.log', import.meta.url), 'a', 0o600);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../nfl-parlay-lab/scripts/run-app.mjs', import.meta.url)), 'dev', '--hostname', '0.0.0.0', '--port', '3000'], {
    cwd: fileURLToPath(new URL('../nfl-parlay-lab/', import.meta.url)), env: { ...process.env }, detached: true, stdio: ['ignore', log.fd, log.fd],
  });
  let failure;
  child.on('error', () => { failure = 'Development server could not start.'; });
  child.on('exit', () => { failure = 'Development server exited before becoming ready.'; });
  child.unref();
  await log.close();
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (failure) throw new Error(`${failure} Inspect ${cwd}.codespace/app.log locally; do not share secrets.`);
    if (await previewState() === 'ready') { console.log('NFL Parlay Lab is ready on port 3000. The collector runs only while this Codespace is active.'); return; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Server readiness timed out. Inspect .codespace/app.log. No environment files or database settings were changed.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
