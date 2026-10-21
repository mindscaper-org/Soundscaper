/* SPDX-License-Identifier: AGPL-3.0-only */

/** Inter 600 horizontal advances for printable ASCII (U+0020–U+007E), in 2048 units/em. */
const ASCII_ADVANCES = Object.freeze([
	516, 658, 1071, 1318, 1332, 2057, 1357, 667, 764, 764, 1105, 1378, 653, 953, 653, 776,
	1351, 866, 1276, 1303, 1364, 1254, 1310, 1180, 1311, 1310, 653, 674, 1378, 1378, 1378, 1113,
	2046, 1490, 1350, 1509, 1479, 1240, 1204, 1534, 1527, 567, 1187, 1440, 1158, 1889, 1555, 1574, 1321,
	1583, 1336, 1332, 1352, 1507, 1490, 2089, 1474, 1461, 1336, 764, 776, 764, 986, 961, 719,
	1176, 1278, 1193, 1278, 1211, 796, 1281, 1254, 536, 536, 1166, 536, 1844, 1253, 1247, 1278,
	1278, 813, 1125, 723, 1254, 1202, 1719, 1165, 1205, 1159, 931, 735, 931, 1378,
]);

/** Wrap whole graphemes by their staged font advance, rather than average character counts. */
export function wrapBurnInText(text: string, maximumWidth: number, fontSize: number): string {
	const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
	const width = (part: string) => glyphWidth(part, fontSize);
	const space = width(' ');
	return text.split('\n').map(paragraph => {
		const lines: string[] = [];
		let line = '';
		let lineWidth = 0;
		for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
			const parts = Array.from(segmenter.segment(word), part => part.segment);
			const wordWidth = parts.reduce((sum, part) => sum + width(part), 0);
			if (line && lineWidth + space + wordWidth > maximumWidth) {
				lines.push(line); line = ''; lineWidth = 0;
			}
			if (line) { line += ' '; lineWidth += space; }
			for (const part of parts) {
				const advance = width(part);
				if (advance > maximumWidth) throw new RangeError('The video canvas is too narrow for a caption glyph.');
				if (lineWidth + advance > maximumWidth) {
					lines.push(line); line = ''; lineWidth = 0;
				}
				line += part; lineWidth += advance;
			}
		}
		if (line) lines.push(line);
		return lines.length ? lines.join('\n') : paragraph.trim();
	}).join('\n');
}

function glyphWidth(grapheme: string, fontSize: number): number {
	const normalized = grapheme.normalize('NFD');
	const characters = Array.from(normalized).filter(character => !/\p{M}/u.test(character));
	if (characters.length === 0) return 0;
	return characters.reduce((total, character) => {
		const point = character.codePointAt(0)!;
		// Non-ASCII glyphs use a conservative advance above every maintained
		// Inter subset's maximum (2.682 em), retaining combining marks intact.
		const advance = point >= 0x20 && point <= 0x7e ? ASCII_ADVANCES[point - 0x20]! / 2048 : 2.75;
		return total + Math.ceil(advance * fontSize);
	}, 0);
}
