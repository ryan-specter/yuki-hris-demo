import { PTKP_STATUSES } from './payroll.js';

const CSS = `
:root {
  --ink: #101828;
  --muted: #667085;
  --line: #e4e7ec;
  --bg: #f7f8fa;
  --card: #ffffff;
  --brand: #1d4ed8;
  --brand-soft: #eef2ff;
  --ok: #067647;
  --ok-soft: #ecfdf3;
  --warn: #b54708;
  --warn-soft: #fffaeb;
  --danger: #b42318;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ink);
  background: var(--bg);
}
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
.shell { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh; }
.sidebar {
  background: #0b1220;
  color: #c7d0de;
  padding: 22px 16px;
  display: flex;
  flex-direction: column;
  gap: 26px;
}
.brand { color: #fff; font-weight: 650; letter-spacing: -0.01em; line-height: 1.3; }
.brand span { display: block; font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: #7f8da3; margin-top: 6px; }
nav { display: flex; flex-direction: column; gap: 2px; }
nav a { color: #c7d0de; padding: 8px 10px; border-radius: 8px; font-weight: 500; }
nav a:hover { background: #16203a; text-decoration: none; color: #fff; }
nav a.active { background: #1c2b4d; color: #fff; }
.sidebar footer { margin-top: auto; font-size: 12px; color: #7f8da3; }
main { padding: 30px 36px 60px; max-width: 1080px; }
h1 { font-size: 24px; letter-spacing: -0.02em; margin: 0 0 6px; }
h2 { font-size: 15px; margin: 0 0 14px; }
h3 { font-size: 13px; margin: 0 0 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.lede { color: var(--muted); margin: 0 0 24px; max-width: 68ch; }
.topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; margin-bottom: 18px; }
.grid { display: grid; gap: 16px; }
.grid.cols-2 { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
.grid.cols-4 { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; }
.stat b { display: block; font-size: 24px; letter-spacing: -0.02em; margin-top: 4px; }
.stat span { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; }
tbody tr:last-child td { border-bottom: none; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.pill { display: inline-block; font-size: 11px; font-weight: 650; padding: 2px 9px; border-radius: 999px; letter-spacing: .02em; }
.pill.ok { color: var(--ok); background: var(--ok-soft); }
.pill.draft { color: var(--warn); background: var(--warn-soft); }
.pill.idle { color: var(--muted); background: #f2f4f7; }
form { margin: 0; }
.field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
.field label { font-size: 12px; font-weight: 600; color: #344054; }
.field .hint { font-size: 11px; color: var(--muted); font-weight: 400; }
input, select {
  font: inherit;
  padding: 8px 10px;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  background: #fff;
  color: var(--ink);
  width: 100%;
}
input:focus, select:focus { outline: 2px solid #bfd3ff; border-color: var(--brand); }
.row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0 12px; }
button, .btn {
  font: inherit; font-weight: 600; cursor: pointer;
  background: var(--brand); color: #fff; border: 0; border-radius: 8px;
  padding: 9px 14px; display: inline-block;
}
button:hover, .btn:hover { background: #1a43bd; text-decoration: none; }
.btn.secondary { background: #fff; color: #344054; border: 1px solid #d0d5dd; }
.btn.secondary:hover { background: #f9fafb; }
.btn.small { padding: 6px 10px; font-size: 12px; }
.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.steps li { display: flex; align-items: center; gap: 12px; }
.steps .dot { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; background: #f2f4f7; color: var(--muted); flex: none; }
.steps .done .dot { background: var(--ok-soft); color: var(--ok); }
.steps .label { flex: 1; }
.steps .label small { display: block; color: var(--muted); }
.flash { background: var(--ok-soft); border: 1px solid #abefc6; color: var(--ok); padding: 10px 14px; border-radius: 10px; margin-bottom: 16px; font-weight: 500; }
.error { background: #fef3f2; border: 1px solid #fecdca; color: var(--danger); padding: 10px 14px; border-radius: 10px; margin-bottom: 16px; }
.empty { color: var(--muted); padding: 18px 0; }
.kv { display: grid; grid-template-columns: 130px 1fr; gap: 6px 14px; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; }
.metrics { display: grid; grid-template-columns: 1fr auto; gap: 4px 16px; }
.metrics dt { color: var(--muted); }
.metrics dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.metrics .total { font-weight: 700; border-top: 1px solid var(--line); padding-top: 8px; margin-top: 6px; }
.muted { color: var(--muted); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
hr { border: 0; border-top: 1px solid var(--line); margin: 18px 0; }
@media (max-width: 760px) {
  .shell { grid-template-columns: 1fr; }
  .sidebar { flex-direction: row; align-items: center; gap: 14px; padding: 12px; overflow-x: auto; }
  .sidebar footer, .brand span { display: none; }
  nav { flex-direction: row; }
  main { padding: 20px 16px 40px; }
}
`;

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export const rp = (amount) =>
  `Rp ${Number(amount || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;

export function layout({ title, active = '', body, extraCss = '' }) {
  const link = (href, label, key) =>
    `<a href="${href}"${active === key ? ' class="active"' : ''}>${label}</a>`;
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Yuki Tera Workforce</title>
<style>${CSS}${extraCss}</style>
</head>
<body>
<div class="shell">
  <aside class="sidebar">
    <div class="brand">Yuki Tera Workforce<span>Demo HRIS</span></div>
    <nav>
      ${link('/', 'Dashboard', 'dashboard')}
      ${link('/employees', 'Employees', 'employees')}
      ${link('/payroll', 'Payroll', 'payroll')}
    </nav>
    <footer>Demo data · rupiah payroll</footer>
  </aside>
  <main>${body}</main>
</div>
</body>
</html>`;
}

