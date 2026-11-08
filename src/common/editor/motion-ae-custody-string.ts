/* SPDX-License-Identifier: AGPL-3.0-only */
/** Exchange custody preserves AE's authored Unicode form; destination model conversion owns any normalization. */
export function motionAeCustodyString(value: unknown, name: string, maximum = 512, allowEmpty = false): string {
	if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && value.length === 0)
		|| [...value].some((character) => /\p{Cc}/u.test(character) && !['\t', '\n', '\r'].includes(character))) throw new TypeError(`${name} must be bounded inert text.`);
	return value;
}

/** AE Source Text uses U+0003 for a hard line break. Preserve it only in text values. */
export function motionAeSourceText(value: unknown): string {
	if (typeof value !== 'string' || value.length > 262_144) throw new TypeError('AE text must be bounded inert text.');
	motionAeCustodyString(value.split('\u0003').join('\n'), 'AE text', 262_144, true);
	return value;
}
