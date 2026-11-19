/* SPDX-License-Identifier: AGPL-3.0-only */

import { CUE_CHARACTER_REFERENCE, namedCueCharacterReference, numericCueCharacterReference } from './cue-character-reference.ts';

/** Project supported whole-cue SubRip emphasis into the plain label title. */
export function decodeSubRipLabelText(value: string): string {
	let text = value;
	for (;;) {
		const wrapper = /^<(b|i|u)>([\s\S]*)<\/\1>$/iu.exec(text);
		if (!wrapper) return text;
		text = wrapper[2] ?? '';
	}
}

/** SubRip players interpret these tags even when they occur inside otherwise plain text. */
export function containsSubRipLabelMarkup(value: string): boolean {
	return /<\/?(?:[bisu]|font|br)(?:[ \t]+[^<>\r\n]*)?\/?>/iu.test(value);
}

/** Labels are plain text; WebVTT cue payloads give punctuation markup meaning. */
export function encodeWebVttLabelText(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Project passive WebVTT cue text into a plain label title. */
export function decodeWebVttLabelText(value: string): string {
	// Remove source markup before decoding references so exported literal tags
	// such as &lt;b&gt; remain ordinary label text after a round trip.
	const plain = value.replace(/<\/?(?:b|i|u|c|v|lang|ruby|rt)(?:\.[^\s<>]+)?(?:[ \t][^<>]*)?>|<(?:\d+:)?[0-5]\d:[0-5]\d\.\d{3}>/gu, '');
	return plain.replace(CUE_CHARACTER_REFERENCE, (reference: string, name: string) => {
		const decoded = name.startsWith('#') ? numericCueCharacterReference(name.toLowerCase()) : namedCueCharacterReference(name);
		return decoded === '\0' ? '\ufffd' : decoded ?? reference;
	});
}