export function dashboardPage({ stats, employees }) {
  const steps = [
    { done: stats.employees > 0, title: 'Create the new employee', hint: 'Employee number, position, PTKP status', href: '/employees/new' },
    { done: stats.contracts > 0, title: 'Set the salary contract', hint: 'Base salary and fixed allowance', href: '/employees' },
    { done: stats.attendance > 0, title: 'Record attendance', hint: 'Working days, leave, overtime', href: '/employees' },
    { done: stats.completedRuns > 0, title: 'Run and complete payroll', hint: 'Gross, BPJS, PPh 21, net pay', href: '/payroll' },
  ];
  const doneCount = steps.filter((step) => step.done).length;

  return layout({
    title: 'Dashboard',
    active: 'dashboard',
    body: `
    <div class="topbar">
      <div>
        <h1>Payroll demo</h1>
        <p class="lede">Onboard an employee, capture a month of attendance, and complete a payroll run that issues payslips. Everything is computed locally and stored in SQLite.</p>
      </div>
      <a class="btn" href="/employees/new">New employee</a>
    </div>

    <div class="grid cols-4">
      <div class="stat"><span>Employees</span><b>${stats.employees}</b></div>
      <div class="stat"><span>Contracts</span><b>${stats.contracts}</b></div>
      <div class="stat"><span>Attendance rows</span><b>${stats.attendance}</b></div>
      <div class="stat"><span>Completed runs</span><b>${stats.completedRuns}</b></div>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <h2>Employee → payroll</h2>
        <ul class="steps">
          ${steps
            .map(
              (step, index) => `<li class="${step.done ? 'done' : ''}">
            <span class="dot">${step.done ? '✓' : index + 1}</span>
            <span class="label"><a href="${step.href}">${esc(step.title)}</a><small>${esc(step.hint)}</small></span>
            <span class="pill ${step.done ? 'ok' : 'idle'}">${step.done ? 'Done' : 'Pending'}</span>
          </li>`,
            )
            .join('')}
        </ul>
        <hr>
        <p class="muted" style="margin:0">${doneCount} of ${steps.length} steps complete.</p>
      </div>

      <div class="card">
        <h2>Latest payroll run</h2>
        ${
          stats.lastRun
            ? `<dl class="kv">
                 <dt>Period</dt><dd>${esc(stats.lastRun.period)}</dd>
                 <dt>Status</dt><dd><span class="pill ${stats.lastRun.status === 'completed' ? 'ok' : 'draft'}">${esc(stats.lastRun.status)}</span></dd>
                 <dt>Gross</dt><dd>${rp(stats.lastRun.total_gross)}</dd>
                 <dt>Net</dt><dd>${rp(stats.lastRun.total_net)}</dd>
               </dl>
               <p style="margin:14px 0 0"><a href="/payroll/${stats.lastRun.id}">Open run →</a></p>`
            : `<p class="empty">No payroll run yet. Create one from the Payroll page once attendance is in.</p>`
        }
      </div>
    </div>

    <div class="card">
      <div class="topbar" style="align-items:center">
        <h2 style="margin:0">Employees</h2>
        <a class="btn secondary small" href="/employees">View all</a>
      </div>
      ${
        employees.length
          ? `<table>
              <thead><tr><th>No.</th><th>Name</th><th>Position</th><th class="num">Base salary</th><th>Status</th></tr></thead>
              <tbody>${employees
                .slice(0, 8)
                .map(
                  (employee) => `<tr>
                    <td class="mono">${esc(employee.employee_no)}</td>
                    <td><a href="/employees/${employee.id}">${esc(employee.full_name)}</a></td>
                    <td>${esc(employee.position || '—')}</td>
                    <td class="num">${employee.base_salary ? rp(employee.base_salary) : '—'}</td>
                    <td><span class="pill ${employee.status === 'active' ? 'ok' : 'idle'}">${esc(employee.status)}</span></td>
                  </tr>`,
                )
                .join('')}</tbody>
            </table>`
          : `<p class="empty">No employees yet. <a href="/employees/new">Create the first one</a>.</p>`
      }
    </div>`,
  });
}

