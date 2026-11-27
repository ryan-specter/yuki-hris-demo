import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PTKP_STATUSES,
  annualIncomeTax,
  completedServiceMonths,
  computePayslip,
  computeThr,
  monthlyIncomeTax,
} from '../src/payroll.js';

const fullMonth = (overrides = {}) => ({
  workingDays: 22,
  presentDays: 22,
  paidLeaveDays: 0,
  unpaidLeaveDays: 0,
  overtimeHours: 0,
  ...overrides,
});

test('full attendance produces base plus allowance and employee deductions', () => {
  const slip = computePayslip({ baseSalary: 11_000_000, attendance: fullMonth() });

  assert.equal(slip.unpaidDays, 0);
  assert.equal(slip.proratedBase, 11_000_000);
  assert.equal(slip.gross, 11_000_000);
  assert.equal(slip.bpjsKesehatan, 110_000);
  assert.equal(slip.bpjsJht, 220_000);
  assert.equal(slip.bpjsJp, 105_474);
  assert.equal(slip.pph21, 475_000);
  assert.equal(slip.totalDeductions, 910_474);
  assert.equal(slip.netPay, 10_089_526);
  assert.equal(slip.netPay, slip.gross - slip.totalDeductions);
});

test('absent days are deducted at the daily rate', () => {
  const slip = computePayslip({
    baseSalary: 11_000_000,
    attendance: fullMonth({ presentDays: 20 }),
  });

  assert.equal(slip.unpaidDays, 2);
  assert.equal(slip.proratedBase, 10_000_000);
  assert.equal(slip.gross, 10_000_000);
  assert.equal(slip.pph21, 325_000);
  assert.equal(slip.netPay, 9_275_000);
  assert.equal(slip.netPay, slip.gross - slip.totalDeductions);
});

test('unpaid leave and absence accumulate into one deduction', () => {
  const combined = computePayslip({
    baseSalary: 11_000_000,
    attendance: fullMonth({ presentDays: 19, unpaidLeaveDays: 1 }),
  });
  const absentOnly = computePayslip({
    baseSalary: 11_000_000,
    attendance: fullMonth({ presentDays: 19, unpaidLeaveDays: 0 }),
  });

  assert.equal(combined.unpaidDays, 3);
  assert.equal(absentOnly.unpaidDays, 3);
  assert.equal(combined.proratedBase, absentOnly.proratedBase);
});

test('overtime is paid at 1.5x the hourly rate from base / 173', () => {
  const slip = computePayslip({
    baseSalary: 11_000_000,
    attendance: fullMonth({ overtimeHours: 10 }),
  });

  assert.equal(slip.overtimePay, 953_757);
  assert.equal(slip.gross, 11_953_757);
  assert.equal(slip.netPay, slip.gross - slip.totalDeductions);
});

test('BPJS contributions respect the salary caps', () => {
  const slip = computePayslip({ baseSalary: 20_000_000, attendance: fullMonth() });

  assert.equal(slip.bpjsKesehatan, 120_000);
  assert.equal(slip.bpjsJht, 400_000);
  assert.equal(slip.bpjsJp, 105_474);
});

test('progressive annual tax follows the brackets', () => {
  assert.equal(annualIncomeTax(0), 0);
  assert.equal(annualIncomeTax(54_000_000), 2_700_000);
  assert.equal(annualIncomeTax(600_000_000), 124_000_000);
  assert.equal(annualIncomeTax(6_000_000_000), 1_794_000_000);
});

test('monthly PPh 21 is the annual tax spread over twelve months', () => {
  assert.equal(monthlyIncomeTax(4_500_000), 0);
  assert.equal(monthlyIncomeTax(10_000_000), 325_000);
  assert.equal(monthlyIncomeTax(11_000_000), 475_000);
});

test('married PTKP status lowers withholding', () => {
  const single = computePayslip({ baseSalary: 11_000_000, attendance: fullMonth() });
  const married = computePayslip({
    baseSalary: 11_000_000,
    attendance: fullMonth(),
    ptkpStatus: 'K/2',
  });

  assert.ok(married.pph21 < single.pph21);
  assert.ok(married.netPay > single.netPay);
});

