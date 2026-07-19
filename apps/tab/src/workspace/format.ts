/** The ROI engine works in whole dollars (not cents). */
export function fmtUsd(dollars: number): string {
  const abs = Math.abs(Math.round(dollars));
  const s = `$${abs.toLocaleString("en-US")}`;
  return dollars < 0 ? `−${s}` : s;
}

export function fmtPayback(paybackYears: number | null): string {
  if (paybackYears === null) return "Never at current numbers";
  if (paybackYears === 0) return "Immediate";
  if (paybackYears < 1) return `${Math.round(paybackYears * 12)} months`;
  return `${paybackYears.toFixed(1)} yrs`;
}

export function fmtMultiple(x: number | null): string {
  return x === null ? "—" : `${x.toFixed(1)}×`;
}

export function timeAgoLabel(iso: string): string {
  return iso.slice(0, 10);
}