export function employeesPage({ employees, flash }) {
  return layout({
    title: 'Employees',
    active: 'employees',
    body: `
    ${flash ? `<div class="flash">${esc(flash)}</div>` : ''}
    <div class="topbar">
      <div>
        <h1>Employees</h1>
        <p class="lede">Every employee is created with an employee number, a PTKP tax status, and a salary contract.</p>
      </div>
      <a class="btn" href="/employees/new">New employee</a>
    </div>
    <div class="card">
      ${
        employees.length
          ? `<table>
              <thead><tr><th>No.</th><th>Name</th><th>Department</th><th>Joined</th><th class="num">Base salary</th><th class="num">Allowance</th></tr></thead>
              <tbody>${employees
                .map(
                  (employee) => `<tr>
                    <td class="mono">${esc(employee.employee_no)}</td>
                    <td><a href="/employees/${employee.id}">${esc(employee.full_name)}</a><div class="muted" style="font-size:12px">${esc(employee.email || '')}</div></td>
                    <td>${esc(employee.department || '—')}</td>
                    <td>${esc(employee.join_date)}</td>
                    <td class="num">${employee.base_salary ? rp(employee.base_salary) : '—'}</td>
                    <td class="num">${employee.base_salary ? rp(employee.allowance) : '—'}</td>
                  </tr>`,
                )
                .join('')}</tbody>
            </table>`
          : `<p class="empty">No employees yet.</p>`
      }
    </div>`,
  });
}

