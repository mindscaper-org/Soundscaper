/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Icon } from '../vendor/audacity-design-system/components/src/Icon/Icon.tsx';
import { MUSESCORE_ICON_CODES, iconNameToChar } from '../vendor/audacity-design-system/components/src/Icon/icon-codes.ts';
import { MUSESCORE_ICON_CODES as EDITOR_ICON_CODES } from '../src/common/editor/audacity-iconcodes.js';
const ICON_FONT = new URL(
	'../vendor/audacity-design-system/components/src/assets/fonts/MusescoreIcon.ttf',
	import.meta.url,
);

// MuseScore's IconCode, which the bundled font is cut from:
// `framework/ui/view/iconcodes.h` in `musescore/muse_framework`.
const SHARE_FILE = 0xef24;
const IMPORT = 0xf357;
const ERROR = 0xf3d0;

test('editor and design-system icon consumers use the named code inventory', () => {
	const rawIcon = /\\u(?:[ef][0-9a-f]{3}|\{[ef][0-9a-f]{3}\})|\\[ef][0-9a-f]{3}\b|0x(?:e[0-9a-f]{3}|f[0-8][0-9a-f]{2})\b|[\uE000-\uF8FF]|&#(?:x[ef][0-9a-f]{3}|[0-9]{5});/giu;
	const findings: string[] = [];
	for (const directory of ['src/common/editor/ui/', 'vendor/audacity-design-system/components/src/']) {
		const root = new URL(`../${directory}`, import.meta.url);
		for (const relativePath of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
			const path = relativePath.replaceAll('\\', '/');
			if (!/\.(?:[cm]?[jt]sx?|css)$/u.test(path) || path === 'Icon/icon-codes.ts') continue;
			const source = readFileSync(new URL(path, root), 'utf8');
			for (const match of source.matchAll(rawIcon)) findings.push(`${directory}${path}: ${match[0]}`);
		}
	}
	assert.deepEqual(findings, [], 'Font codepoints belong in the named inventory, not its consumers.');
});

test('the editor names the bundled monitor and both graduation-cap aliases', () => {
	assert.equal(iconNameToChar('DESKTOP_MONITOR'), '\uF35E');
	assert.equal(iconNameToChar('GRADUATION_CAP'), '\uEF74');
	assert.equal(iconNameToChar('GRADUATION_CAP'), iconNameToChar('MORTAR_BOARD'));
	for (const [name, codepoint] of [['LIKE', 0xf3c5], ['DISLIKE', 0xf3c6], ['ERASER', 0xf3cc]] as const) {
		assert.equal(iconNameToChar(name), String.fromCodePoint(codepoint));
	}
});

test('shared local names preserve glyphs omitted from the upstream enum', () => {
	for (const [name, codepoint] of [
		['GRID_VIEW', 0xf35b], ['CLOUD_DOWNLOAD', 0xf450], ['SPARKLES', 0xf476], ['SLIDERS', 0xf4a8],
	] as const) {
		assert.equal(iconNameToChar(name), String.fromCodePoint(codepoint));
	}
});

test('the icon inventory identifies every name without a bundled glyph', () => {
	assert.equal(EDITOR_ICON_CODES, MUSESCORE_ICON_CODES);
	const codepoints = readIconFontCodepoints(readFileSync(ICON_FONT));
	assert.deepEqual(Object.entries(MUSESCORE_ICON_CODES)
		.filter(([, codepoint]) => !codepoints.has(codepoint)).map(([name]) => name), ['NONE']);
});

test('the updated upstream font carries video, filled status, page lock and fade handles', () => {
	const codepoints = readIconFontCodepoints(readFileSync(ICON_FONT));
	assert.equal(codepoints.size, 564);
	for (const [name, codepoint] of [
		['VIDEO', 0xf4c2], ['PAGE_LOCK', 0xf4c3], ['TICK_FILLED', 0xf4c4], ['ERROR_FILLED', 0xf4c6],
		['WARNING_FILLED', 0xf4c8], ['INFO_FILLED', 0xf4cc], ['FADE_HANDLE_IN', 0xf4cd], ['FADE_HANDLE_OUT', 0xf4ce],
	] as const) {
		assert.equal(iconNameToChar(name), String.fromCodePoint(codepoint), name);
		assert.ok(codepoints.has(codepoint), `${name} must exist in the bundled font.`);
	}
});

