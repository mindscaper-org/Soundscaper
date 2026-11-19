/* SPDX-License-Identifier: AGPL-3.0-only */

const MAXIMUM_TEXT_LENGTH = 256;

export function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

export function enumValue<const Values extends readonly string[]>(
	value: unknown,
	values: Values,
	label: string,
): Values[number] {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw new TypeError(`A plug-in scan observation must name a supported ${label}.`);
	}
	return value as Values[number];
}

export function booleanValue(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`A plug-in ${label} flag must be a boolean.`);
	return value;
}

export function boundedText(value: unknown, label: string): string {
	if (typeof value !== 'string'
		|| value.length === 0
		|| value.length > MAXIMUM_TEXT_LENGTH
		|| value.includes('\u0000')) {
		throw new TypeError(`A plug-in ${label} must be bounded, non-empty text.`);
	}
	return value;
}

export function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new TypeError(`A plug-in ${label} is outside its admitted bounds.`);
	}
	return value as number;
}

/**
 * Scanner-reported text is authored by the plug-in, so it is bounded at admission
 * and stripped of path separators here, at the renderer boundary. A vendor that
 * names itself after a path still cannot put one into renderer-facing state.
 */
export function displayText(value: string): string {
	return value.split(/[\\/]/u).join(' ').replace(/\s+/gu, ' ').trim() || '(unnamed)';
}
