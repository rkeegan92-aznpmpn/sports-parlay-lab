import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { previewState } from './codespace-start.mjs';

test('preview readiness distinguishes this app, an unhealthy listener, and a stopped server', async () => {
  let status = 200, body = { database: 'ready', oddsApiKeyConfigured: false };
  const server = createServer((req, res) => { assert.equal(req.url, '/api/health'); res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  try {
    assert.equal(await previewState(port), 'ready');
    body = { database: 'ready' }; // Another service is not sufficient evidence.
    assert.equal(await previewState(port), 'occupied-or-unhealthy');
    status = 503; body = { database: 'ready', oddsApiKeyConfigured: false };
    assert.equal(await previewState(port), 'occupied-or-unhealthy');
  } finally { await new Promise(resolve => server.close(resolve)); }
  assert.equal(await previewState(port), 'stopped');
});
