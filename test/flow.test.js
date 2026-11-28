import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toCsv } from '../src/csv.js';

let server;
let base;
let workDir;

const call = async (method, route, body) => {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return {
    status: response.status,
    data,
    text,
    headers: Object.fromEntries(response.headers.entries()),
  };
};

before(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hris-demo-'));
  process.env.HRIS_DB = path.join(workDir, 'test.db');
  process.env.HRIS_NO_LISTEN = '1';
  const mod = await import('../src/server.js');
  server = mod.server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(workDir, { recursive: true, force: true });
});

test('health endpoint reports the service', async () => {
  const { status, data } = await call('GET', '/health');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
});

test('new employee gets a sequential employee number', async () => {
  const first = await call('POST', '/api/employees', {
    full_name: 'Ayu Prameswari',
    email: 'ayu@example.com',
    position: 'Payroll Analyst',
    department: 'People Operations',
    join_date: '2026-11-02',
    ptkp_status: 'TK/0',
    bank_account: 'BCA 1234567890',
  });

  assert.equal(first.status, 201);
  assert.equal(first.data.employee.employee_no, 'EMP-0001');
  assert.equal(first.data.employee.status, 'active');

  const second = await call('POST', '/api/employees', {
    full_name: 'Bima Saputra',
    join_date: '2026-11-16',
  });
  assert.equal(second.status, 201);
  assert.equal(second.data.employee.employee_no, 'EMP-0002');
});

test('employee validation rejects a missing name and an unknown PTKP status', async () => {
  const noName = await call('POST', '/api/employees', { email: 'x@example.com' });
  assert.equal(noName.status, 422);

  const badPtkp = await call('POST', '/api/employees', {
    full_name: 'Citra',
    ptkp_status: 'XX/9',
  });
  assert.equal(badPtkp.status, 422);
});

test('a contract is required before payroll can include an employee', async () => {
  const missing = await call('POST', '/api/payroll/runs', { period: '2026-11' });
  assert.equal(missing.status, 422);
  assert.match(missing.data.error, /contract/i);
});

test('contract and attendance are stored for the employee', async () => {
  const contract = await call('POST', '/api/employees/1/contracts', {
    base_salary: 8_500_000,
    allowance: 750_000,
    effective_from: '2026-11-01',
  });
  assert.equal(contract.status, 201);
  assert.equal(contract.data.contract.base_salary, 8_500_000);

  const attendance = await call('PUT', '/api/employees/1/attendance', {
    period: '2026-11',
    working_days: 22,
    present_days: 22,
    overtime_hours: 0,
  });
  assert.equal(attendance.status, 200);
  assert.equal(attendance.data.attendance.present_days, 22);
});

test('payroll refuses to run while an active employee has no contract', async () => {
  const { status, data } = await call('POST', '/api/payroll/runs', { period: '2026-11' });
  assert.equal(status, 422);
  assert.match(data.error, /no contract covering 2026-11/);
  assert.match(data.error, /Bima Saputra/);
});

test('a missing attendance row also blocks the run', async () => {
  const contract = await call('POST', '/api/employees/2/contracts', {
    base_salary: 6_000_000,
    effective_from: '2026-11-01',
  });
  assert.equal(contract.status, 201);

  const blocked = await call('POST', '/api/payroll/runs', { period: '2026-11' });
  assert.equal(blocked.status, 422);
  assert.match(blocked.data.error, /attendance missing/i);
  assert.match(blocked.data.error, /Bima Saputra/);
});

test('creating a run computes a payslip per employee with the expected net pay', async () => {
  const attendance = await call('PUT', '/api/employees/2/attendance', {
    period: '2026-11',
    working_days: 22,
    present_days: 22,
  });
  assert.equal(attendance.status, 200);

  const created = await call('POST', '/api/payroll/runs', { period: '2026-11' });
  assert.equal(created.status, 201);
  assert.equal(created.data.run.status, 'draft');
  assert.equal(created.data.payslips.length, 2);

  const ayu = created.data.payslips.find((slip) => slip.employee_no === 'EMP-0001');
  assert.equal(ayu.gross, 9_250_000);
  assert.equal(ayu.bpjs_kesehatan, 85_000);
  assert.equal(ayu.bpjs_jht, 170_000);
  assert.equal(ayu.bpjs_jp, 85_000);
  assert.equal(ayu.pph21, 237_500);
  assert.equal(ayu.net_pay, 8_672_500);

  const bima = created.data.payslips.find((slip) => slip.employee_no === 'EMP-0002');
  assert.equal(bima.gross, 6_000_000);
  assert.equal(bima.net_pay, 5_685_000);

  assert.equal(created.data.run.total_gross, 15_250_000);
  assert.equal(created.data.run.total_net, 14_357_500);
});