test('the font source, derivative and retained upstream license match their provenance pins', () => {
	const provenance = JSON.parse(readFileSync(new URL('../config/musescore-icon-font.json', import.meta.url), 'utf8')) as {
		readonly artifacts: readonly { readonly path: string; readonly byteLength: number; readonly sha256: string }[];
	};
	for (const artifact of provenance.artifacts) {
		const bytes = readFileSync(new URL(`../${artifact.path}`, import.meta.url));
		assert.equal(bytes.byteLength, artifact.byteLength, artifact.path);
		assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256, artifact.path);
	}
});

test('design-system names render the matching bundled glyphs', () => {
	for (const [name, codepoint] of [
		['mixer', 0xef27], ['lock', 0xef5c], ['eye', 0xef53], ['midi', 0xef98],
		['rewind', 0xf448], ['forward', 0xf449], ['zoom-to-fit', 0xf438], ['zoom-to-selection', 0xf439],
	] as const) {
		const markup = renderToStaticMarkup(React.createElement(Icon, { name }));
		assert.ok(markup.includes(String.fromCodePoint(codepoint)), `${name} must render its named glyph.`);
	}
});

test('the Icon map exposes MuseScore IMPORT under its own name beside SHARE_FILE', () => {
	const imported = renderToStaticMarkup(React.createElement(Icon, { name: 'import' }));
	const exported = renderToStaticMarkup(React.createElement(Icon, { name: 'export' }));
	assert.ok(imported.includes(String.fromCodePoint(IMPORT)));
	assert.ok(exported.includes(String.fromCodePoint(SHARE_FILE)));
});

test('the bundled icon font carries the import, share and error toast glyphs', () => {
	const codepoints = readIconFontCodepoints(readFileSync(ICON_FONT));
	assert.ok(
		codepoints.has(IMPORT),
		'MusescoreIcon.ttf must carry IconCode::IMPORT; without the glyph the name renders blank.',
	);
	assert.ok(codepoints.has(SHARE_FILE));
	assert.ok(codepoints.has(ERROR), 'The error toast must use a glyph available in MusescoreIcon.ttf.');
});

/** Reads the character map of a TrueType font as the set of mapped codepoints. */
function readIconFontCodepoints(font: Buffer): Set<number> {
	const tableCount = font.readUInt16BE(4);
	let cmap = 0;
	for (let index = 0; index < tableCount; index += 1) {
		const record = 12 + index * 16;
		if (font.toString('ascii', record, record + 4) === 'cmap') cmap = font.readUInt32BE(record + 8);
	}
	assert.ok(cmap, 'The icon font must carry a cmap table.');
	let segmented = 0;
	const subtableCount = font.readUInt16BE(cmap + 2);
	for (let index = 0; index < subtableCount; index += 1) {
		const offset = font.readUInt32BE(cmap + 4 + index * 8 + 4);
		if (font.readUInt16BE(cmap + offset) === 4) segmented = cmap + offset;
	}
	assert.ok(segmented, 'The icon font must carry a format-4 cmap subtable.');
	const segmentBytes = font.readUInt16BE(segmented + 6);
	const ends = segmented + 14;
	const starts = ends + segmentBytes + 2;
	const deltas = starts + segmentBytes;
	const ranges = deltas + segmentBytes;
	const codepoints = new Set<number>();
	for (let segment = 0; segment < segmentBytes / 2; segment += 1) {
		const start = font.readUInt16BE(starts + segment * 2);
		const end = font.readUInt16BE(ends + segment * 2);
		const delta = font.readInt16BE(deltas + segment * 2);
		const rangeOffset = font.readUInt16BE(ranges + segment * 2);
		if (start === 0xffff) continue;
		for (let codepoint = start; codepoint <= end; codepoint += 1) {
			if (rangeOffset === 0) {
				if ((codepoint + delta) & 0xffff) codepoints.add(codepoint);
				continue;
			}
			const glyphIndex = ranges + segment * 2 + rangeOffset + (codepoint - start) * 2;
			if (glyphIndex + 1 >= font.length) continue;
			if (font.readUInt16BE(glyphIndex)) codepoints.add(codepoint);
		}
	}
	return codepoints;
}
