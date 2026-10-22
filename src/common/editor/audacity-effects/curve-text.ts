/* SPDX-License-Identifier: GPL-3.0-only */

/** Parse complete frequency/gain pairs before the manifest validates bounds. */
export function parseAudacityCurveEntries(value: unknown): readonly unknown[] {
	if (Array.isArray(value)) return value;
	return String(value || '').split(/[;,\n]+/u).filter(part => part.trim()).map(part => {
		const fields = part.trim().split(/\s*:\s*|\s+/u);
		if (fields.length !== 2 || fields.some(field => field === '')) {
			throw new RangeError('Each curve point must contain one frequency and one gain.');
		}
		const [frequency, gain] = fields.map(Number);
		return { frequency, gain };
	});
}
