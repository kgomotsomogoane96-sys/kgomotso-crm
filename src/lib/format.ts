/**
 * Deterministic number formatting.
 *
 * `Number.prototype.toLocaleString("en-ZA")` is NOT safe in a server-rendered
 * app: Node renders 8500 as "8 500" (ICU, non-breaking space) while the browser
 * renders "8,500". Same value, different text — which is exactly what React
 * error #418 (hydration text mismatch) is reporting, on every page.
 *
 * These helpers do not depend on the ICU data of the runtime, so the server and
 * the browser always produce identical strings.
 */
export function groupThousands(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "R 8,500" — or an em dash when there is no money yet. */
export function money(value: number | null | undefined): string {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? `R ${groupThousands(Number(value))}` : "\u2014";
}

/** "8,500" — bare, for table cells that print their own currency mark. */
export function amount(value: number | null | undefined): string {
  return Number(value) > 0 ? groupThousands(Number(value)) : "\u2014";
}

/** "8.5" — one decimal, always a dot. */
export function decimal(value: number, places = 1): string {
  return Number(value || 0).toFixed(places);
}
