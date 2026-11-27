import { HttpError } from './errors.js';
import { PTKP_STATUSES, computePayslip, computeThr } from './payroll.js';

const nowIso = () => new Date().toISOString();
const todayIso = () => new Date().toISOString().slice(0, 10);

// node:sqlite reports SQLite result codes on the error; the message is the
// fallback for older runtimes.
const SQLITE_BUSY = 5;
const SQLITE_CONSTRAINT_UNIQUE = 2067;

const sqliteCode = (error) => (typeof error?.errcode === 'number' ? error.errcode : null);

const isUniqueViolation = (error) =>
  sqliteCode(error) === SQLITE_CONSTRAINT_UNIQUE ||
  /UNIQUE constraint failed/.test(String(error?.message));

const isBusy = (error) =>
  sqliteCode(error) === SQLITE_BUSY ||
  /database (table )?is locked/i.test(String(error?.message));

const busyError = () => new HttpError(503, 'the payroll database is busy, try again');

// Two writers can derive the same employee number; retry with a fresh maximum.
const EMPLOYEE_NO_ATTEMPTS = 5;

export function normalizePeriod(value) {
  const period = String(value ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new HttpError(422, 'period must use the YYYY-MM format, e.g. 2026-11');
  }
  return period;
}

export function periodRange(period) {
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${period}-01`, end: `${period}-${String(lastDay).padStart(2, '0')}` };
}

function normalizeDate(value, field, fallback = todayIso()) {
  const raw = value === undefined || value === null ? '' : String(value).trim();
  if (!raw) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new HttpError(422, `${field} must use the YYYY-MM-DD format`);
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(422, `${field} is not a valid date`);
  return raw;
}

function numberField(input, field, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  const raw = input[field];
  if (raw === undefined || raw === null || raw === '') {
    if (fallback === undefined) throw new HttpError(422, `${field} is required`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new HttpError(422, `${field} must be a number`);
  if (value < min || value > max) throw new HttpError(422, `${field} must be between ${min} and ${max}`);
  return value;
}

function text(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

/* ---------------------------------------------------------------- employees */

export function listEmployees(db) {
  return db
    .prepare(
      `SELECT e.*,
              c.base_salary AS base_salary,
              c.allowance   AS allowance,
              c.effective_from AS contract_from
         FROM employees e
         LEFT JOIN contracts c
           ON c.id = (SELECT id FROM contracts
                       WHERE employee_id = e.id
                       ORDER BY effective_from DESC, id DESC LIMIT 1)
        ORDER BY e.employee_no`,
    )
    .all();
}

export function createEmployee(db, input) {
  const fullName = text(input.full_name, 120);
  if (!fullName) throw new HttpError(422, 'full_name is required');

  const email = text(input.email, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(422, 'email is not a valid address');
  }

  const ptkpStatus = text(input.ptkp_status || 'TK/0', 8).toUpperCase();
  if (!PTKP_STATUSES[ptkpStatus]) {
    throw new HttpError(422, `ptkp_status must be one of ${Object.keys(PTKP_STATUSES).join(', ')}`);
  }

  const joinDate = normalizeDate(input.join_date, 'join_date');
  const insert = db.prepare(
    `INSERT INTO employees
       (employee_no, full_name, email, position, department, join_date, status, npwp, ptkp_status, bank_account, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
  );
  const nextNumber = db.prepare(
    `SELECT COALESCE(MAX(CAST(substr(employee_no, 5) AS INTEGER)), 0) + 1 AS n FROM employees`,
  );

  // The number comes from the highest existing one, so two processes can pick
  // the same value. The unique index rejects the loser; recompute and retry
  // rather than failing the request.
  for (let attempt = 1; attempt <= EMPLOYEE_NO_ATTEMPTS; attempt += 1) {
    const employeeNo = `EMP-${String(nextNumber.get().n).padStart(4, '0')}`;
    try {
      const info = insert.run(
        employeeNo,
        fullName,
        email || null,
        text(input.position, 120) || null,
        text(input.department, 120) || null,
        joinDate,
        text(input.npwp, 40) || null,
        ptkpStatus,
        text(input.bank_account, 60) || null,
        nowIso(),
      );
      return employeeDetail(db, Number(info.lastInsertRowid));
    } catch (error) {
      const numberTaken =
        isUniqueViolation(error) && /employees\.employee_no/.test(String(error.message));
      if (!numberTaken) {
        if (isBusy(error)) throw busyError();
        throw error;
      }
      if (attempt === EMPLOYEE_NO_ATTEMPTS) {
        throw new HttpError(503, 'could not allocate an employee number, try again');
      }
    }
  }

  throw new HttpError(503, 'could not allocate an employee number, try again');
}