export function employeeFormPage({ error } = {}) {
  const options = Object.keys(PTKP_STATUSES)
    .map((status) => `<option value="${status}">${status} · PTKP ${rp(PTKP_STATUSES[status])}</option>`)
    .join('');
  return layout({
    title: 'New employee',
    active: 'employees',
    body: `
    <h1>New employee</h1>
    <p class="lede">Step 1 of the demo. The employee number is generated automatically.</p>
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    <form class="card" method="post" action="/employees">
      <div class="row">
        <div class="field">
          <label for="full_name">Full name</label>
          <input id="full_name" name="full_name" required maxlength="120" placeholder="Ayu Prameswari">
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" placeholder="ayu@example.com">
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="position">Position</label>
          <input id="position" name="position" placeholder="Payroll Analyst">
        </div>
        <div class="field">
          <label for="department">Department</label>
          <input id="department" name="department" placeholder="People Operations">
        </div>
        <div class="field">
          <label for="join_date">Join date</label>
          <input id="join_date" name="join_date" type="date">
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="ptkp_status">PTKP status <span class="hint">annual tax-free allowance</span></label>
          <select id="ptkp_status" name="ptkp_status">${options}</select>
        </div>
        <div class="field">
          <label for="npwp">NPWP <span class="hint">optional</span></label>
          <input id="npwp" name="npwp" placeholder="09.123.456.7-001.000">
        </div>
        <div class="field">
          <label for="bank_account">Bank account <span class="hint">optional</span></label>
          <input id="bank_account" name="bank_account" placeholder="BCA 1234567890">
        </div>
      </div>
      <div class="actions">
        <button type="submit">Create employee</button>
        <a class="btn secondary" href="/employees">Cancel</a>
      </div>
    </form>`,
  });
}

