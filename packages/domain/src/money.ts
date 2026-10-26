const wholeRupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const withPaise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats paise as Indian rupees with Indian digit grouping: 12000000 → "₹1,20,000". */
export function formatInr(amountMinor: number): string {
  return amountMinor % 100 === 0
    ? wholeRupees.format(amountMinor / 100)
    : withPaise.format(amountMinor / 100);
}

/** Rupees (as given in the dataset) → paise, rounding half away from zero. */
export function rupeesToMinor(rupees: number): number {
  return Math.round(rupees * 100);
}

export function minorToRupees(amountMinor: number): number {
  return amountMinor / 100;
}