export function employeeDetail(db, employeeId) {
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!employee) return null;

  const contracts = db
    .prepare('SELECT * FROM contracts WHERE employee_id = ? ORDER BY effective_from DESC, id DESC')
    .all(employeeId);
  const attendance = db
    .prepare('SELECT * FROM attendance WHERE employee_id = ? ORDER BY period DESC')
    .all(employeeId);
  const payslips = db
    .prepare(
      `SELECT p.*, r.period AS period, r.status AS run_status, r.completed_at AS completed_at
         FROM payslips p
         JOIN payroll_runs r ON r.id = p.run_id
        WHERE p.employee_id = ?
        ORDER BY r.period DESC`,
    )
    .all(employeeId);

  return { employee, contracts, attendance, payslips, contract: contracts[0] ?? null };
}

/* ---------------------------------------------------------------- contracts */

export function addContract(db, employeeId, input) {
  const employee = db.prepare('SELECT id FROM employees WHERE id = ?').get(employeeId);
  if (!employee) throw new HttpError(404, 'employee not found');

  const baseSalary = Math.round(
    numberField(input, 'base_salary', { min: 1, max: 1_000_000_000_000 }),
  );
  const allowance = Math.round(
    numberField(input, 'allowance', { min: 0, max: 1_000_000_000_000, fallback: 0 }),
  );
  const effectiveFrom = normalizeDate(input.effective_from, 'effective_from', todayIso());
  const effectiveToRaw = text(input.effective_to, 10);
  const effectiveTo = effectiveToRaw ? normalizeDate(effectiveToRaw, 'effective_to') : null;

  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new HttpError(422, 'effective_to cannot be earlier than effective_from');
  }

  const info = db
    .prepare(
      `INSERT INTO contracts (employee_id, base_salary, allowance, effective_from, effective_to, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(employeeId, baseSalary, allowance, effectiveFrom, effectiveTo, nowIso());

  return db.prepare('SELECT * FROM contracts WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function contractForPeriod(db, employeeId, period) {
  const { start, end } = periodRange(period);
  return (
    db
      .prepare(
        `SELECT * FROM contracts
          WHERE employee_id = ?
            AND effective_from <= ?
            AND (effective_to IS NULL OR effective_to >= ?)
          ORDER BY effective_from DESC, id DESC
          LIMIT 1`,
      )
      .get(employeeId, end, start) ?? null
  );
}

/* --------------------------------------------------------------- attendance */

export function recordAttendance(db, employeeId, input) {
  const employee = db.prepare('SELECT id FROM employees WHERE id = ?').get(employeeId);
  if (!employee) throw new HttpError(404, 'employee not found');

  const period = normalizePeriod(input.period);
  const workingDays = Math.round(numberField(input, 'working_days', { min: 1, max: 31, fallback: 22 }));
  const presentDays = Math.round(numberField(input, 'present_days', { min: 0, max: 31, fallback: 0 }));
  const paidLeaveDays = Math.round(
    numberField(input, 'paid_leave_days', { min: 0, max: 31, fallback: 0 }),
  );
  const unpaidLeaveDays = Math.round(
    numberField(input, 'unpaid_leave_days', { min: 0, max: 31, fallback: 0 }),
  );
  const overtimeHours = numberField(input, 'overtime_hours', { min: 0, max: 300, fallback: 0 });

  if (presentDays + paidLeaveDays + unpaidLeaveDays > workingDays) {
    throw new HttpError(422, 'present, paid leave and unpaid leave days cannot exceed working_days');
  }

  db.prepare(
    `INSERT INTO attendance
       (employee_id, period, working_days, present_days, paid_leave_days, unpaid_leave_days, overtime_hours, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (employee_id, period) DO UPDATE SET
       working_days = excluded.working_days,
       present_days = excluded.present_days,
       paid_leave_days = excluded.paid_leave_days,
       unpaid_leave_days = excluded.unpaid_leave_days,
       overtime_hours = excluded.overtime_hours,
       updated_at = excluded.updated_at`,
  ).run(
    employeeId,
    period,
    workingDays,
    presentDays,
    paidLeaveDays,
    unpaidLeaveDays,
    overtimeHours,
    nowIso(),
  );

  return db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND period = ?').get(employeeId, period);
}

/* ------------------------------------------------------------------ payroll */

export function listRuns(db) {
  return db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM payslips p WHERE p.run_id = r.id) AS employee_count
         FROM payroll_runs r
        ORDER BY r.period DESC`,
    )
    .all();
}

