import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const mode = process.argv[2];
if (!['dev', 'start'].includes(mode)) throw new Error('Expected dev or start.');
const cwd = fileURLToPath(new URL('../', import.meta.url));
const { loadEnvConfig } = createRequire(import.meta.url)('@next/env');
loadEnvConfig(cwd, mode === 'dev'); // Match Next's env-file priority without overwriting existing bindings.
const env = { ...process.env, NODE_ENV: process.env.NODE_ENV || (mode === 'dev' ? 'development' : 'production') };
const app = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)), mode, ...process.argv.slice(3)], { cwd, env, stdio: 'inherit' });
let collector = null, restart = null, closing = false;
function startCollector() {
  if (closing || process.env.COLLECTOR_ENABLED === '0') return;
  collector = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('./track-forecasts.ts', import.meta.url)), '--watch'], { cwd, env, stdio: 'inherit' });
  collector.on('error', () => console.error('Collector failed to start. Dashboard heartbeat will show stopped.'));
  collector.on('exit', () => {
    if (!closing) restart = setTimeout(startCollector, 30000); // A DB lease prevents duplicate workers, including manual collectors.
  });
}
function stop(signal = 'SIGTERM') {
  if (closing) return; closing = true;
  clearTimeout(restart); collector?.kill(signal); app.kill(signal);
  const timeout = setTimeout(() => { collector?.kill('SIGKILL'); app.kill('SIGKILL'); process.exit(1); }, 5000);
  timeout.unref();
}
startCollector();
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop());
app.on('error', (error) => { console.error(error.message); stop(); process.exitCode = 1; });
app.on('exit', (code) => { stop(); process.exitCode = code ?? 0; });
