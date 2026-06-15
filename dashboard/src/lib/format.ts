export function money(n: number | null | undefined, currency = 'USD'): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
}

export function compactNumber(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function durationLabel(d: string | null): string {
  if (!d) return 'Non-renewing';
  const map: Record<string, string> = {
    P1W: 'Weekly',
    P1M: 'Monthly',
    P2M: '2 Months',
    P3M: '3 Months',
    P6M: '6 Months',
    P1Y: 'Yearly',
  };
  return map[d] ?? d;
}
