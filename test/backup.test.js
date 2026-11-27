import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.js';
import * as store from '../src/store.js';

const root = path.resolve(import.meta.dirname, '..');

function seedCompletedPayroll(file) {
  const db = openDb(file);
  try {
    const created = store.createEmployee(db, {
      full_name: 'Ayu Prameswari',
      join_date: '2026-11-02',
      ptkp_status: 'TK/0',
    });
    store.addContract(db, created.employee.id, {
      base_salary: 8_500_000,
      allowance: 750_000,
      effective_from: '2026-11-01',
    });
    store.recordAttendance(db, created.employee.id, {
      period: '2026-11',
      working_days: 22,
      present_days: 22,
      overtime_hours: 4,
    });
    const draft = store.createRun(db, { period: '2026-11' });
    store.completeRun(db, draft.run.id);
  } finally {
    db.close();
  }
}

function readRun(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT r.period, r.status, r.completed_at, p.gross, p.net_pay
           FROM payroll_runs r
           JOIN payslips p ON p.run_id = r.id`,
      )
      .get();
  } finally {
    db.close();
  }
}

const runScript = (args) =>
  execFileSync(process.execPath, ['scripts/db.mjs', ...args], { cwd: root, encoding: 'utf8' });

test('a backup restores a completed payroll run exactly', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hris-backup-'));
  try {
    const dbFile = path.join(workDir, 'hris.db');
    const backupFile = path.join(workDir, 'snapshot.db');

    seedCompletedPayroll(dbFile);
    const original = readRun(dbFile);
    assert.equal(original.status, 'completed');
    assert.ok(original.completed_at);
    assert.equal(original.gross, 9_544_798);
    assert.equal(original.net_pay, 8_948_078);

    const backupOut = runScript(['backup', '--db', dbFile, '--out', backupFile]);
    assert.match(backupOut, /integrity ok/);
    assert.match(backupOut, /payroll_runs 1/);
    assert.equal(readRun(backupFile).net_pay, 8_948_078);

    // Lose the original database entirely, as after a bad deploy or a dead disk.
    fs.rmSync(dbFile, { force: true });
    const restoreOut = runScript(['restore', '--from', backupFile, '--db', dbFile]);
    assert.match(restoreOut, /integrity ok/);

    assert.deepEqual(readRun(dbFile), original);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('restore refuses to overwrite a database or a backup without --force', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hris-backup-'));
  try {
    const dbFile = path.join(workDir, 'hris.db');
    const backupFile = path.join(workDir, 'snapshot.db');
    seedCompletedPayroll(dbFile);
    runScript(['backup', '--db', dbFile, '--out', backupFile]);

    const restore = spawnSync(
      process.execPath,
      ['scripts/db.mjs', 'restore', '--from', backupFile, '--db', dbFile],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(restore.status, 1);
    assert.match(restore.stderr, /refusing to replace/);

    const backup = spawnSync(
      process.execPath,
      ['scripts/db.mjs', 'backup', '--db', dbFile, '--out', backupFile],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(backup.status, 1);
    assert.match(backup.stderr, /refusing to overwrite/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
