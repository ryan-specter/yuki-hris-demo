# Yuki Tera Workforce — demo HRIS

A small, dependency-free HRIS demo: create a new employee, give them a salary
contract, record a month of attendance, run payroll, and complete the run so
payslips are issued. Data lives in SQLite.

## Run it

```bash
cd hris-demo
npm start          # http://127.0.0.1:3000
npm test           # payroll unit tests + HTTP flow tests
```

Requires Node 24+ (developed on Node 26) because it uses the built-in
`node:sqlite` driver. There is nothing to install. GitHub Actions runs
`npm test` on every push to `main` and every pull request (`.github/workflows/ci.yml`).

Environment variables: `PORT` (default `3000`), `HOST` (default `127.0.0.1`),
`HRIS_DB` (default `data/hris.db`).

## The demo flow

1. **Employees → New employee.** The employee number is generated (`EMP-0001`,
   `EMP-0002`, …). PTKP status sets the annual tax-free allowance.
2. **Employee page → Set the salary contract.** Base salary and fixed
   allowance, with an effective date. Payroll only includes employees whose
   contract covers the period.
3. **Employee page → Attendance.** One row per employee per period: working
   days, present days, paid/unpaid leave, overtime hours.
4. **Payroll → Create run.** Pick a period (`YYYY-MM`). The run is created as a
   draft and refuses to start if any active employee is missing a contract or
   attendance for that period.
5. **Run page → Complete payroll.** Status moves from `draft` to `completed`,
   the completion timestamp is stored, and the run can no longer be completed
   again.

## Payroll rules (simplified and documented)

Money is stored as whole rupiah.

| Component | Rule |
| --- | --- |
| Daily rate | base salary ÷ working days |
| Absence deduction | daily rate × (unpaid leave + absent days) |
| Prorated base | base salary − absence deduction |
| Overtime | (base ÷ 173) × 1.5 × overtime hours |
| Gross | prorated base + fixed allowance + overtime |
| BPJS Kesehatan (employee) | 1% of prorated base, capped at Rp 12,000,000 |
| BPJS JHT (employee) | 2% of prorated base |
| BPJS JP (employee) | 1% of prorated base, capped at Rp 10,547,400 |
| PPh 21 | annual progressive tax on (gross × 12 − PTKP) ÷ 12 |
| Net pay | gross − all deductions |

PPh 21 brackets: 5% to Rp 60M, 15% to Rp 250M, 25% to Rp 500M, 30% to Rp 5B,
35% above. PTKP: TK/0 Rp 54M through K/3 Rp 72M.

This is a demo model, not a certified Indonesian payroll engine: it ignores
employer contributions, THR, BPJS Kesehatan family tiers, and the TER monthly
withholding table.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | liveness |
| `GET` | `/api/employees` | list employees |
| `POST` | `/api/employees` | create employee |
| `GET` | `/api/employees/:id` | employee, contracts, attendance, payslips |
| `POST` | `/api/employees/:id/contracts` | add a salary contract |
| `PUT` | `/api/employees/:id/attendance` | upsert attendance for a period |
| `GET` | `/api/payroll/runs` | list runs |
| `POST` | `/api/payroll/runs` | create a draft run for `{ period }` |
| `GET` | `/api/payroll/runs/:id` | run with payslips |
| `POST` | `/api/payroll/runs/:id/complete` | lock the run and issue payslips |

Example:

```bash
curl -s localhost:3000/api/employees -H 'content-type: application/json' -d '{
  "full_name": "Ayu Prameswari", "position": "Payroll Analyst",
  "join_date": "2026-11-02", "ptkp_status": "TK/0"
}'

curl -s localhost:3000/api/employees/1/contracts -H 'content-type: application/json' -d '{
  "base_salary": 8500000, "allowance": 750000, "effective_from": "2026-11-01"
}'

curl -s -X PUT localhost:3000/api/employees/1/attendance -H 'content-type: application/json' -d '{
  "period": "2026-11", "working_days": 22, "present_days": 22
}'

curl -s localhost:3000/api/payroll/runs -H 'content-type: application/json' -d '{"period":"2026-11"}'
curl -s -X POST localhost:3000/api/payroll/runs/1/complete
```

## Layout

```
src/payroll.js   pure calculation rules
src/db.js        SQLite schema
src/store.js     validation, contracts, attendance, payroll runs
src/views.js     server-rendered pages
src/server.js    HTTP routing (JSON API + HTML forms)
test/            unit and end-to-end tests
```