test('a period can only have one payroll run', async () => {
  const duplicate = await call('POST', '/api/payroll/runs', { period: '2026-11' });
  assert.equal(duplicate.status, 409);
});

test('bad period formats are rejected', async () => {
  const { status } = await call('POST', '/api/payroll/runs', { period: '2026-13' });
  assert.equal(status, 422);
});

test('completing a run issues payslips and locks it', async () => {
  const completed = await call('POST', '/api/payroll/runs/1/complete');
  assert.equal(completed.status, 200);
  assert.equal(completed.data.run.status, 'completed');
  assert.ok(completed.data.run.completed_at);
  assert.equal(completed.data.payslips.length, 2);

  const again = await call('POST', '/api/payroll/runs/1/complete');
  assert.equal(again.status, 409);
});

test('employee detail now carries the completed payslip', async () => {
  const { status, data } = await call('GET', '/api/employees/1');
  assert.equal(status, 200);
  assert.equal(data.contract.base_salary, 8_500_000);
  assert.equal(data.payslips.length, 1);
  assert.equal(data.payslips[0].net_pay, 8_672_500);
  assert.equal(data.payslips[0].run_status, 'completed');
});

test('attendance cannot exceed the working days', async () => {
  const { status } = await call('PUT', '/api/employees/1/attendance', {
    period: '2026-12',
    working_days: 20,
    present_days: 18,
    paid_leave_days: 2,
    unpaid_leave_days: 1,
  });
  assert.equal(status, 422);
});

test('the rendered pages expose the demo flow', async () => {
  const dashboard = await call('GET', '/');
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.text, /Payroll demo/);
  assert.match(dashboard.text, /Ayu Prameswari/);

  const employee = await call('GET', '/employees/1');
  assert.equal(employee.status, 200);
  assert.match(employee.text, /EMP-0001/);
  assert.match(employee.text, /Rp 8\.672\.500/);

  const run = await call('GET', '/payroll/1');
  assert.equal(run.status, 200);
  assert.match(run.text, /Payroll completed/);
  assert.match(run.text, /\/payslips\/\d+/);

  const missing = await call('GET', '/employees/999');
  assert.equal(missing.status, 404);
});

test('salary inputs do not silently reject ordinary rupiah amounts', async () => {
  const employee = await call('GET', '/employees/1');
  assert.equal(employee.status, 200);

  const salaryInput = employee.text.match(/<input id="base_salary"[^>]*>/)[0];
  const allowanceInput = employee.text.match(/<input id="allowance"[^>]*>/)[0];

  // step="1000" with min="1" makes the browser treat 8,500,000 as a step
  // mismatch, blocking submit before the request is ever sent.
  for (const input of [salaryInput, allowanceInput]) {
    assert.match(input, /step="any"/);
    assert.doesNotMatch(input, /step="1000"/);
  }
});

test('a payslip has API and printable pages', async () => {
  const api = await call('GET', '/api/payslips/1');
  assert.equal(api.status, 200);
  assert.equal(api.data.payslip.employee_no, 'EMP-0001');
  assert.equal(api.data.payslip.period, '2026-11');
  assert.equal(api.data.payslip.run_status, 'completed');
  assert.equal(api.data.payslip.net_pay, 8_672_500);
  assert.equal(api.data.payslip.bpjs_kesehatan + api.data.payslip.bpjs_jht + api.data.payslip.bpjs_jp, 340_000);

  const page = await call('GET', '/payslips/1');
  assert.equal(page.status, 200);
  assert.match(page.text, /Payslip/);
  assert.match(page.text, /Ayu Prameswari/);
  assert.match(page.text, /EMP-0001/);
  assert.match(page.text, /Rp 8\.672\.500/);
  assert.match(page.text, /Take-home pay/);
  assert.match(page.text, /@media print/);
  assert.match(page.text, /Print \/ save PDF/);

  const missingApi = await call('GET', '/api/payslips/999');
  assert.equal(missingApi.status, 404);

  const missingPage = await call('GET', '/payslips/999');
  assert.equal(missingPage.status, 404);
});

test('CSV escaping quotes fields that need it', () => {
  const csv = toCsv(['name', 'note'], [["O'Brien, Sari", 'a "quoted" note']]);
  assert.equal(csv, '\uFEFFname,note\r\n"O\'Brien, Sari","a ""quoted"" note"\r\n');
});

