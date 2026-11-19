/* SPDX-License-Identifier: AGPL-3.0-only */

const NAMED_REFERENCES: Readonly<Record<string, string>> = Object.freeze({
	amp: '&', AMP: '&', lt: '<', LT: '<', gt: '>', GT: '>', quot: '"', QUOT: '"', apos: "'", nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f',
});

export const CUE_CHARACTER_REFERENCE = /&(#x?[\da-z]*|[a-z][\da-z]*);/giu;

export function namedCueCharacterReference(name: string): string | undefined {
	return Object.hasOwn(NAMED_REFERENCES, name) ? NAMED_REFERENCES[name] : undefined;
}

export function numericCueCharacterReference(name: string): string | undefined {
	const hex = name.startsWith('#x');
	const digits = name.slice(hex ? 2 : 1);
	if (!(hex ? /^[\da-f]+$/iu : /^\d+$/u).test(digits)) return undefined;
	const value = Number.parseInt(digits, hex ? 16 : 10);
	if (!Number.isSafeInteger(value) || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return undefined;
	return String.fromCodePoint(value);
}