test('payslip totals always reconcile', () => {
  const cases = [
    { baseSalary: 5_000_000, allowance: 250_000, attendance: fullMonth({ presentDays: 21 }) },
    { baseSalary: 8_500_000, allowance: 750_000, attendance: fullMonth() },
    { baseSalary: 45_000_000, allowance: 5_000_000, attendance: fullMonth({ overtimeHours: 30 }) },
  ];

  for (const input of cases) {
    const slip = computePayslip(input);
    assert.equal(
      slip.netPay,
      slip.gross -
        (slip.bpjsKesehatan + slip.bpjsJht + slip.bpjsJp + slip.pph21 + slip.otherDeduction),
    );
    assert.ok(slip.netPay > 0);
  }
});

test('a month with no paid days produces no earnings and no deductions', () => {
  const slip = computePayslip({ baseSalary: 6_000_000, attendance: fullMonth({ presentDays: 0 }) });
  assert.equal(slip.proratedBase, 0);
  assert.equal(slip.gross, 0);
  assert.equal(slip.totalDeductions, 0);
  assert.equal(slip.netPay, 0);
});

test('service months count only complete months', () => {
  assert.equal(completedServiceMonths('2026-01-01', '2027-01'), 12);
  assert.equal(completedServiceMonths('2026-01-10', '2027-01'), 11);
  assert.equal(completedServiceMonths('2026-11-02', '2027-01'), 1);
  assert.equal(completedServiceMonths('2027-01-05', '2027-01'), 0);
});

test('THR is prorated by service and capped at one month', () => {
  assert.deepEqual(
    computeThr({ baseSalary: 6_000_000, joinDate: '2027-01-05', period: '2027-01' }),
    { months: 0, amount: 0 },
  );
  assert.equal(
    computeThr({ baseSalary: 6_000_000, joinDate: '2026-01-10', period: '2027-01' }).amount,
    5_500_000,
  );
  assert.equal(
    computeThr({ baseSalary: 6_000_000, allowance: 600_000, joinDate: '2026-01-01', period: '2027-01' })
      .amount,
    6_600_000,
  );
  assert.equal(
    computeThr({ baseSalary: 6_000_000, joinDate: '2020-01-01', period: '2027-01' }).amount,
    6_000_000,
  );
});

test('THR raises gross and PPh 21 but not the BPJS base', () => {
  const without = computePayslip({ baseSalary: 6_000_000, attendance: fullMonth() });
  const withThr = computePayslip({
    baseSalary: 6_000_000,
    attendance: fullMonth(),
    thrAmount: 6_000_000,
  });

  assert.equal(withThr.gross, 12_000_000);
  assert.equal(withThr.bpjsKesehatan, without.bpjsKesehatan);
  assert.equal(withThr.bpjsJht, without.bpjsJht);
  assert.equal(withThr.pph21, 625_000);
  assert.equal(withThr.netPay, 11_135_000);
  assert.equal(withThr.netPay, withThr.gross - withThr.totalDeductions);
});

test('employer BPJS contributions use their own rates and caps', () => {
  const slip = computePayslip({ baseSalary: 11_000_000, attendance: fullMonth() });

  assert.equal(slip.employerBpjsKesehatan, 440_000);
  assert.equal(slip.employerBpjsJht, 407_000);
  assert.equal(slip.employerBpjsJp, 210_948);
  assert.equal(slip.employerBpjsJkk, 26_400);
  assert.equal(slip.employerBpjsJkm, 33_000);
  assert.equal(slip.employerTotal, 1_117_348);
  assert.equal(slip.employerCost, slip.gross + slip.employerTotal);
  // employer contributions never change take-home pay
  assert.equal(slip.netPay, slip.gross - slip.totalDeductions);
});

test('employer contributions follow the prorated base', () => {
  const full = computePayslip({ baseSalary: 11_000_000, attendance: fullMonth() });
  const reduced = computePayslip({ baseSalary: 11_000_000, attendance: fullMonth({ presentDays: 20 }) });

  assert.ok(reduced.employerTotal < full.employerTotal);
  assert.equal(reduced.employerBpjsKesehatan, 400_000);
  assert.equal(reduced.employerBpjsJht, 370_000);
});

test('PTKP table is complete for the statuses offered in the UI', () => {
  assert.deepEqual(Object.keys(PTKP_STATUSES), [
    'TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3',
  ]);
});
