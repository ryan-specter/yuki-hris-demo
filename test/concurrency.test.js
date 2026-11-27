import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForHealth(port) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`server on ${port} did not start`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function startServer(dbFile) {
  const port = await freePort();
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', HRIS_DB: dbFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume();
  child.stderr.resume();
  await waitForHealth(port);
  return { child, port };
}

function stop(server) {
  return new Promise((resolve) => {
    if (server.child.exitCode !== null) return resolve();
    server.child.once('exit', resolve);
    server.child.kill('SIGTERM');
  });
}

const call = (port, method, route, body) =>
  fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => ({
    status: response.status,
    data: await response.json().catch(() => null),
  }));

async function seed(port) {
  const employee = await call(port, 'POST', '/api/employees', {
    full_name: 'Ayu Prameswari',
    join_date: '2026-11-02',
    ptkp_status: 'TK/0',
  });
  assert.equal(employee.status, 201);

  const contract = await call(port, 'POST', '/api/employees/1/contracts', {
    base_salary: 8_500_000,
    allowance: 750_000,
    effective_from: '2026-11-01',
  });
  assert.equal(contract.status, 201);

  for (const period of ['2026-11', '2026-12']) {
    const attendance = await call(port, 'PUT', '/api/employees/1/attendance', {
      period,
      working_days: 22,
      present_days: 22,
      overtime_hours: 4,
    });
    assert.equal(attendance.status, 200);
  }
}

/** Read the invariants straight from the file, bypassing the app. */
function snapshot(dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    return {
      runs: db
        .prepare(
          `SELECT r.id, r.period, r.status, r.total_gross, r.total_net, r.completed_at,
                  (SELECT COUNT(*) FROM payslips p WHERE p.run_id = r.id) AS payslips
             FROM payroll_runs r
            ORDER BY r.id`,
        )
        .all()
        // node:sqlite rows have a null prototype; compare plain objects.
        .map((row) => ({ ...row })),
      totals: db
        .prepare(
          `SELECT run_id, COUNT(*) AS payslips, SUM(gross) AS gross, SUM(net_pay) AS net
             FROM payslips
            GROUP BY run_id
            ORDER BY run_id`,
        )
        .all()
        .map((row) => ({ ...row })),
      orphans: db
        .prepare(
          `SELECT COUNT(*) AS n
             FROM payslips p
             LEFT JOIN payroll_runs r ON r.id = p.run_id
            WHERE r.id IS NULL`,
        )
        .get().n,
    };
  } finally {
    db.close();
  }
}

test('eight simultaneous requests for one period create exactly one run', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hris-concurrency-'));
  const dbFile = path.join(workDir, 'hris.db');
  const server = await startServer(dbFile);
  try {
    await seed(server.port);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => call(server.port, 'POST', '/api/payroll/runs', { period: '2026-11' })),
    );
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 7);
    for (const conflict of results.filter((r) => r.status === 409)) {
      assert.match(conflict.data.error, /already exists/);
    }

    const snap = snapshot(dbFile);
    assert.equal(snap.runs.length, 1);
    assert.equal(snap.runs[0].payslips, 1);
    assert.equal(snap.runs[0].total_gross, 9_544_798);
    assert.equal(snap.runs[0].total_net, 8_948_078);
    assert.equal(snap.orphans, 0);
    assert.deepEqual(snap.totals, [
      { run_id: snap.runs[0].id, payslips: 1, gross: 9_544_798, net: 8_948_078 },
    ]);
  } finally {
    await stop(server);
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('two processes racing for the same period get 201 and 409, never a 500', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hris-concurrency-'));
  const dbFile = path.join(workDir, 'hris.db');
  const first = await startServer(dbFile);
  const second = await startServer(dbFile);
  try {
    await seed(first.port);

    const results = await Promise.all([
      call(first.port, 'POST', '/api/payroll/runs', { period: '2026-11' }),
      call(second.port, 'POST', '/api/payroll/runs', { period: '2026-11' }),
    ]);
    const statuses = results.map((r) => r.status).sort((a, b) => a - b);
    assert.deepEqual(statuses, [201, 409]);
    assert.match(results.find((r) => r.status === 409).data.error, /already exists/);

    const snap = snapshot(dbFile);
    assert.equal(snap.runs.length, 1);
    assert.equal(snap.runs[0].payslips, 1);
    assert.equal(snap.orphans, 0);
    assert.deepEqual(snap.totals, [
      { run_id: snap.runs[0].id, payslips: 1, gross: 9_544_798, net: 8_948_078 },
    ]);
  } finally {
    await stop(first);
    await stop(second);
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('two processes creating different periods keep their payslips separate', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hris-concurrency-'));
  const dbFile = path.join(workDir, 'hris.db');
  const first = await startServer(dbFile);
  const second = await startServer(dbFile);
  try {
    await seed(first.port);

    const results = await Promise.all([
      call(first.port, 'POST', '/api/payroll/runs', { period: '2026-11' }),
      call(second.port, 'POST', '/api/payroll/runs', { period: '2026-12' }),
    ]);
    assert.deepEqual(results.map((r) => r.status), [201, 201]);

    const snap = snapshot(dbFile);
    assert.deepEqual(snap.runs.map((run) => run.period), ['2026-11', '2026-12']);
    for (const run of snap.runs) {
      assert.equal(run.payslips, 1);
      assert.equal(run.status, 'draft');
    }
    assert.equal(snap.orphans, 0);
    assert.equal(snap.totals.length, 2);
    for (const total of snap.totals) {
      assert.equal(total.payslips, 1);
      assert.equal(total.gross, 9_544_798);
    }
  } finally {
    await stop(first);
    await stop(second);
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('two processes completing one run: one 200, one 409, timestamp written once', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hris-concurrency-'));
  const dbFile = path.join(workDir, 'hris.db');
  const first = await startServer(dbFile);
  const second = await startServer(dbFile);
  try {
    await seed(first.port);
    const created = await call(first.port, 'POST', '/api/payroll/runs', { period: '2026-11' });
    assert.equal(created.status, 201);
    const runId = created.data.run.id;

    const results = await Promise.all([
      call(first.port, 'POST', `/api/payroll/runs/${runId}/complete`),
      call(second.port, 'POST', `/api/payroll/runs/${runId}/complete`),
    ]);
    const statuses = results.map((r) => r.status).sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409]);

    const winner = results.find((r) => r.status === 200);
    assert.equal(winner.data.run.status, 'completed');

    const snap = snapshot(dbFile);
    assert.equal(snap.runs.length, 1);
    assert.equal(snap.runs[0].status, 'completed');
    assert.equal(snap.runs[0].completed_at, winner.data.run.completed_at);
    assert.equal(snap.runs[0].payslips, 1);
    assert.equal(snap.orphans, 0);
  } finally {
    await stop(first);
    await stop(second);
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
