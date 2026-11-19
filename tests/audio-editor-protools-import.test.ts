/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProToolsDocument } from '../src/common/editor/protools-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { proToolsFixture } from './helpers/protools-import-fixture.ts';

for (const [version, bigEndian] of [[5, true], [8, false], [12, false], [12, true]] as const) {
	test(`Pro Tools ${version} ${bigEndian ? 'big' : 'little'} endian imports sample placement and source trims`, () => {
		const document = parseProToolsDocument(proToolsFixture({ version, bigEndian }), { fileName: 'Voice.ptx' });
		let next = 0;
		const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++next}` });
		const project = createCurrentAudioEditorProject(plan.project);
		assert.equal(document.format, 'protools'); assert.equal(document.sampleRate, 48000);
		assert.equal(project.title, 'Voice'); assert.equal(project.tracks[0]!.name, 'Dialogue');
		assert.equal(project.clips.length, 1);
		assert.equal(project.clips[0]!.timelineStartFrame, 24000);
		assert.equal(project.clips[0]!.sourceStartFrame, 12000);
		assert.equal(project.clips[0]!.durationFrames, 24000);
		assert.equal(document.media[0]!.path, 'Audio Files/voice.wav');
		assert.ok(plan.report.items.some(item => item.code === 'protools.media-missing'));
		assert.ok(plan.report.items.some(item => item.code === 'protools.mix-settings-omitted'));
	});
}

test('Pro Tools placements preserve more than 32 bits of sample position', () => {
	const document = parseProToolsDocument(proToolsFixture({ start: 2 ** 32 + 24000 }));
	assert.deepEqual(document.tracks[0]!.clips[0]!.start, { num: 67109239, den: 750 });
});

test('Pro Tools page-based XOR decodes metadata beyond the first 4 KiB', () => {
	const bytes = proToolsFixture({ pagePadding: true });
	assert.notEqual(bytes[0x1050], 0x5a);
	const document = parseProToolsDocument(bytes);
	assert.equal(document.sampleRate, 48000);
	assert.equal(document.tracks[0]!.clips[0]!.name, 'Phrase');
});

test('Pro Tools decoding never changes caller-owned bytes, including Node Buffer views', () => {
	const bytes = Buffer.from(proToolsFixture({ pagePadding: true })), original = Buffer.from(bytes);
	parseProToolsDocument(bytes);
	assert.ok(bytes.equals(original));
	assert.equal(parseProToolsDocument(bytes).tracks[0]!.clips.length, 1);
});

test('Pro Tools signatures, unknown XOR schemes and unsupported versions are refused', () => {
	const signature = proToolsFixture(); signature[1] = 0;
	assert.throws(() => parseProToolsDocument(signature), /signature|Pro Tools/iu);
	const scheme = proToolsFixture(); scheme[0x12] = 2;
	assert.throws(() => parseProToolsDocument(scheme), /scheme/iu);
	assert.throws(() => parseProToolsDocument(proToolsFixture({ version: 99 })), /version/iu);
	assert.throws(() => parseProToolsDocument(new Uint8Array(10)), /small|short|header/iu);
});

test('Pro Tools unrecognized regions and rendered fades are reported rather than played as user clips', () => {
	const missing = parseProToolsDocument(proToolsFixture({ regionIndex: 9 }));
	assert.equal(missing.tracks[0]!.clips.length, 0);
	assert.ok(missing.issues.some(item => item.code === 'protools.region-omitted'));
	const fade = parseProToolsDocument(proToolsFixture({ fadeRender: true }));
	assert.equal(fade.tracks[0]!.clips.length, 0);
	assert.ok(fade.issues.some(item => item.code === 'protools.fades-omitted'));
});

test('Pro Tools missing source references retain an offline edit and report the absent table entry', () => {
	const document = parseProToolsDocument(proToolsFixture({ sourceIndex: 9 }));
	assert.equal(document.tracks[0]!.clips.length, 1);
	assert.ok(document.issues.some(item => item.code === 'protools.source-reference-missing'));
});

test('Pro Tools rejects truncated structural blocks, oversized strings, unsafe counts and unsupported field widths', () => {
	const block = proToolsFixture({ seed: 0 });
	new DataView(block.buffer).setUint32(0x53, 0xffffffff, true);
	assert.throws(() => parseProToolsDocument(block), /block|truncated/iu);
	const name = proToolsFixture({ seed: 0 });
	new DataView(name.buffer).setUint32(Buffer.from(name).indexOf('Phrase') - 4, 0xfffffff0, true);
	assert.throws(() => parseProToolsDocument(name), /string|limit/iu);
	const width = proToolsFixture({ seed: 0 });
	width[Buffer.from(width).indexOf('Phrase') + 7] = 0xf0;
	assert.throws(() => parseProToolsDocument(width), /width/iu);
	const count = proToolsFixture({ seed: 0 });
	// The sample-rate block is 15 bytes, followed by the file-table header and count.
	new DataView(count.buffer).setUint32(0x50 + 15 + 9, 100001, true);
	assert.throws(() => parseProToolsDocument(count), /count/iu);
});

test('Pro Tools nested containers are refused at a bounded depth', () => {
	let nested = new Uint8Array();
	for (let index = 0; index < 70; index++) {
		const outer = new Uint8Array(nested.length + 9), view = new DataView(outer.buffer);
		outer[0] = 0x5a; view.setUint16(1, 1, true); view.setUint32(3, nested.length + 2, true); view.setUint16(7, 0x7f00, true);
		outer.set(nested, 9); nested = outer;
	}
	const header = proToolsFixture({ seed: 0 }).subarray(0, 0x50), bytes = new Uint8Array(header.length + nested.length);
	bytes.set(header); bytes.set(nested, header.length);
	assert.throws(() => parseProToolsDocument(bytes), /depth/iu);
});

test('Pro Tools UTF-8 filenames retain byte counts and resolve their original media names', () => {
	const document = parseProToolsDocument(proToolsFixture({ filename: 'Stimme – café.wav' }));
	assert.equal(document.media[0]!.path, 'Audio Files/Stimme – café.wav');
	assert.equal(document.media[0]!.name, 'Stimme – café.wav');
});
