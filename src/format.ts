/** Decimal hours ↔ h:mm conversion (must round-trip exactly) and display helpers. */

export function hoursToHmm(hours: number): string {
  const totalMins = Math.round(hours * 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function hmmToHours(hmm: string): number {
  const [h, m] = hmm.split(":").map(Number);
  return h + (m || 0) / 60;
}

export function fmtHours(hours: number): string {
  return (Math.round(hours * 100) / 100).toString();
}

export function fmtMoney(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
