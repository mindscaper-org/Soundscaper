/**
 * Screen-reader announcer.
 *
 * Lazily mounts a single off-screen `aria-live="polite"` div on the
 * body and pushes status text into it. Used for non-DOM-focus events
 * — e.g. a keyboard trim shortcut changes the clip duration, but
 * VoiceOver doesn't automatically re-read the focused element's
 * `aria-label` on change, so we drive the announcement explicitly.
 *
 * Setting the same string twice in a row is a no-op for assistive
 * tech, so we clear-then-set on a microtask to coax a re-read.
 */

let announcerEl: HTMLDivElement | null = null;

function getEl(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (announcerEl) return announcerEl;
  const el = document.createElement('div');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.setAttribute('role', 'status');
  // Visually hidden but still in the accessibility tree.
  el.style.cssText = [
    'position:absolute',
    'width:1px',
    'height:1px',
    'padding:0',
    'margin:-1px',
    'overflow:hidden',
    'clip:rect(0,0,0,0)',
    'white-space:nowrap',
    'border:0',
  ].join(';');
  document.body.appendChild(el);
  announcerEl = el;
  return el;
}

export function announce(message: string): void {
  const el = getEl();
  if (!el) return;
  // Clear first so VoiceOver picks up the change even if the text is
  // identical to the previous announcement (back-to-back trims at the
  // same edge will produce identical strings sometimes).
  el.textContent = '';
  // requestAnimationFrame keeps the clear/set on the same paint and
  // avoids burning a real timer.
  requestAnimationFrame(() => {
    if (announcerEl) announcerEl.textContent = message;
  });
}

/**
 * Format a time in seconds for screen readers — full English words
 * rather than the "0:02.5" digits the visual timeline uses, since
 * VoiceOver reads colons as "colon" and decimal points as "point".
 *
 *   0      → "0 seconds"
 *   0.5    → "0.5 seconds"
 *   1      → "1 second"
 *   65     → "1 minute 5 seconds"
 *   3725   → "1 hour 2 minutes 5 seconds"
 */
const spokenFormatters = new Map<string, Intl.NumberFormat>();
function spokenUnit(value: number, unit: 'hour' | 'minute' | 'second', locale: string): string {
  const key = `${locale}:${unit}`;
  let formatter = spokenFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long', maximumFractionDigits: 1 });
    if (spokenFormatters.size >= 48) spokenFormatters.delete(spokenFormatters.keys().next().value!);
    spokenFormatters.set(key, formatter);
  }
  return formatter.format(value);
}

export function formatTimeForA11y(seconds: number, locale = 'en'): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;

  // Round to tenths *first*, then split: rounding the seconds
  // remainder after the split lets it reach 60 with nothing to carry
  // into, which announces "1 minute 60 seconds".
  const tenths = Math.round(seconds * 10);
  const hours = Math.floor(tenths / 36000);
  const minutes = Math.floor((tenths % 36000) / 600);
  const rounded = (tenths % 600) / 10;
  const unit = (value: number, name: 'hour' | 'minute' | 'second') => spokenUnit(value, name, locale);

  const parts: string[] = [];
  if (hours > 0) parts.push(unit(hours, 'hour'));
  if (minutes > 0) parts.push(unit(minutes, 'minute'));
  if (rounded > 0 || parts.length === 0) {
    parts.push(unit(rounded, 'second'));
  }
  return parts.join(' ');
}
