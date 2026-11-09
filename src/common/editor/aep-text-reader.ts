/* SPDX-License-Identifier: AGPL-3.0-only */
import { aepChild } from './aep-container.ts';
import { aepNamed, aepNamedNodes, type AepLayer } from './aep-project-reader.ts';
import { aepTextAt as at, parseAepTextDictionary, type AepTextValue } from './aep-text-dictionary.ts';
export interface AepTextRun { readonly text: string; readonly font: string; readonly size: number; readonly tracking: number; readonly argb: readonly number[] }
export interface AepTextDocument {
	readonly runs: readonly AepTextRun[]; readonly align: number; readonly lineHeight: number;
	readonly box: readonly [number, number, number, number] | null; readonly limitations: readonly string[];
}
function numbers(value: AepTextValue | undefined, count?: number): readonly number[] {
	if (!Array.isArray(value) || (count !== undefined && value.length !== count) || value.some(item => typeof item !== 'number')) throw new TypeError('AEP text numeric array is malformed.'); return value as readonly number[];
}
function number(value: AepTextValue | undefined, fallback?: number): number {
	if (value === undefined && fallback !== undefined) return fallback;
	if (typeof value !== 'number') throw new TypeError('AEP text numeric field is missing.'); return value;
}
export function readAepText(layer: AepLayer): AepTextDocument | null {
	const properties = aepNamed(layer.properties, 'ADBE Text Properties'); if (!properties) return null;
	const document = aepNamed(aepNamedNodes(properties), 'ADBE Text Document'); if (!document) return null;
	const records = document.children?.filter(child => child.type === 'btdk') ?? [];
	if (records.length !== 1) throw new TypeError('Animated or absent native Source Text needs a separate mapping.');
	const root = parseAepTextDictionary(records[0]!.data), run = at(root, '1', '1', 0, '0'), raw = at(run, '0');
	if (typeof raw !== 'string' || raw.length > 65_537) throw new TypeError('Native Source Text is missing or exceeds its text budget.');
	const styles = at(run, '6', '0'), paragraphs = at(run, '5', '0');
	if (!Array.isArray(styles) || styles.length < 1 || styles.length > 1024 || !Array.isArray(paragraphs) || !paragraphs.length) throw new RangeError('AEP text run inventory is incomplete or exceeds its budget.');
	const limitations = ['Native text uses Motion shaping and reflow. AE baselines, wrapping, kerning and paragraph layout require visual review.'];
	let offset = 0; const runs: AepTextRun[] = [];
	for (const entry of styles) {
		const length = number(at(entry, '1')), style = at(entry, '0', '0', '6');
		if (!Number.isSafeInteger(length) || length < 1 || offset + length > raw.length) throw new TypeError('AEP text run coverage is inconsistent.');
		const fontIndex = number(at(style, '0')), font = at(root, '0', '1', '0', fontIndex, '0', '0', '0');
		if (typeof font !== 'string' || !Number.isSafeInteger(fontIndex) || fontIndex < 0 || font.length > 512) throw new TypeError('AEP text face identity is unresolved.');
		const text = raw.slice(offset, Math.min(offset + length, raw.endsWith('\r') ? raw.length - 1 : raw.length)).replace(/\r\n?/gu, '\n').split('\u0003').join('\n'); offset += length;
		if (text.normalize('NFC') !== text) throw new TypeError('AEP text requires a Unicode normalization policy; original characters remain in the AEP.');
		const size = number(at(style, '1')), argb = numbers(at(style, '53', '0', '1'), 4), tracking = number(at(style, '8'), 0);
		if (size < 1 || size > 4096 || argb.some(channel => channel < 0 || channel > 1)) throw new RangeError('AEP text style exceeds editable bounds.');
		if (at(style, '2') === true || at(style, '3') === true || number(at(style, '12'), 0) || number(at(style, '13'), 0) || number(at(style, '6'), 1) !== 1 || number(at(style, '7'), 1) !== 1 || number(at(style, '9'), 0) || at(style, '57') === true || at(style, '56') === false) limitations.push('Character styling such as faux styles, caps, baseline, scaling or stroke remains in the original AEP; only basic fill styling is applied.');
		runs.push({ text, font, size, tracking: tracking * size / 1000, argb });
	}
	if (offset !== raw.length) throw new TypeError('AEP style runs do not cover the complete Source Text.');
	const paragraph = at(paragraphs[0], '0', '0', '5'), align = number(at(paragraph, '0'), 0);
	if (paragraphs.some(entry => number(at(entry, '0', '0', '5', '0'), 0) !== align)) limitations.push('Mixed paragraph alignment remains in the original AEP; this draft uses the first paragraph alignment.');
	const firstStyle = at(styles[0], '0', '0', '6'), firstSize = runs[0]!.size;
	const lineHeight = at(firstStyle, '4') === true ? 1.2 : number(at(firstStyle, '5'), firstSize * 1.2) / firstSize;
	const frame = at(root, '0', '8', '0', 0, '0'), rawBox = at(frame, '1', '0'); let box: AepTextDocument['box'] = null;
	if (rawBox !== undefined) {
		const coords = numbers(rawBox, 32), xs = coords.filter((_, index) => index % 2 === 0), ys = coords.filter((_, index) => index % 2 === 1);
		box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
	}
	if (number(at(frame, '2', '1'), 0)) throw new TypeError('Vertical native text requires a separate layout mapping.');
	const property = aepChild(document, 'tdbs'), header = property && aepChild(property, 'tdb4');
	if (property && (aepChild(property, 'list') || aepChild(property, 'Utf8') || header?.data[68])) limitations.push('Animated Source Text or expressions remain in the original AEP; this draft uses the first text document.');
	return { runs, align, lineHeight, box, limitations: [...new Set(limitations)] };
}
