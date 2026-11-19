import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
export default (phase) => ({
  // Keep a running Codespaces dev preview from overwriting a production build.
  distDir: phase === 'phase-development-server' ? '.next-dev' : '.next',
  serverExternalPackages: ['better-sqlite3'],
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
});
