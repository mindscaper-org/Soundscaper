/* SPDX-License-Identifier: AGPL-3.0-only */

/** A whole exported keymap includes unavailable plug-in commands, which import reviews as skips. */
export function largeAudacityShortcutXml(formatted: boolean): string {
	const records = [
		'<SC><key>new-mono-track</key><seq>Alt+F10</seq></SC>',
		...Array.from({ length: 900 }, (_, index) => `<SC><key>unavailable-plugin-${String(index)}</key><seq>Ctrl+F9</seq></SC>`),
	];
	return '<?xml version="1.0" encoding="UTF-8"?>\n<Shortcuts>'
		+ (formatted ? `\n    ${records.join('\n    ')}\n` : records.join('')) + '</Shortcuts>';
}
