/* SPDX-License-Identifier: AGPL-3.0-only */

export function wrapPolicyNarrativeText(text, width) {
	const lines = [];
	let line = '';
	for (const word of text.split(' ')) {
		if (line === '') line = word;
		else if (line.length + 1 + word.length <= width) line += ` ${word}`;
		else { lines.push(line); line = word; }
	}
	if (line !== '') lines.push(line);
	return lines.join('\n');
}
