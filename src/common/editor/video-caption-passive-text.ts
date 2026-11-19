/* SPDX-License-Identifier: AGPL-3.0-only */

import { interchangeError } from './video-caption-interchange-contract-v27.ts';
import { CUE_CHARACTER_REFERENCE, namedCueCharacterReference, numericCueCharacterReference } from './cue-character-reference.ts';

export function decodePassiveCaptionText(value: string): string {
	if (/[<>]/u.test(value)) throw interchangeError('Caption cue markup is outside the passive maintained subset.', 'ACTIVE_CONTENT');
	let invalid = false;
	// Every entity-shaped run has to be classified while it is still in the
	// source. Once decoding has run, an ampersand it produced is indistinguishable
	// from one that opens an entity: escaping `AT&T` gives `AT&amp;T`, so scanning
	// the decoded text refused this exporter's own output.
	const decoded = value.replace(CUE_CHARACTER_REFERENCE, (entity: string, body: string) => {
		const reference = body.toLowerCase();
		if (reference.startsWith('#')) {
			const codePoint = numericCueCharacterReference(reference);
			if (codePoint === undefined) throw interchangeError('Caption cue contains an invalid numeric entity.', 'ACTIVE_CONTENT');
			return codePoint;
		}
		const replacement = namedCueCharacterReference(body);
		// A differently cased spelling is literal text, not a reference.
		if (replacement === undefined && namedCueCharacterReference(reference) !== undefined) return entity;
		if (replacement === undefined) invalid = true;
		return replacement ?? '';
	});
	if (invalid) throw interchangeError('Caption cue contains an unsupported entity.', 'ACTIVE_CONTENT');
	return decoded;
}
