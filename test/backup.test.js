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

test('check passes on a fresh backup and fails once it is stale', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hris-backup-'));
  try {
    const dbFile = path.join(workDir, 'hris.db');
    const backupDir = path.join(workDir, 'backups');
    const backupFile = path.join(backupDir, 'snapshot.db');
    seedCompletedPayroll(dbFile);
    runScript(['backup', '--db', dbFile, '--out', backupFile]);

    const fresh = runScript(['check', '--dir', backupDir, '--max-age-hours', '26']);
    assert.match(fresh, /backup check: OK/);
    assert.match(fresh, /payroll_runs 1/);

    // Age the snapshot past the limit without touching its contents.
    const old = (Date.now() - 30 * 3_600_000) / 1000;
    fs.utimesSync(backupFile, old, old);

    const stale = spawnSync(
      process.execPath,
      ['scripts/db.mjs', 'check', '--dir', backupDir, '--max-age-hours', '26'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(stale.status, 1);
    assert.match(stale.stdout, /backup check: FAILED/);
    assert.match(stale.stderr, /is stale \(30\.0h, limit 26h\)/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('check fails loudly on a corrupt newest snapshot or a missing directory', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hris-backup-'));
  try {
    const backupDir = path.join(workDir, 'backups');
    fs.mkdirSync(backupDir);
    fs.writeFileSync(path.join(backupDir, 'hris-corrupt.db'), 'this is not a database');

    const corrupt = spawnSync(
      process.execPath,
      ['scripts/db.mjs', 'check', '--dir', backupDir],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(corrupt.status, 1);
    assert.match(corrupt.stderr, /not a readable payroll database/);

    const missing = spawnSync(
      process.execPath,
      ['scripts/db.mjs', 'check', '--dir', path.join(workDir, 'absent')],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /backup directory not found/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

function snapshotInto(dbFile, dir, name, ageHours) {
  const target = path.join(dir, name);
  runScript(['backup', '--db', dbFile, '--out', target]);
  const when = (Date.now() - ageHours * 3_600_000) / 1000;
  fs.utimesSync(target, when, when);
  return target;
}

test('prune keeps the newest snapshots and leaves other files alone', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hris-backup-'));
  try {
    const dbFile = path.join(workDir, 'hris.db');
    const backupDir = path.join(workDir, 'backups');
    fs.mkdirSync(backupDir);
    seedCompletedPayroll(dbFile);

    const files = [1, 2, 3, 4, 5].map((index) =>
      snapshotInto(dbFile, backupDir, `hris-0${index}.db`, 6 - index),
    );
    // A custom --out name and a non-database file must survive retention.
    const custom = snapshotInto(dbFile, backupDir, 'keep-me.db', 24);
    const notes = path.join(backupDir, 'hris-notes.txt');
    fs.writeFileSync(notes, 'not a snapshot');

    const out = runScript(['prune', '--dir', backupDir, '--keep', '2']);
    assert.match(out, /deleted 3 old snapshot/);

    assert.deepEqual(
      files.map((file) => fs.existsSync(file)),
      [false, false, false, true, true],
    );
    assert.ok(fs.existsSync(custom), 'custom-named backup kept');
    assert.ok(fs.existsSync(notes), 'unrelated file kept');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('prune deletes nothing until a newer snapshot verifies', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hris-backup-'));
  try {
    const dbFile = path.join(workDir, 'hris.db');
    const backupDir = path.join(workDir, 'backups');
    fs.mkdirSync(backupDir);
    seedCompletedPayroll(dbFile);

    const old = snapshotInto(dbFile, backupDir, 'hris-old.db', 4);
    const corrupt = path.join(backupDir, 'hris-new.db');
    fs.writeFileSync(corrupt, 'this is not a database');
    const twoHoursAgo = (Date.now() - 2 * 3_600_000) / 1000;
    fs.utimesSync(corrupt, twoHoursAgo, twoHoursAgo);

    const refused = spawnSync(
      process.execPath,
      ['scripts/db.mjs', 'prune', '--dir', backupDir, '--keep', '1'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /refusing to prune/);
    assert.ok(fs.existsSync(old), 'older snapshot kept when newest is unreadable');
    assert.ok(fs.existsSync(corrupt), 'corrupt newest left in place for inspection');

    // With a verified newer snapshot the same prune is allowed.
    const valid = snapshotInto(dbFile, backupDir, 'hris-valid.db', 0);
    const dryRun = runScript(['prune', '--dir', backupDir, '--keep', '1', '--dry-run']);
    assert.match(dryRun, /would delete 2 of 3/);
    assert.ok(fs.existsSync(old));
    assert.ok(fs.existsSync(corrupt));

    const real = runScript(['prune', '--dir', backupDir, '--keep', '1']);
    assert.match(real, /deleted 2 old snapshot/);
    assert.ok(fs.existsSync(valid));
    assert.ok(!fs.existsSync(old));
    assert.ok(!fs.existsSync(corrupt));
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
