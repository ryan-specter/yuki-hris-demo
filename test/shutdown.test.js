import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function startServer({ graceMs }) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hris-shutdown-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      HRIS_DB: path.join(workDir, 'db.sqlite'),
      SHUTDOWN_GRACE_MS: String(graceMs),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => logs.push(chunk));
  child.stderr.on('data', (chunk) => logs.push(chunk));

  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`server did not start: ${logs.join('')}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const exit = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { child, port, logs, workDir, exit };
}

/**
 * POST an employee with only half the JSON body sent, so the request is
 * provably mid-flight when `onHalfSent` runs.
 */
function sendSplitBody({ port, body, splitAt, onHalfSent }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/employees',
        method: 'POST',
        agent: false,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode, text }));
      },
    );
    request.on('error', reject);
    request.write(body.slice(0, splitAt));

    setTimeout(() => {
      Promise.resolve(onHalfSent())
        .then(() => request.end(body.slice(splitAt)))
        .catch(reject);
    }, 250);
  });
}

const cleanup = (child, workDir) => {
  child.kill('SIGKILL');
  fs.rmSync(workDir, { recursive: true, force: true });
};

test('SIGTERM lets an in-flight payroll request finish', async () => {
  const { child, port, logs, workDir, exit } = await startServer({ graceMs: 5_000 });
  try {
    const body = JSON.stringify({
      full_name: 'Grace Hopper',
      position: 'Engineer',
      join_date: '2026-11-02',
    });

    const response = await sendSplitBody({
      port,
      body,
      splitAt: 12,
      onHalfSent: () => child.kill('SIGTERM'),
    });

    assert.equal(response.status, 201);
    const created = JSON.parse(response.text);
    assert.equal(created.employee.full_name, 'Grace Hopper');
    assert.equal(created.employee.employee_no, 'EMP-0001');

    assert.deepEqual(await exit, { code: 0, signal: null });
    const log = logs.join('');
    assert.match(log, /SIGTERM received/);
    assert.match(log, /shutdown complete/);
  } finally {
    cleanup(child, workDir);
  }
});

test('a request still open at the grace deadline is cut off with exit 1', async () => {
  const { child, port, logs, workDir, exit } = await startServer({ graceMs: 300 });
  try {
    const body = JSON.stringify({ full_name: 'Slow Client', join_date: '2026-11-02' });
    const client = new Promise((resolve) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/employees',
          method: 'POST',
          agent: false,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
        },
        (response) => {
          response.resume();
          response.on('end', () => resolve('response'));
        },
      );
      // The body is never finished, so the request outlives the grace period.
      request.on('error', () => resolve('error'));
      request.write(body.slice(0, 10));
    });

    // Let the server accept the connection and start reading the body first.
    await new Promise((resolve) => setTimeout(resolve, 150));
    child.kill('SIGTERM');
    assert.deepEqual(await exit, { code: 1, signal: null });
    assert.match(logs.join(''), /grace period expired/);
    assert.equal(await client, 'error');
  } finally {
    cleanup(child, workDir);
  }
});
