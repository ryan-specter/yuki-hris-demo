import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_no   TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  email         TEXT,
  position      TEXT,
  department    TEXT,
  join_date     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  npwp          TEXT,
  ptkp_status   TEXT NOT NULL DEFAULT 'TK/0',
  bank_account  TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contracts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id    INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  base_salary    INTEGER NOT NULL,
  allowance      INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL,
  effective_to   TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contracts_employee ON contracts(employee_id);

CREATE TABLE IF NOT EXISTS attendance (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id       INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period            TEXT NOT NULL,
  working_days      INTEGER NOT NULL,
  present_days      INTEGER NOT NULL,
  paid_leave_days   INTEGER NOT NULL DEFAULT 0,
  unpaid_leave_days INTEGER NOT NULL DEFAULT 0,
  overtime_hours    REAL NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL,
  UNIQUE (employee_id, period)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  period       TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'draft',
  total_gross  INTEGER NOT NULL DEFAULT 0,
  total_net    INTEGER NOT NULL DEFAULT 0,
  total_thr    INTEGER NOT NULL DEFAULT 0,
  total_employer_contribution INTEGER NOT NULL DEFAULT 0,
  total_employer_cost         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS payslips (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id            INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id       INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  base_salary       INTEGER NOT NULL,
  prorated_base     INTEGER NOT NULL,
  allowance         INTEGER NOT NULL,
  overtime_pay      INTEGER NOT NULL,
  thr_amount        INTEGER NOT NULL DEFAULT 0,
  gross             INTEGER NOT NULL,
  bpjs_kesehatan    INTEGER NOT NULL,
  bpjs_jht          INTEGER NOT NULL,
  bpjs_jp           INTEGER NOT NULL,
  pph21             INTEGER NOT NULL,
  other_deduction   INTEGER NOT NULL DEFAULT 0,
  total_deductions  INTEGER NOT NULL,
  net_pay           INTEGER NOT NULL,
  employer_bpjs_kesehatan INTEGER NOT NULL DEFAULT 0,
  employer_bpjs_jht       INTEGER NOT NULL DEFAULT 0,
  employer_bpjs_jp        INTEGER NOT NULL DEFAULT 0,
  employer_bpjs_jkk       INTEGER NOT NULL DEFAULT 0,
  employer_bpjs_jkm       INTEGER NOT NULL DEFAULT 0,
  employer_total          INTEGER NOT NULL DEFAULT 0,
  working_days      INTEGER NOT NULL,
  present_days      INTEGER NOT NULL,
  paid_leave_days   INTEGER NOT NULL,
  unpaid_leave_days INTEGER NOT NULL,
  overtime_hours    REAL NOT NULL,
  UNIQUE (run_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_payslips_run ON payslips(run_id);
`;

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Databases created before THR and employer contributions need the new columns.
function migrate(db) {
  ensureColumn(db, 'payslips', 'thr_amount', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'payslips', 'employer_bpjs_kesehatan', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'payslips', 'employer_bpjs_jht', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'payslips', 'employer_bpjs_jp', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'payslips', 'employer_bpjs_jkk', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'payslips', 'employer_bpjs_jkm', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'payslips', 'employer_total', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'payroll_runs', 'total_thr', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'payroll_runs', 'total_employer_contribution', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'payroll_runs', 'total_employer_cost', 'INTEGER NOT NULL DEFAULT 0');
}

// How long a writer waits for another connection holding the write lock before
// reporting the database as busy. Two app processes can share one database file.
const BUSY_TIMEOUT_MS = Number(process.env.HRIS_BUSY_TIMEOUT_MS ?? 5_000);

export function openDb(file = ':memory:') {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(
    `PRAGMA busy_timeout = ${Number.isFinite(BUSY_TIMEOUT_MS) ? Math.max(0, BUSY_TIMEOUT_MS) : 5_000};`,
  );
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
