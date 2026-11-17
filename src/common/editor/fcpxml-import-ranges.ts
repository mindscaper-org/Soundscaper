/* SPDX-License-Identifier: AGPL-3.0-only */
import { addRationals, compareRationals, subtractRationals, type Rational } from './timeline-time.ts';

export interface FcpxmlImportWindow { readonly start: Rational; readonly end?: Rational }

/** Contained items inherit their parent's trim; anchored items inherit only containing ancestors. */
export function fcpxmlChildWindow(ancestor: FcpxmlImportWindow, parentStart: Rational, parentDuration: Rational | undefined, contained: boolean): FcpxmlImportWindow {
	if (!contained || !parentDuration) return ancestor;
	const parentEnd = addRationals(parentStart, parentDuration);
	return { start: compareRationals(ancestor.start, parentStart) > 0 ? ancestor.start : parentStart,
		end: ancestor.end && compareRationals(ancestor.end, parentEnd) < 0 ? ancestor.end : parentEnd };
}

export function fcpxmlVisibleMediaRange(start: Rational, duration: Rational, sourceStart: Rational, window: FcpxmlImportWindow) {
	const end = addRationals(start, duration);
	const visibleStart = compareRationals(start, window.start) < 0 ? window.start : start;
	const visibleEnd = window.end && compareRationals(end, window.end) > 0 ? window.end : end;
	if (compareRationals(visibleEnd, visibleStart) <= 0) return null;
	const relativeSourceStart = addRationals(sourceStart, subtractRationals(visibleStart, start));
	if (relativeSourceStart.num < 0) throw new RangeError('FCPXML clip begins before its asset source origin.');
	return { start: visibleStart, duration: subtractRationals(visibleEnd, visibleStart), sourceStart: relativeSourceStart };
}