export function employeePage({ detail, flash, error, defaultPeriod }) {
  const { employee, contracts, attendance, payslips, contract } = detail;
  const today = new Date().toISOString().slice(0, 10);

  const contractForm = `
    <form method="post" action="/employees/${employee.id}/contract">
      <div class="row">
        <div class="field">
          <label for="base_salary">Base salary (Rp)</label>
          <input id="base_salary" name="base_salary" type="number" min="1" step="1000" required placeholder="8500000">
        </div>
        <div class="field">
          <label for="allowance">Fixed allowance (Rp)</label>
          <input id="allowance" name="allowance" type="number" min="0" step="1000" value="0">
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="effective_from">Effective from</label>
          <input id="effective_from" name="effective_from" type="date" value="${contract ? today : employee.join_date}">
        </div>
        <div class="field">
          <label for="effective_to">Effective to <span class="hint">optional</span></label>
          <input id="effective_to" name="effective_to" type="date">
        </div>
      </div>
      <button type="submit" class="small">Save contract</button>
    </form>`;

  const attendanceForm = `
    <form method="post" action="/employees/${employee.id}/attendance">
      <div class="row">
        <div class="field">
          <label for="period">Period</label>
          <input id="period" name="period" type="month" value="${esc(defaultPeriod)}" required>
        </div>
        <div class="field">
          <label for="working_days">Working days</label>
          <input id="working_days" name="working_days" type="number" min="1" max="31" value="22" required>
        </div>
        <div class="field">
          <label for="present_days">Present days</label>
          <input id="present_days" name="present_days" type="number" min="0" max="31" value="22" required>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="paid_leave_days">Paid leave</label>
          <input id="paid_leave_days" name="paid_leave_days" type="number" min="0" max="31" value="0">
        </div>
        <div class="field">
          <label for="unpaid_leave_days">Unpaid leave</label>
          <input id="unpaid_leave_days" name="unpaid_leave_days" type="number" min="0" max="31" value="0">
        </div>
        <div class="field">
          <label for="overtime_hours">Overtime hours</label>
          <input id="overtime_hours" name="overtime_hours" type="number" min="0" max="300" step="0.5" value="0">
        </div>
      </div>
      <button type="submit" class="small">Save attendance</button>
    </form>`;

  return layout({
    title: employee.full_name,
    active: 'employees',
    body: `
    <p class="muted" style="margin:0 0 6px"><a href="/employees">← Employees</a></p>
    <div class="topbar">
      <div>
        <h1>${esc(employee.full_name)}</h1>
        <p class="lede" style="margin-bottom:8px">
          <span class="mono">${esc(employee.employee_no)}</span> ·
          ${esc(employee.position || 'No position')} ·
          ${esc(employee.department || 'No department')}
        </p>
      </div>
      <span class="pill ${employee.status === 'active' ? 'ok' : 'idle'}">${esc(employee.status)}</span>
    </div>
    ${flash ? `<div class="flash">${esc(flash)}</div>` : ''}
    ${error ? `<div class="error">${esc(error)}</div>` : ''}

    <div class="grid cols-2">
      <div class="card">
        <h2>Employment</h2>
        <dl class="kv">
          <dt>Join date</dt><dd>${esc(employee.join_date)}</dd>
          <dt>Email</dt><dd>${esc(employee.email || '—')}</dd>
          <dt>PTKP</dt><dd>${esc(employee.ptkp_status)} · ${rp(PTKP_STATUSES[employee.ptkp_status] || 0)}</dd>
          <dt>NPWP</dt><dd>${esc(employee.npwp || '—')}</dd>
          <dt>Bank</dt><dd>${esc(employee.bank_account || '—')}</dd>
        </dl>
        <hr>
        <h3>Current contract</h3>
        ${
          contract
            ? `<dl class="kv">
                 <dt>Base salary</dt><dd>${rp(contract.base_salary)}</dd>
                 <dt>Allowance</dt><dd>${rp(contract.allowance)}</dd>
                 <dt>Effective</dt><dd>${esc(contract.effective_from)} → ${esc(contract.effective_to || 'open')}</dd>
               </dl>`
            : `<p class="empty" style="padding:0 0 8px">No contract yet. Payroll cannot include this employee until one is saved.</p>`
        }
        <hr>
        <h3>${contract ? 'Add a new contract' : 'Set the salary contract'}</h3>
        ${contractForm}
      </div>

      <div class="card" id="attendance">
        <h2>Attendance</h2>
        <p class="muted" style="margin-top:-6px">A payroll run needs one attendance row per employee for the period.</p>
        ${attendanceForm}
        <hr>
        ${
          attendance.length
            ? `<table>
                <thead><tr><th>Period</th><th class="num">Work</th><th class="num">Present</th><th class="num">Leave</th><th class="num">OT</th></tr></thead>
                <tbody>${attendance
                  .map(
                    (row) => `<tr>
                      <td>${esc(row.period)}</td>
                      <td class="num">${row.working_days}</td>
                      <td class="num">${row.present_days}</td>
                      <td class="num">${row.paid_leave_days + row.unpaid_leave_days}</td>
                      <td class="num">${row.overtime_hours}</td>
                    </tr>`,
                  )
                  .join('')}</tbody>
              </table>`
            : `<p class="empty">No attendance recorded yet.</p>`
        }
      </div>
    </div>

    <div class="card">
      <h2>Payslips</h2>
      ${
        payslips.length
          ? `<table>
              <thead><tr><th>Period</th><th class="num">Gross</th><th class="num">BPJS + PPh 21</th><th class="num">Net pay</th><th>Run</th></tr></thead>
              <tbody>${payslips
                .map(
                  (row) => `<tr>
                    <td><a href="/payslips/${row.id}">${esc(row.period)}</a></td>
                    <td class="num">${rp(row.gross)}</td>
                    <td class="num">${rp(row.total_deductions)}</td>
                    <td class="num"><b>${rp(row.net_pay)}</b></td>
                    <td><a href="/payroll/${row.run_id}">${esc(row.run_status)}</a></td>
                  </tr>`,
                )
                .join('')}</tbody>
            </table>`
          : `<p class="empty">No payslips yet. Record attendance, then run payroll.</p>`
      }
    </div>

    ${
      contracts.length > 1
        ? `<div class="card">
             <h2>Contract history</h2>
             <table>
               <thead><tr><th>Effective from</th><th>Effective to</th><th class="num">Base</th><th class="num">Allowance</th></tr></thead>
               <tbody>${contracts
                 .map(
                   (row) => `<tr>
                     <td>${esc(row.effective_from)}</td>
                     <td>${esc(row.effective_to || 'open')}</td>
                     <td class="num">${rp(row.base_salary)}</td>
                     <td class="num">${rp(row.allowance)}</td>
                   </tr>`,
                 )
                 .join('')}</tbody>
             </table>
           </div>`
        : ''
    }`,
  });
}

