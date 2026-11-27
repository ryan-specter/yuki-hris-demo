// Payroll rules for the demo. All money values are whole rupiah.
// This is a simplified, documented model: fixed monthly allowances, daily-rate
// absence deductions, overtime at 1.5x the hourly rate, employee-side BPJS
// contributions, and annualised PPh 21 progressive tax spread over 12 months.

export const HOURS_PER_MONTH = 173;
export const OVERTIME_MULTIPLIER = 1.5;

export const BPJS_KESEHATAN = { rate: 0.01, cap: 12_000_000 };
export const BPJS_JHT_RATE = 0.02;
export const BPJS_JP = { rate: 0.01, cap: 10_547_400 };

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
 * @param {object} input
 * @param {number} input.baseSalary contract base salary, rupiah
 * @param {number} [input.allowance] fixed monthly allowance, rupiah
 * @param {{workingDays:number, presentDays:number, paidLeaveDays:number, unpaidLeaveDays:number, overtimeHours:number}} input.attendance
 * @param {string} [input.ptkpStatus]
 * @param {number} [input.otherDeduction] e.g. loan repayment, rupiah
 * @returns {object} payslip breakdown
 */
export function computePayslip({
  baseSalary,
  allowance = 0,
  attendance,
  ptkpStatus = DEFAULT_PTKP,
  otherDeduction = 0,
}) {
  const base = Math.max(0, Math.round(baseSalary));
  const fixedAllowance = Math.max(0, Math.round(allowance));
  const workingDays = Math.max(1, Math.round(attendance.workingDays));
  const presentDays = Math.max(0, Math.round(attendance.presentDays));
  const paidLeaveDays = Math.max(0, Math.round(attendance.paidLeaveDays));
  const unpaidLeaveDays = Math.max(0, Math.round(attendance.unpaidLeaveDays));
  const overtimeHours = Math.max(0, Number(attendance.overtimeHours) || 0);

  const absentDays = Math.max(0, workingDays - presentDays - paidLeaveDays - unpaidLeaveDays);
  const unpaidDays = unpaidLeaveDays + absentDays;

  const dailyRate = base / workingDays;
  const absenceDeduction = Math.round(dailyRate * unpaidDays);
  const proratedBase = Math.max(0, base - absenceDeduction);

  const hourlyRate = base / HOURS_PER_MONTH;
  const overtimePay = Math.round(hourlyRate * OVERTIME_MULTIPLIER * overtimeHours);

  const gross = proratedBase + fixedAllowance + overtimePay;

  const bpjsKesehatan = Math.round(
    Math.min(proratedBase, BPJS_KESEHATAN.cap) * BPJS_KESEHATAN.rate,
  );
  const bpjsJht = Math.round(proratedBase * BPJS_JHT_RATE);
  const bpjsJp = Math.round(Math.min(proratedBase, BPJS_JP.cap) * BPJS_JP.rate);
  const pph21 = monthlyIncomeTax(gross, ptkpStatus);
  const other = Math.max(0, Math.round(otherDeduction));

  const totalDeductions = bpjsKesehatan + bpjsJht + bpjsJp + pph21 + other;
  const netPay = gross - totalDeductions;

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
    gross,
    bpjsKesehatan,
    bpjsJht,
    bpjsJp,
    pph21,
    otherDeduction: other,
    totalDeductions,
    netPay,
  };
}
