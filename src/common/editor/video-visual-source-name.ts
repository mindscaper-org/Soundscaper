/* SPDX-License-Identifier: AGPL-3.0-only */

/** Derived labels share the native 512-unit source-name bound, without cutting a Unicode scalar. */
export function derivedVideoVisualSourceName(name: string, suffix: ' Model' | ' Freeze'): string {
	const maximumPrefix = 512 - suffix.length;
	let prefix = '';
	for (const character of name) {
		if (prefix.length + character.length > maximumPrefix) break;
		prefix += character;
	}
	return prefix + suffix;
}