export function payrollPage({ runs, employeesReady, flash, error, defaultPeriod }) {
  return layout({
    title: 'Payroll',
    active: 'payroll',
    body: `
    ${flash ? `<div class="flash">${esc(flash)}</div>` : ''}
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    <div class="topbar">
      <div>
        <h1>Payroll</h1>
        <p class="lede">A run snapshots attendance and contracts for one period and issues a payslip per employee. Completing it locks the run.</p>
      </div>
      <a class="btn secondary" href="/payroll/export.csv">Export runs CSV</a>
    </div>

    <div class="card">
      <h2>Start a payroll run</h2>
      ${employeesReady ? '' : '<p class="muted" style="margin-top:-6px">At least one active employee needs a contract and attendance before a run can be created.</p>'}
      <form method="post" action="/payroll/runs" class="actions">
        <input name="period" type="month" value="${esc(defaultPeriod)}" required style="max-width:200px">
        <label style="display:flex;gap:6px;align-items:center;font-size:13px;color:#344054">
          <input type="checkbox" name="include_thr" value="1" style="width:auto"> Include THR
        </label>
        <button type="submit">Create run</button>
      </form>
      <p class="muted" style="margin:10px 0 0;font-size:12px">THR pays one month of base plus fixed allowance after 12 months of service, prorated by completed months, and is added to gross without changing the BPJS base.</p>
    </div>

    <div class="card">
      <h2>Runs</h2>
      ${
        runs.length
          ? `<table>
              <thead><tr><th>Period</th><th>Status</th><th class="num">Employees</th><th class="num">Gross</th><th class="num">Net</th><th>Created</th></tr></thead>
              <tbody>${runs
                .map(
                  (run) => `<tr>
                    <td><a href="/payroll/${run.id}">${esc(run.period)}</a></td>
                    <td><span class="pill ${run.status === 'completed' ? 'ok' : 'draft'}">${esc(run.status)}</span></td>
                    <td class="num">${run.employee_count}</td>
                    <td class="num">${rp(run.total_gross)}</td>
                    <td class="num">${rp(run.total_net)}</td>
                    <td class="muted">${esc((run.created_at || '').slice(0, 10))}</td>
                  </tr>`,
                )
                .join('')}</tbody>
            </table>`
          : `<p class="empty">No runs yet.</p>`
      }
    </div>`,
  });
}

