/* SPDX-License-Identifier: AGPL-3.0-only */

import { interchangeError } from './video-caption-interchange-contract-v27.ts';

const PASSIVE_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
	amp: '&', AMP: '&', lt: '<', LT: '<', gt: '>', GT: '>', quot: '"', QUOT: '"', apos: "'", nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f',
});

export function decodePassiveCaptionText(value: string): string {
	if (/[<>]/u.test(value)) throw interchangeError('Caption cue markup is outside the passive maintained subset.', 'ACTIVE_CONTENT');
	let invalid = false;
	// Every entity-shaped run has to be classified while it is still in the
	// source. Once decoding has run, an ampersand it produced is indistinguishable
	// from one that opens an entity: escaping `AT&T` gives `AT&amp;T`, so scanning
	// the decoded text refused this exporter's own output.
	const decoded = value.replace(/&(#x?[\da-z]*|[a-z][\da-z]*);/giu, (entity: string, body: string) => {
		const reference = body.toLowerCase();
		if (reference.startsWith('#x')) return passiveCodePoint(reference.slice(2), 16);
		if (reference.startsWith('#')) return passiveCodePoint(reference.slice(1), 10);
		const replacement = Object.hasOwn(PASSIVE_ENTITIES, body) ? PASSIVE_ENTITIES[body] : undefined;
		// A differently cased spelling is literal text, not a reference.
		if (replacement === undefined && Object.hasOwn(PASSIVE_ENTITIES, reference)) return entity;
		if (replacement === undefined) invalid = true;
		return replacement ?? '';
	});
	if (invalid) throw interchangeError('Caption cue contains an unsupported entity.', 'ACTIVE_CONTENT');
	return decoded;
}

function passiveCodePoint(value: string, radix: number): string {
	if (!(radix === 16 ? /^[\da-f]+$/iu : /^\d+$/u).test(value)) {
		throw interchangeError('Caption cue contains an invalid numeric entity.', 'ACTIVE_CONTENT');
	}
	const codePoint = Number.parseInt(value, radix);
	if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff
		|| (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
		throw interchangeError('Caption cue contains an invalid numeric entity.', 'ACTIVE_CONTENT');
	}
	return String.fromCodePoint(codePoint);
}
