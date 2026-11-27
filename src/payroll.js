// Payroll rules for the demo. All money values are whole rupiah.
// A simplified but documented model: fixed monthly allowances, daily-rate
// absence deductions, overtime at 1.5x the hourly rate, employee-side BPJS
// contributions, annualised PPh 21 progressive tax spread over 12 months,
// employer-side BPJS contributions, and THR with month-of-service proration.

export const HOURS_PER_MONTH = 173;
export const OVERTIME_MULTIPLIER = 1.5;

export const BPJS_KESEHATAN = { rate: 0.01, cap: 12_000_000 };
export const BPJS_JHT_RATE = 0.02;
export const BPJS_JP = { rate: 0.01, cap: 10_547_400 };

export const EMPLOYER_BPJS = {
  kesehatan: { rate: 0.04, cap: 12_000_000 },
  jht: { rate: 0.037 },
  jp: { rate: 0.02, cap: 10_547_400 },
  jkk: { rate: 0.0024 },
  jkm: { rate: 0.003 },
};

export const THR_MONTHS_FOR_FULL = 12;

export const PTKP_STATUSES = {
  'TK/0': 54_000_000,
  'TK/1': 58_500_000,
  'TK/2': 63_000_000,
  'TK/3': 67_500_000,
  'K/0': 58_500_000,
  'K/1': 63_000_000,
  'K/2': 67_500_000,
  'K/3': 72_000_000,
};

export const TAX_BRACKETS = [
  { upTo: 60_000_000, rate: 0.05 },
  { upTo: 250_000_000, rate: 0.15 },
  { upTo: 500_000_000, rate: 0.25 },
  { upTo: 5_000_000_000, rate: 0.3 },
  { upTo: Infinity, rate: 0.35 },
];

export const DEFAULT_PTKP = 'TK/0';

export function annualIncomeTax(taxableAnnual) {
  let remaining = Math.max(0, Math.round(taxableAnnual));
  let tax = 0;
  let floor = 0;
  for (const bracket of TAX_BRACKETS) {
    if (remaining <= 0) break;
    const width = bracket.upTo - floor;
    const slice = Math.min(remaining, width);
    tax += slice * bracket.rate;
    remaining -= slice;
    floor = bracket.upTo;
  }
  return Math.round(tax);
}

export function monthlyIncomeTax(monthlyGross, ptkpStatus = DEFAULT_PTKP) {
  const ptkp = PTKP_STATUSES[ptkpStatus] ?? PTKP_STATUSES[DEFAULT_PTKP];
  const taxableAnnual = monthlyGross * 12 - ptkp;
  return Math.round(annualIncomeTax(taxableAnnual) / 12);
}

/**
 * Complete months of service at the start of a payroll period. A partial first
 * month does not count, so joining on the 1st starts with one full month after
 * that month ends.
 */
export function completedServiceMonths(joinDate, period) {
  const [joinYear, joinMonth, joinDay] = String(joinDate).split('-').map(Number);
  const [periodYear, periodMonth] = String(period).split('-').map(Number);
  if (!joinYear || !periodYear) return 0;
  let months = (periodYear - joinYear) * 12 + (periodMonth - joinMonth);
  if (joinDay > 1) months -= 1;
  return Math.max(0, months);
}

/**
 * THR: one month of base salary plus fixed allowance after a year of service,
 * prorated by completed months below that, and nothing before the first full
 * month.
 */
export function computeThr({ baseSalary, allowance = 0, joinDate, period }) {
  const months = completedServiceMonths(joinDate, period);
  if (months < 1) return { months, amount: 0 };
  const ratio = Math.min(months, THR_MONTHS_FOR_FULL) / THR_MONTHS_FOR_FULL;
  const amount = Math.round((Math.max(0, baseSalary) + Math.max(0, allowance)) * ratio);
  return { months, amount };
}