export function runPage({ detail, flash, error }) {
  const { run, payslips } = detail;
  const completed = run.status === 'completed';
  return layout({
    title: `Payroll ${run.period}`,
    active: 'payroll',
    body: `
    <p class="muted" style="margin:0 0 6px"><a href="/payroll">← Payroll</a></p>
    ${flash ? `<div class="flash">${esc(flash)}</div>` : ''}
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    <div class="topbar">
      <div>
        <h1>Payroll ${esc(run.period)}</h1>
        <p class="lede" style="margin-bottom:8px">${payslips.length} payslip${payslips.length === 1 ? '' : 's'} · created ${esc((run.created_at || '').slice(0, 10))}${completed ? ` · completed ${esc((run.completed_at || '').slice(0, 10))}` : ''}</p>
      </div>
      <span class="pill ${completed ? 'ok' : 'draft'}">${esc(run.status)}</span>
    </div>

    <div class="grid cols-4">
      <div class="stat"><span>Employees</span><b>${payslips.length}</b></div>
      <div class="stat"><span>Gross</span><b style="font-size:19px">${rp(run.total_gross)}</b></div>
      <div class="stat"><span>Net</span><b style="font-size:19px">${rp(run.total_net)}</b></div>
      <div class="stat"><span>THR</span><b style="font-size:19px">${rp(run.total_thr)}</b></div>
      <div class="stat"><span>Employer BPJS</span><b style="font-size:19px">${rp(run.total_employer_contribution)}</b></div>
      <div class="stat"><span>Employer cost</span><b style="font-size:19px">${rp(run.total_employer_cost)}</b></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="topbar" style="align-items:center">
        <h2 style="margin:0">Payslips</h2>
        <div class="actions">
          <a class="btn secondary" href="/payroll/${run.id}/export.csv">Export payslips CSV</a>
          ${
            completed
              ? `<span class="pill ok">Payroll completed</span>`
              : `<form method="post" action="/payroll/runs/${run.id}/complete"><button type="submit">Complete payroll</button></form>`
          }
        </div>
      </div>
      ${
        payslips.length
          ? `<table>
              <thead><tr>
                <th>Employee</th><th class="num">Base</th><th class="num">Allowance</th><th class="num">Overtime</th>
                <th class="num">THR</th>
                <th class="num">Gross</th><th class="num">BPJS</th><th class="num">PPh 21</th><th class="num">Net</th>
              </tr></thead>
              <tbody>${payslips
                .map(
                  (row) => `<tr>
                    <td><a href="/employees/${row.employee_id}">${esc(row.full_name)}</a><div class="muted mono">${esc(row.employee_no)}</div><div><a href="/payslips/${row.id}">Payslip →</a></div></td>
                    <td class="num">${rp(row.prorated_base)}</td>
                    <td class="num">${rp(row.allowance)}</td>
                    <td class="num">${rp(row.overtime_pay)}</td>
                    <td class="num">${rp(row.thr_amount)}</td>
                    <td class="num">${rp(row.gross)}</td>
                    <td class="num">${rp(row.bpjs_kesehatan + row.bpjs_jht + row.bpjs_jp)}</td>
                    <td class="num">${rp(row.pph21)}</td>
                    <td class="num"><b>${rp(row.net_pay)}</b></td>
                  </tr>`,
                )
                .join('')}</tbody>
            </table>
            <p class="muted" style="margin:14px 0 0">BPJS column combines employee Kesehatan 1%, JHT 2% and JP 1% of the prorated base. PPh 21 is the annual progressive tax spread over 12 months. Employer contributions (Kesehatan 4%, JHT 3.7%, JP 2%, JKK 0.24%, JKM 0.30%) are company cost and are not deducted from net pay.</p>`
          : `<p class="empty">No payslips in this run.</p>`
      }
    </div>`,
  });
}

const PRINT_CSS = `
@media print {
  .sidebar, .no-print { display: none !important; }
  .shell { display: block; }
  main { padding: 0; max-width: none; }
  body { background: #fff; }
  .card { border-color: #cfd4dc; break-inside: avoid; }
}
`;

