#!/usr/bin/env node
// Back up and restore the payroll database as one consistent file.
//
// The server runs SQLite in WAL mode, so copying hris.db while it is serving can
// capture a torn database plus a WAL that has not been applied yet. Backups use
// VACUUM INTO, which writes a consistent snapshot even with requests in flight,
// and both sides are checked with PRAGMA integrity_check and row counts.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const USAGE = `Usage:
  node scripts/db.mjs backup  [--db <database>] [--out <file>] [--force]
  node scripts/db.mjs restore --from <backup> [--db <database>] [--force]
  node scripts/db.mjs check   [--dir <directory>] [--max-age-hours <hours>]

backup   Snapshot the database (default: $HRIS_DB or data/hris.db) to
         backups/hris-<timestamp>.db. Safe while the app is running.
restore  Replace the database with a backup. Stop the app first; --force
         overwrites an existing database and drops its stale WAL files.
check    Verify the newest backup in the directory: readable, integrity ok,
         payroll schema present, and no older than --max-age-hours (or
         $BACKUP_MAX_AGE_HOURS; default 26). Exits 1 when it is missing, stale
         or corrupt, so a scheduler alerts instead of failing silently.`;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--db') options.db = rest[++index];
    else if (arg === '--out') options.out = rest[++index];
    else if (arg === '--from') options.from = rest[++index];
    else if (arg === '--dir') options.dir = rest[++index];
    else if (arg === '--max-age-hours') options.maxAgeHours = rest[++index];
    else if (arg === '--force') options.force = true;
    else if (arg === '-h' || arg === '--help') options.help = true;
    else fail(`unknown argument: ${arg}\n\n${USAGE}`);
  }
  return options;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

function inspect(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get();
    const status = Object.values(integrity)[0];
    const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    return {
      status,
      employees: count('employees'),
      runs: count('payroll_runs'),
      payslips: count('payslips'),
    };
  } finally {
    db.close();
  }
}

const describe = (info) =>
  `integrity ${info.status} · employees ${info.employees} · payroll_runs ${info.runs} · payslips ${info.payslips}`;

const databasePath = (options) =>
  path.resolve(options.db ?? process.env.HRIS_DB ?? 'data/hris.db');

function backup(options) {
  const source = databasePath(options);
  if (!fs.existsSync(source)) fail(`database not found: ${source}`);

  const target = path.resolve(options.out ?? path.join('backups', `hris-${stamp()}.db`));
  if (fs.existsSync(target) && !options.force) {
    fail(`refusing to overwrite ${target} (pass --force)`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const temp = `${target}.tmp-${process.pid}`;
  fs.rmSync(temp, { force: true });
  try {
    const db = new DatabaseSync(source);
    try {
      db.exec(`VACUUM INTO ${quote(temp)}`);
    } finally {
      db.close();
    }

    const info = inspect(temp);
    if (info.status !== 'ok') fail(`snapshot failed integrity check: ${info.status}`);

    fs.renameSync(temp, target);
    console.log(`backup:  ${target}`);
    console.log(`source:  ${source}`);
    console.log(describe(info));
  } catch (error) {
    fs.rmSync(temp, { force: true });
    fail(error.message);
  }
}

function restore(options) {
  if (!options.from) fail(`--from <backup> is required\n\n${USAGE}`);

  const source = path.resolve(options.from);
  if (!fs.existsSync(source)) fail(`backup not found: ${source}`);
  const info = inspect(source);
  if (info.status !== 'ok') fail(`backup failed integrity check: ${info.status}`);

  const target = databasePath(options);
  let previous = null;
  if (fs.existsSync(target)) {
    try {
      previous = inspect(target);
    } catch {
      previous = { status: 'unreadable', employees: '?', runs: '?', payslips: '?' };
    }
    if (!options.force) {
      fail(`refusing to replace ${target} (${describe(previous)}); pass --force`);
    }
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.restore-${process.pid}`;
  fs.rmSync(temp, { force: true });
  try {
    fs.copyFileSync(source, temp);
    const fd = fs.openSync(temp, 'r+');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(temp, target);

    // A WAL left behind by the replaced database must never be replayed into
    // this one, so drop it with the file it belongs to.
    fs.rmSync(`${target}-wal`, { force: true });
    fs.rmSync(`${target}-shm`, { force: true });

    console.log(`restored: ${target}`);
    console.log(`from:     ${source}`);
    if (previous) console.log(`replaced: ${describe(previous)}`);
    console.log(describe(inspect(target)));
  } catch (error) {
    fs.rmSync(temp, { force: true });
    fail(error.message);
  }
}

function check(options) {
  const dir = path.resolve(options.dir ?? 'backups');
  if (!fs.existsSync(dir)) fail(`backup directory not found: ${dir}`);

  const snapshots = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.db') && !name.includes('.tmp-') && !name.includes('.restore-'))
    .map((name) => {
      const file = path.join(dir, name);
      return { file, mtime: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (!snapshots.length) fail(`no backups in ${dir} — the scheduled backup never ran`);

  const rawLimit = options.maxAgeHours ?? process.env.BACKUP_MAX_AGE_HOURS ?? '26';
  const maxAgeHours = Number(rawLimit);
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    fail(`--max-age-hours must be a positive number, got ${rawLimit}`);
  }

  const newest = snapshots[0];
  const ageHours = (Date.now() - newest.mtime) / 3_600_000;

  let info;
  try {
    info = inspect(newest.file);
  } catch (error) {
    fail(`newest backup is not a readable payroll database: ${newest.file} (${error.message})`);
  }

  const problems = [];
  if (info.status !== 'ok') problems.push(`integrity ${info.status}`);
  if (ageHours > maxAgeHours) {
    problems.push(`stale: ${ageHours.toFixed(1)}h old, limit ${maxAgeHours}h`);
  }

  console.log(`backup check: ${problems.length ? 'FAILED' : 'OK'}`);
  console.log(`newest:       ${newest.file} (${ageHours.toFixed(1)}h old, limit ${maxAgeHours}h)`);
  console.log(describe(info));

  if (problems.length) {
    const verbs = [];
    if (info.status !== 'ok') verbs.push('is corrupt');
    if (ageHours > maxAgeHours) verbs.push(`is stale (${ageHours.toFixed(1)}h, limit ${maxAgeHours}h)`);
    fail(`backup ${newest.file} ${verbs.join(' and ')}`);
  }
}

const options = parseArgs(process.argv.slice(2));
if (options.help || !options.command) {
  console.log(USAGE);
  process.exit(options.help ? 0 : 1);
}
if (options.command === 'backup') backup(options);
else if (options.command === 'restore') restore(options);
else if (options.command === 'check') check(options);
else fail(`unknown command: ${options.command}\n\n${USAGE}`);
