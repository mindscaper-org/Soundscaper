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
	return wrapPreparedText(prepareTexts([text])[0]!, maximumWidth, fontSize, new Map());
}

interface PreparedGrapheme { readonly text: string; readonly advances: readonly number[] }
interface PreparedParagraph { readonly emptyText: string; readonly words: readonly (readonly PreparedGrapheme[])[] }
type PreparedText = readonly PreparedParagraph[];

function prepareTexts(texts: readonly string[]): readonly PreparedText[] {
	const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
	const words = new Map<string, readonly PreparedGrapheme[]>();
	const graphemes = new Map<string, PreparedGrapheme>();
	const prepareGrapheme = (text: string): PreparedGrapheme => {
		let retained = graphemes.get(text);
		if (!retained) {
			const characters = Array.from(text.normalize('NFD')).filter(character => !/\p{M}/u.test(character));
			retained = { text, advances: characters.map(character => {
				const point = character.codePointAt(0)!;
				// Preserve conservative non-ASCII metrics and per-character ceil rounding.
				return point >= 0x20 && point <= 0x7e ? ASCII_ADVANCES[point - 0x20]! / 2048 : 2.75;
			}) };
			graphemes.set(text, retained);
		}
		return retained;
	};
	return texts.map(text => text.split('\n').map(paragraph => ({ emptyText: paragraph.trim(),
		words: paragraph.split(/\s+/u).filter(Boolean).map(word => {
			let retained = words.get(word);
			if (!retained) {
				retained = Array.from(segmenter.segment(word), part => prepareGrapheme(part.segment));
				words.set(word, retained);
			}
			return retained;
		}),
	})));
}

function wrapPreparedText(
	text: PreparedText, maximumWidth: number, fontSize: number, widths: Map<PreparedGrapheme, number>,
): string {
	const width = (part: PreparedGrapheme) => {
		let retained = widths.get(part);
		if (retained === undefined) {
			retained = part.advances.reduce((total, advance) => total + Math.ceil(advance * fontSize), 0);
			widths.set(part, retained);
		}
		return retained;
	};
	const space = Math.ceil(ASCII_ADVANCES[0]! / 2048 * fontSize);
	return text.map(paragraph => {
		const lines: string[] = [];
		let line = '';
		let lineWidth = 0;
		for (const parts of paragraph.words) {
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
				line += part.text; lineWidth += advance;
			}
		}
		if (line) lines.push(line);
		return lines.length ? lines.join('\n') : paragraph.emptyText;
	}).join('\n');
}

/** Keep every wrapped line inside the title-safe height while retaining the readable floor. */
export function fitBurnInTexts(
	texts: readonly string[], maximumWidth: number, maximumHeight: number,
	minimumFontSize: number, preferredFontSize: number,
): Readonly<{ fontSizePx: number; lineSpacingPx: number; texts: readonly string[] }> {
	const prepared = prepareTexts(texts);
	const layout = (fontSizePx: number) => {
		const lineSpacingPx = Math.round(fontSizePx * 0.25);
		const widths = new Map<PreparedGrapheme, number>();
		const wrapped = prepared.map(text => wrapPreparedText(text, maximumWidth, fontSizePx, widths));
		// Every maintained Inter subset has a 1.442 em maximum ink bounding
		// box. Round above it to include accent/descender rasterization.
		const lineHeight = Math.ceil(fontSizePx * 1.5);
		const fits = wrapped.every(text => {
			const lines = text.split('\n').length;
			return lines * lineHeight + (lines - 1) * lineSpacingPx
				+ 2 * Math.max(2, Math.round(fontSizePx * 0.25)) <= maximumHeight;
		});
		return { fontSizePx, lineSpacingPx, texts: wrapped, fits };
	};
	const preferred = layout(preferredFontSize);
	if (preferred.fits) return preferred;
	let best = layout(minimumFontSize);
	if (!best.fits) throw new RangeError('The caption text is too tall for the video title-safe height at its minimum font size.');
	let low = minimumFontSize + 1;
	let high = preferredFontSize - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const candidate = layout(middle);
		if (candidate.fits) { best = candidate; low = middle + 1; }
		else high = middle - 1;
	}
	return best;
}
