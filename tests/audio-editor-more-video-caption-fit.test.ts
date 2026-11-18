/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createVideoSource, createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import type { VideoBurnInStage } from '../src/common/editor/video-caption-burn-in.ts';

function captionPlan(title: string, width = 1_080, height = 1_920) {
	const source = createVideoSource({ id: 'camera', storageKey: 'camera.mp4',
		contentSha256: 'ab'.repeat(32), sampleFrameCount: 48_000, sourceFrameCount: 30,
		frameRate: { num: 30, den: 1 }, width: 320, height: 180 });
	const project = createSoundscaperProject({ id: 'caption-fit', sampleRate: 48_000,
		primarySequenceId: 'main', sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['picture', 'labels'] }],
		sources: [source], clips: [{ id: 'picture', kind: 'video', sourceId: source.id, sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 }],
		tracks: [{ id: 'picture', type: 'video', clipIds: ['picture'] },
			createLabelTrack({ id: 'labels', labels: [{ id: 'cue', title, startFrame: 0, endFrame: 48_000 }] })],
	});
	return createVideoExportPlan(project, { includeAudio: false, canvas: { size: { width, height } },
		captions: { trackId: 'labels', mux: false, burnIn: true } });
}

test('MI16: a portrait movie wraps wide caption glyphs within its frame using the bundled font advance', () => {
	const title = 'W'.repeat(80);
	const plan = captionPlan(title);
	const stage = plan.filterPlan.burnIn as VideoBurnInStage;
	assert.equal(stage.fontSizePx, 55);
	assert.equal(stage.cues[0]?.text.replaceAll('\n', ''), title);
	const glyphWidth = Math.ceil(woffAdvance('W') * stage.fontSizePx);
	for (const line of stage.cues[0]!.text.split('\n')) {
		assert.ok(line.length * glyphWidth <= 1_080 * 0.9,
			`${line.length} W glyphs need ${line.length * glyphWidth}px, outside the delivered title-safe width`);
	}
});

test('MI17: multiline burned subtitles fit vertically inside the delivered movie', () => {
	const title = Array.from({ length: 20 }, (_, index) => `Line ${index + 1}`).join('\n');
	const plan = captionPlan(title, 1_280, 720);
	const stage = plan.filterPlan.burnIn as VideoBurnInStage;
	assert.equal(stage.cues[0]?.text, title);
	const lines = stage.cues[0]!.text.split('\n').length;
	const head = woffTables().get('head')!;
	const lineHeight = Math.ceil((head.readInt16BE(42) - head.readInt16BE(38)) / head.readUInt16BE(18) * stage.fontSizePx);
	const textHeight = lines * lineHeight + (lines - 1) * stage.lineSpacingPx;
	assert.ok(textHeight <= 720 - 2 * stage.bottomMarginPx,
		`${lines} caption lines need ${textHeight}px, outside the delivered title-safe height`);
	assert.ok(stage.fontSizePx >= 12, 'retain the maintained readable minimum');
	assert.throws(() => captionPlan(Array.from({ length: 100 }, () => 'W').join('\n'), 1_280, 720),
		/caption.*(?:tall|height)|(?:tall|height).*caption/iu,
		'a subtitle too tall even at the minimum needs a clear refusal before file encoding');
});

/** Independent measurement of the exact bundled font's cmap and horizontal metrics. */
function woffAdvance(character: string): number {
	const tables = woffTables();
	const cmap = tables.get('cmap')!;
	for (let index = 0; index < cmap.readUInt16BE(2); index++) {
		const entry = 4 + index * 8;
		const offset = cmap.readUInt32BE(entry + 4);
		if (cmap.readUInt16BE(entry) !== 3 || cmap.readUInt16BE(entry + 2) !== 1 || cmap.readUInt16BE(offset) !== 4) continue;
		const segments = cmap.readUInt16BE(offset + 6) / 2;
		const point = character.codePointAt(0)!;
		for (let segment = 0; segment < segments; segment++) {
			const end = cmap.readUInt16BE(offset + 14 + segment * 2);
			const start = cmap.readUInt16BE(offset + 16 + segments * 2 + segment * 2);
			if (point < start || point > end) continue;
			const delta = cmap.readInt16BE(offset + 16 + segments * 4 + segment * 2);
			const address = offset + 16 + segments * 6 + segment * 2;
			const range = cmap.readUInt16BE(address);
			const glyph = (range === 0 ? point + delta : cmap.readUInt16BE(address + range + (point - start) * 2) + delta) & 0xffff;
			return tables.get('hmtx')!.readUInt16BE(glyph * 4) / tables.get('head')!.readUInt16BE(18);
		}
	}
	throw new Error('The bundled font has no requested glyph.');
}

function woffTables(): ReadonlyMap<string, Buffer> {
	const file = readFileSync(new URL('../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff', import.meta.url));
	const tables = new Map<string, Buffer>();
	for (let index = 0; index < file.readUInt16BE(12); index++) {
		const entry = 44 + index * 20;
		const offset = file.readUInt32BE(entry + 4);
		const compressed = file.subarray(offset, offset + file.readUInt32BE(entry + 8));
		tables.set(file.toString('ascii', entry, entry + 4), compressed.length < file.readUInt32BE(entry + 12) ? inflateSync(compressed) : compressed);
	}
	return tables;
}