export function runDetail(db, runId) {
  const run = db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(runId);
  if (!run) return null;
  const payslips = db
    .prepare(
      `SELECT p.*, e.full_name AS full_name, e.employee_no AS employee_no,
              e.bank_account AS bank_account
         FROM payslips p
         JOIN employees e ON e.id = p.employee_id
        WHERE p.run_id = ?
        ORDER BY e.employee_no`,
    )
    .all(runId);
  return { run, payslips };
}

export function createRun(db, input) {
  const period = normalizePeriod(input.period);

  const existing = db.prepare('SELECT id FROM payroll_runs WHERE period = ?').get(period);
  if (existing) throw new HttpError(409, `a payroll run for ${period} already exists`);

  const employees = db.prepare(`SELECT * FROM employees WHERE status = 'active' ORDER BY employee_no`).all();
  const { end } = periodRange(period);
  const prepared = [];
  const missingAttendance = [];
  const withoutContract = [];

  for (const employee of employees) {
    const contract = contractForPeriod(db, employee.id, period);
    if (!contract) {
      // Employees who start after the period ends are simply not part of it.
      if (employee.join_date <= end) withoutContract.push(employee.full_name);
      continue;
    }
    const attendance = db
      .prepare('SELECT * FROM attendance WHERE employee_id = ? AND period = ?')
      .get(employee.id, period);
    if (!attendance) {
      missingAttendance.push(employee.full_name);
      continue;
    }
    prepared.push({ employee, contract, attendance });
  }

  if (withoutContract.length) {
    throw new HttpError(422, `no contract covering ${period} for: ${withoutContract.join(', ')}`);
  }
  if (missingAttendance.length) {
    throw new HttpError(422, `attendance missing for ${period}: ${missingAttendance.join(', ')}`);
  }
  if (!prepared.length) {
    throw new HttpError(422, `no active employees are payable for ${period}`);
  }

  const includeThr = ['1', 'true', 'on', 'yes'].includes(
    String(input.include_thr ?? '').toLowerCase(),
  );

  const computed = prepared.map(({ employee, contract, attendance }) => {
    const thrAmount = includeThr
      ? computeThr({
          baseSalary: contract.base_salary,
          allowance: contract.allowance,
          joinDate: employee.join_date,
          period,
        }).amount
      : 0;

    return {
      employee,
      attendance,
      payslip: computePayslip({
        baseSalary: contract.base_salary,
        allowance: contract.allowance,
        attendance: {
          workingDays: attendance.working_days,
          presentDays: attendance.present_days,
          paidLeaveDays: attendance.paid_leave_days,
          unpaidLeaveDays: attendance.unpaid_leave_days,
          overtimeHours: attendance.overtime_hours,
        },
        ptkpStatus: employee.ptkp_status,
        thrAmount,
      }),
    };
  });

  const totalGross = computed.reduce((sum, row) => sum + row.payslip.gross, 0);
  const totalNet = computed.reduce((sum, row) => sum + row.payslip.netPay, 0);
  const totalThr = computed.reduce((sum, row) => sum + row.payslip.thrAmount, 0);
  const totalEmployer = computed.reduce((sum, row) => sum + row.payslip.employerTotal, 0);
  const totalEmployerCost = totalGross + totalEmployer;

  let inTransaction = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    inTransaction = true;

    const info = db
      .prepare(
        `INSERT INTO payroll_runs
           (period, status, total_gross, total_net, total_thr,
            total_employer_contribution, total_employer_cost, created_at)
         VALUES (?, 'draft', ?, ?, ?, ?, ?, ?)`,
      )
      .run(period, totalGross, totalNet, totalThr, totalEmployer, totalEmployerCost, nowIso());
    const runId = Number(info.lastInsertRowid);

    const insert = db.prepare(
      `INSERT INTO payslips
         (run_id, employee_id, base_salary, prorated_base, allowance, overtime_pay, thr_amount, gross,
          bpjs_kesehatan, bpjs_jht, bpjs_jp, pph21, other_deduction, total_deductions, net_pay,
          employer_bpjs_kesehatan, employer_bpjs_jht, employer_bpjs_jp,
          employer_bpjs_jkk, employer_bpjs_jkm, employer_total,
          working_days, present_days, paid_leave_days, unpaid_leave_days, overtime_hours)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const { employee, attendance, payslip } of computed) {
      insert.run(
        runId,
        employee.id,
        payslip.baseSalary,
        payslip.proratedBase,
        payslip.allowance,
        payslip.overtimePay,
        payslip.thrAmount,
        payslip.gross,
        payslip.bpjsKesehatan,
        payslip.bpjsJht,
        payslip.bpjsJp,
        payslip.pph21,
        payslip.otherDeduction,
        payslip.totalDeductions,
        payslip.netPay,
        payslip.employerBpjsKesehatan,
        payslip.employerBpjsJht,
        payslip.employerBpjsJp,
        payslip.employerBpjsJkk,
        payslip.employerBpjsJkm,
        payslip.employerTotal,
        attendance.working_days,
        attendance.present_days,
        attendance.paid_leave_days,
        attendance.unpaid_leave_days,
        attendance.overtime_hours,
      );
    }

    db.exec('COMMIT');
    inTransaction = false;
    return runDetail(db, runId);
  } catch (error) {
    if (inTransaction) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // SQLite may already have rolled the transaction back.
      }
    }
    // Another process can create the same period between the check above and
    // this insert; the unique index is the authority, so report the conflict
    // the same way the pre-check does.
    if (isUniqueViolation(error)) {
      throw new HttpError(409, `a payroll run for ${period} already exists`);
    }
    if (isBusy(error)) throw busyError();
    throw error;
  }
}

export function completeRun(db, runId) {
  const detail = runDetail(db, runId);
  if (!detail) throw new HttpError(404, 'payroll run not found');
  if (detail.run.status === 'completed') {
    throw new HttpError(409, `payroll for ${detail.run.period} is already completed`);
  }
  if (!detail.payslips.length) throw new HttpError(422, 'a payroll run needs at least one payslip');

  // Completing is a single conditional update, so two concurrent completions
  // cannot both succeed and rewrite completed_at.
  try {
    const info = db
      .prepare(
        `UPDATE payroll_runs SET status = 'completed', completed_at = ?
          WHERE id = ? AND status = 'draft'`,
      )
      .run(nowIso(), detail.run.id);
    if (info.changes === 0) {
      throw new HttpError(409, `payroll for ${detail.run.period} is already completed`);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (isBusy(error)) throw busyError();
    throw error;
  }
  return runDetail(db, detail.run.id);
}

export function payslipDetail(db, payslipId) {
  return (
    db
      .prepare(
        `SELECT p.*, e.full_name AS full_name, e.employee_no AS employee_no,
                e.position AS position, e.department AS department,
                e.ptkp_status AS ptkp_status, e.bank_account AS bank_account,
                e.join_date AS join_date,
                r.period AS period, r.status AS run_status, r.completed_at AS completed_at
           FROM payslips p
           JOIN employees e ON e.id = p.employee_id
           JOIN payroll_runs r ON r.id = p.run_id
          WHERE p.id = ?`,
      )
      .get(payslipId) ?? null
  );
}

/* -------------------------------------------------------------------- stats */

export function stats(db) {
  const count = (sql) => db.prepare(sql).get().n;
  return {
    employees: count('SELECT COUNT(*) AS n FROM employees'),
    contracts: count('SELECT COUNT(*) AS n FROM contracts'),
    attendance: count('SELECT COUNT(*) AS n FROM attendance'),
    runs: count('SELECT COUNT(*) AS n FROM payroll_runs'),
    completedRuns: count(`SELECT COUNT(*) AS n FROM payroll_runs WHERE status = 'completed'`),
    lastRun: db.prepare('SELECT * FROM payroll_runs ORDER BY id DESC LIMIT 1').get() ?? null,
  };
}