test('CSV exports cover runs and payslips', async () => {
  const runs = await call('GET', '/payroll/export.csv');
  assert.equal(runs.status, 200);
  assert.match(runs.headers['content-type'], /text\/csv/);
  assert.match(runs.headers['content-disposition'], /payroll-runs\.csv/);

  const runLines = runs.text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  assert.equal(
    runLines[0],
    'period,status,employees,gross,net,thr,employer_contribution,employer_cost,created_at,completed_at',
  );
  assert.ok(runLines.some((line) => line.startsWith('2026-11,completed,2,')));

  const payslips = await call('GET', '/payroll/1/export.csv');
  assert.equal(payslips.status, 200);
  assert.match(payslips.headers['content-disposition'], /payroll-payslips-2026-11\.csv/);

  const lines = payslips.text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  assert.match(lines[0], /^period,employee_no,full_name,bank_account,/);

  const ayu = lines.find((line) => line.startsWith('2026-11,EMP-0001,'));
  assert.ok(ayu, 'payslip row for EMP-0001');
  assert.ok(ayu.includes('BCA 1234567890'));
  assert.ok(ayu.includes(',8672500,'));
  assert.ok(ayu.includes('PAY-2026-11-EMP-0001'));

  const missing = await call('GET', '/payroll/999/export.csv');
  assert.equal(missing.status, 404);
});

test('THR and employer contributions are included when requested', async () => {
  const hired = await call('POST', '/api/employees', {
    full_name: 'Citra Halim',
    join_date: '2026-01-01',
    ptkp_status: 'TK/0',
  });
  assert.equal(hired.status, 201);
  const employeeId = hired.data.employee.id;
  const employeeNo = hired.data.employee.employee_no;

  const contract = await call('POST', `/api/employees/${employeeId}/contracts`, {
    base_salary: 6_000_000,
    effective_from: '2026-01-01',
  });
  assert.equal(contract.status, 201);

  for (const id of [1, 2, employeeId]) {
    const recorded = await call('PUT', `/api/employees/${id}/attendance`, {
      period: '2027-01',
      working_days: 22,
      present_days: 22,
    });
    assert.equal(recorded.status, 200);
  }

  const created = await call('POST', '/api/payroll/runs', {
    period: '2027-01',
    include_thr: true,
  });
  assert.equal(created.status, 201);

  const citra = created.data.payslips.find((slip) => slip.employee_no === employeeNo);
  assert.equal(citra.thr_amount, 6_000_000);
  assert.equal(citra.gross, 12_000_000);
  assert.equal(citra.pph21, 625_000);
  assert.equal(citra.net_pay, 11_135_000);
  assert.equal(citra.employer_total, 614_400);

  const run = created.data.run;
  assert.equal(
    run.total_thr,
    created.data.payslips.reduce((sum, slip) => sum + slip.thr_amount, 0),
  );
  assert.equal(
    run.total_employer_contribution,
    created.data.payslips.reduce((sum, slip) => sum + slip.employer_total, 0),
  );
  assert.equal(run.total_employer_cost, run.total_gross + run.total_employer_contribution);

  const page = await call('GET', `/payslips/${citra.id}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /THR \(holiday allowance\)/);
  assert.match(page.text, /Employer contributions/);
  assert.match(page.text, /Rp 11\.135\.000/);

  const runPage = await call('GET', '/payroll/2');
  assert.equal(runPage.status, 200);
  assert.match(runPage.text, /Employer cost/);
});

test('the HTML form flow creates an employee and redirects', async () => {
  const response = await fetch(`${base}/employees`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ full_name: 'Dewi Lestari', join_date: '2026-11-20' }),
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  assert.match(response.headers.get('location'), /^\/employees\/\d+\?created=1$/);
});

test('a date the calendar does not have is rejected', async () => {
  // 2026-02-31 parses as March 3, so format-only validation stored it verbatim.
  const badJoin = await call('POST', '/api/employees', {
    full_name: 'Impossible Date',
    join_date: '2026-02-31',
  });
  assert.equal(badJoin.status, 422);
  assert.match(badJoin.data.error, /join_date is not a valid date/);

  const badContract = await call('POST', '/api/employees/1/contracts', {
    base_salary: 5_000_000,
    effective_from: '2026-04-31',
  });
  assert.equal(badContract.status, 422);
  assert.match(badContract.data.error, /effective_from is not a valid date/);

  const nonLeap = await call('POST', '/api/employees/1/contracts', {
    base_salary: 5_000_000,
    effective_from: '2027-02-29',
  });
  assert.equal(nonLeap.status, 422);

  // A leap day that exists must still be accepted.
  const leap = await call('POST', '/api/employees/1/contracts', {
    base_salary: 5_000_000,
    effective_from: '2028-02-29',
  });
  assert.equal(leap.status, 201);
  assert.equal(leap.data.contract.effective_from, '2028-02-29');
});