/**
 * @param {object} input
 * @param {number} input.baseSalary contract base salary, rupiah
 * @param {number} [input.allowance] fixed monthly allowance, rupiah
 * @param {{workingDays:number, presentDays:number, paidLeaveDays:number, unpaidLeaveDays:number, overtimeHours:number}} input.attendance
 * @param {string} [input.ptkpStatus]
 * @param {number} [input.otherDeduction] e.g. loan repayment, rupiah
 * @param {number} [input.thrAmount] holiday allowance paid in this period, rupiah
 * @returns {object} payslip breakdown
 */
export function computePayslip({
  baseSalary,
  allowance = 0,
  attendance,
  ptkpStatus = DEFAULT_PTKP,
  otherDeduction = 0,
  thrAmount = 0,
}) {
  const base = Math.max(0, Math.round(baseSalary));
  const fixedAllowance = Math.max(0, Math.round(allowance));
  const workingDays = Math.max(1, Math.round(attendance.workingDays));
  const presentDays = Math.max(0, Math.round(attendance.presentDays));
  const paidLeaveDays = Math.max(0, Math.round(attendance.paidLeaveDays));
  const unpaidLeaveDays = Math.max(0, Math.round(attendance.unpaidLeaveDays));
  const overtimeHours = Math.max(0, Number(attendance.overtimeHours) || 0);
  const thr = Math.max(0, Math.round(thrAmount));

  const absentDays = Math.max(0, workingDays - presentDays - paidLeaveDays - unpaidLeaveDays);
  const unpaidDays = unpaidLeaveDays + absentDays;

  const dailyRate = base / workingDays;
  const absenceDeduction = Math.round(dailyRate * unpaidDays);
  const proratedBase = Math.max(0, base - absenceDeduction);

  const hourlyRate = base / HOURS_PER_MONTH;
  const overtimePay = Math.round(hourlyRate * OVERTIME_MULTIPLIER * overtimeHours);

  // THR is not part of the BPJS contribution base; it is taxable in the month paid.
  const gross = proratedBase + fixedAllowance + overtimePay + thr;

  const bpjsKesehatan = Math.round(
    Math.min(proratedBase, BPJS_KESEHATAN.cap) * BPJS_KESEHATAN.rate,
  );
  const bpjsJht = Math.round(proratedBase * BPJS_JHT_RATE);
  const bpjsJp = Math.round(Math.min(proratedBase, BPJS_JP.cap) * BPJS_JP.rate);
  const pph21 = monthlyIncomeTax(gross, ptkpStatus);
  const other = Math.max(0, Math.round(otherDeduction));

  const totalDeductions = bpjsKesehatan + bpjsJht + bpjsJp + pph21 + other;
  const netPay = gross - totalDeductions;

  // Employer contributions are company cost, never deducted from net pay.
  const employerBpjsKesehatan = Math.round(
    Math.min(proratedBase, EMPLOYER_BPJS.kesehatan.cap) * EMPLOYER_BPJS.kesehatan.rate,
  );
  const employerBpjsJht = Math.round(proratedBase * EMPLOYER_BPJS.jht.rate);
  const employerBpjsJp = Math.round(
    Math.min(proratedBase, EMPLOYER_BPJS.jp.cap) * EMPLOYER_BPJS.jp.rate,
  );
  const employerBpjsJkk = Math.round(proratedBase * EMPLOYER_BPJS.jkk.rate);
  const employerBpjsJkm = Math.round(proratedBase * EMPLOYER_BPJS.jkm.rate);
  const employerTotal =
    employerBpjsKesehatan + employerBpjsJht + employerBpjsJp + employerBpjsJkk + employerBpjsJkm;

  return {
    workingDays,
    presentDays,
    paidLeaveDays,
    unpaidLeaveDays,
    unpaidDays,
    overtimeHours,
    baseSalary: base,
    dailyRate,
    proratedBase,
    allowance: fixedAllowance,
    overtimePay,
    thrAmount: thr,
    gross,
    bpjsKesehatan,
    bpjsJht,
    bpjsJp,
    pph21,
    otherDeduction: other,
    totalDeductions,
    netPay,
    employerBpjsKesehatan,
    employerBpjsJht,
    employerBpjsJp,
    employerBpjsJkk,
    employerBpjsJkm,
    employerTotal,
    employerCost: gross + employerTotal,
  };
}