export function payslipPage({ payslip: slip }) {
  const absentDays = Math.max(
    0,
    slip.working_days - slip.present_days - slip.paid_leave_days - slip.unpaid_leave_days,
  );
  const unpaidDays = slip.unpaid_leave_days + absentDays;
  const absenceDeduction = Math.max(0, slip.base_salary - slip.prorated_base);
  const issued = (slip.completed_at || '').slice(0, 10) || 'draft';

  const line = (label, value, cls = '') =>
    `<tr><th style="text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink);font-weight:500">${label}</th><td class="num ${cls}">${value}</td></tr>`;

  return layout({
    title: `Payslip ${slip.period}`,
    active: 'payroll',
    extraCss: PRINT_CSS,
    body: `
    <div class="topbar no-print" style="align-items:center">
      <p class="muted" style="margin:0"><a href="/payroll/${slip.run_id}">← Payroll ${esc(slip.period)}</a></p>
      <button type="button" onclick="window.print()">Print / save PDF</button>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="topbar">
        <div>
          <h1 style="margin-bottom:2px">Payslip</h1>
          <p class="muted" style="margin:0">Yuki Tera Workforce · period ${esc(slip.period)}</p>
        </div>
        <span class="pill ${slip.run_status === 'completed' ? 'ok' : 'draft'}">${esc(slip.run_status)}</span>
      </div>

      <hr>

      <div class="grid cols-2">
        <div>
          <h3>Employee</h3>
          <dl class="kv">
            <dt>Name</dt><dd>${esc(slip.full_name)}</dd>
            <dt>Employee no.</dt><dd class="mono">${esc(slip.employee_no)}</dd>
            <dt>Position</dt><dd>${esc(slip.position || '—')}</dd>
            <dt>Department</dt><dd>${esc(slip.department || '—')}</dd>
            <dt>PTKP status</dt><dd>${esc(slip.ptkp_status)}</dd>
            <dt>Paid to</dt><dd>${esc(slip.bank_account || '—')}</dd>
          </dl>
        </div>
        <div>
          <h3>Attendance</h3>
          <dl class="kv">
            <dt>Working days</dt><dd>${slip.working_days}</dd>
            <dt>Present</dt><dd>${slip.present_days}</dd>
            <dt>Paid leave</dt><dd>${slip.paid_leave_days}</dd>
            <dt>Unpaid days</dt><dd>${unpaidDays}${absentDays ? ` (${absentDays} absent)` : ''}</dd>
            <dt>Overtime</dt><dd>${slip.overtime_hours} h</dd>
          </dl>
        </div>
      </div>

      <hr>

      <div class="grid cols-2">
        <div>
          <h3>Earnings</h3>
          <table>
            <tbody>
              ${line('Base salary', rp(slip.base_salary))}
              ${absenceDeduction ? line(`Absence deduction (${unpaidDays} day${unpaidDays === 1 ? '' : 's'})`, `−${rp(absenceDeduction)}`) : ''}
              ${line('Fixed allowance', rp(slip.allowance))}
              ${line(`Overtime (${slip.overtime_hours} h × 1.5)`, slip.overtime_pay ? rp(slip.overtime_pay) : '—')}
              ${slip.thr_amount ? line('THR (holiday allowance)', rp(slip.thr_amount)) : ''}
              ${line('<b>Gross earnings</b>', rp(slip.gross))}
            </tbody>
          </table>
        </div>
        <div>
          <h3>Deductions</h3>
          <table>
            <tbody>
              ${line('BPJS Kesehatan (1%)', rp(slip.bpjs_kesehatan))}
              ${line('BPJS JHT (2%)', rp(slip.bpjs_jht))}
              ${line('BPJS JP (1%)', rp(slip.bpjs_jp))}
              ${line('PPh 21', rp(slip.pph21))}
              ${slip.other_deduction ? line('Other deduction', rp(slip.other_deduction)) : ''}
              ${line('<b>Total deductions</b>', rp(slip.total_deductions))}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card" style="margin:0;background:#f9fafb;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
        <div>
          <div class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.06em">Take-home pay</div>
          <div style="font-size:13px" class="muted">${slip.working_days} working days · ${unpaidDays} unpaid</div>
        </div>
        <div style="font-size:26px;font-weight:700;letter-spacing:-0.02em">${rp(slip.net_pay)}</div>
      </div>

      ${slip.employer_total ? `
      <hr>
      <h3>Employer contributions · company cost, not deducted</h3>
      <table>
        <tbody>
          ${line('BPJS Kesehatan (4%)', rp(slip.employer_bpjs_kesehatan))}
          ${line('BPJS JHT (3.7%)', rp(slip.employer_bpjs_jht))}
          ${line('BPJS JP (2%)', rp(slip.employer_bpjs_jp))}
          ${line('BPJS JKK (0.24%)', rp(slip.employer_bpjs_jkk))}
          ${line('BPJS JKM (0.30%)', rp(slip.employer_bpjs_jkm))}
          ${line('<b>Total employer contributions</b>', rp(slip.employer_total))}
          ${line('<b>Total employer cost</b> · gross + contributions', rp(slip.gross + slip.employer_total))}
        </tbody>
      </table>` : ''}

      <p class="muted" style="margin:16px 0 0;font-size:12px">
        Demo payslip · run #${slip.run_id} · issued ${esc(issued)} · not a tax invoice.
      </p>
    </div>`,
  });
}

export function errorPage(status, message) {
  return layout({
    title: `Error ${status}`,
    body: `
    <h1>${status}</h1>
    <p class="lede">${esc(message)}</p>
    <p><a class="btn" href="/">Back to dashboard</a></p>`,
  });
}
