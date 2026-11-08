/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportPlan } from '../src/common/editor/export.js';
import { createExportChapterPlan } from '../src/common/editor/export-chapters.ts';
import { createExportClipPlan } from '../src/common/editor/export-clips.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioMetadataId3Tag } from '../src/common/editor/id3-metadata.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { encodeAiff } from '../src/common/editor/aiff.js';

function project(sampleRate = 48_000) {
	return createSoundscaperProject({ id: 'timed-lyrics', sampleRate,
		sources: [{ id: 's', name: 'Pulse.wav', storageKey: 's', frameCount: sampleRate, channelCount: 1,
			sampleRate, originalSampleRate: sampleRate, sampleFormat: 'float32', chunkFrames: 65_536, mimeType: 'audio/wav' }],
		tracks: [{ id: 't', type: 'audio', name: 'Pulse', clipIds: ['c'] }],
		clips: [{ id: 'c', sourceId: 's', title: 'Pulse', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: sampleRate }],
		metadata: { tags: { synchronizedLyrics: '[00:00.750]Pulse' } },
	});
}

for (const format of ['wav', 'aiff', 'bwf'] as const) test(`${format} selected delivery rebases retained timed lyrics without retaining outside words`, () => {
	const original = project(); const snapshot = JSON.stringify(original);
	const plan = createExportPlan(original, { format, bitDepth: 16, range: { startFrame: 24_000, endFrame: 48_000 }, metadata: {
		synchronizedLyrics: '[00:00.100]Before\n[00:00.750]Pulse\n[00:01.000]After',
		synchronizedLyricsLanguage: 'fra', synchronizedLyricsDescription: 'Scene', comments: 'Verbatim notes',
	} });
	assert.equal(plan.metadata.synchronizedLyrics, '[00:00.250]Pulse');
	assert.deepEqual(plan.encoding.metadata, plan.metadata);
	assert.equal(plan.metadata.synchronizedLyricsLanguage, 'fra');
	assert.equal(plan.metadata.synchronizedLyricsDescription, 'Scene');
	assert.equal(plan.metadata.comments, 'Verbatim notes');
	assert.deepEqual(lyricTimes(createAudioMetadataId3Tag(plan.metadata)), [250]);
	const channels = Array.from({ length: plan.channelCount }, () => new Float32Array(plan.outputFrames));
	const encoded = format === 'aiff' ? encodeAiff(channels, { sampleRate: plan.sampleRate, sampleFormat: plan.encoding.sampleFormat, metadata: plan.metadata })
		: encodeWav(channels, { sampleRate: plan.sampleRate, bitDepth: 16, metadata: plan.metadata, bext: plan.bext });
	assert.ok(encoded instanceof Uint8Array);
	assert.equal(encoded.byteLength, plan.outputFileBytesPerRender);
	assert.equal(JSON.stringify(original), snapshot);
});

test('whole-file timed lyrics preserve their exact authored text and ordinary metadata', () => {
	const text = '[00:00.125]  Élodie\r\n[00:00.750]東京';
	const metadata = { synchronizedLyrics: text, artist: 'Artist' };
	const plan = createExportPlan(project(), { format: 'wav', metadata });
	assert.deepEqual(plan.metadata, metadata);
	assert.equal(plan.metadata.synchronizedLyrics, text);
});

test('a right-only cut removes future words while retaining exact zero-origin entries', () => {
	const plan = createExportPlan(project(), { format: 'wav', range: { startFrame: 0, endFrame: 24_000 },
		metadata: { synchronizedLyrics: '[00:00.125]Early\n[00:00.750]Later' } });
	assert.equal(plan.metadata.synchronizedLyrics, '[00:00.125]Early');
});

test('a range with no authored lyric onset emits no invented pre-cut duration or empty SYLT frame', () => {
	const plan = createExportPlan(project(), { format: 'wav', range: { startFrame: 24_000, endFrame: 48_000 },
		metadata: { synchronizedLyrics: '[00:00.125]Before', synchronizedLyricsLanguage: 'eng', artist: 'Kept' } });
	assert.equal(plan.metadata.synchronizedLyrics, undefined);
	assert.deepEqual(lyricTimes(createAudioMetadataId3Tag(plan.metadata)), []);
	assert.equal(plan.metadata.artist, 'Kept');
});

test('timed-lyric aliases use the same physical-time range independently of export rate', () => {
	for (const sampleRate of [44_100, 96_000]) {
		const plan = createExportPlan(project(), { format: 'wav', sampleRate, range: { startFrame: 24_000, endFrame: 48_000 },
			metadata: { SYNCHRONIZED_LYRICS: '[00:00.750]Pulse' } });
		assert.equal(plan.metadata.SYNCHRONIZED_LYRICS, '[00:00.250]Pulse');
		assert.deepEqual(lyricTimes(createAudioMetadataId3Tag(plan.metadata)), [250]);
	}
});

test('fractional-millisecond sample origins round the final lyric position once', () => {
	for (const [startFrame, expected] of [[22, 1], [23, 0]] as const) {
		const plan = createExportPlan(project(44_100), { format: 'wav', sampleRate: 96_000,
			range: { startFrame, endFrame: 44_100 }, metadata: { synchronizedLyrics: '[00:00.001]Onset' } });
		assert.deepEqual(lyricTimes(createAudioMetadataId3Tag(plan.metadata)), [expected]);
	}
});

test('each delivered chapter carries its own lyrics in both writer metadata copies', () => {
	const base = project();
	const split = createSoundscaperProject({ ...base, sequences: undefined, tracks: [...base.tracks,
		{ id: 'labels', type: 'label', name: 'Delivery', labels: [
			{ id: 'first', title: 'First', startFrame: 0, endFrame: 24_000 },
			{ id: 'second', title: 'Second', startFrame: 24_000, endFrame: 48_000 },
		] }],
	});
	const plan = createExportPlan(split, { format: 'wav', mode: 'chapters', metadata: {
		synchronizedLyrics: '[00:00.250]Early\n[00:00.750]Late',
	} });
	assert.equal(plan.outputs.length, 2);
	for (const [index, output] of plan.outputs.entries()) {
		const chapter = createExportChapterPlan(plan, output);
		assert.equal(chapter.metadata.synchronizedLyrics, `[00:00.250]${index ? 'Late' : 'Early'}`);
		assert.deepEqual(chapter.encoding.metadata, chapter.metadata);
		assert.deepEqual(lyricTimes(createAudioMetadataId3Tag(chapter.metadata)), [250]);
	}
});

test('stems retain the selected range clock rather than the project origin', () => {
	const plan = createExportPlan(project(), { format: 'wav', mode: 'stems', range: { startFrame: 24_000, endFrame: 48_000 },
		metadata: { synchronizedLyrics: '[00:00.750]Pulse' } });
	assert.equal(plan.metadata.synchronizedLyrics, '[00:00.250]Pulse');
});

test('reordered repeated mastering regions and gaps map lyrics through the declared delivered segments', () => {
	const ordered = masteredProject([
		{ id: 'one', annotationId: 'late', gapBeforeFrames: 4800 },
		{ id: 'two', annotationId: 'early', gapBeforeFrames: 9600 },
		{ id: 'three', annotationId: 'late' },
	]);
	const plan = createExportPlan(ordered, { format: 'wav', sampleRate: 96_000, masteringSequenceId: 'order',
		metadata: { synchronizedLyrics: '[00:00.250]Early\n[00:00.750]Late' } });
	assert.equal(plan.metadata.synchronizedLyrics, '[00:00.350]Late\n[00:01.050]Early\n[00:01.550]Late');
	assert.deepEqual(lyricTimes(createAudioMetadataId3Tag(plan.metadata)), [350, 1050, 1550]);
});

test('repeated lyric expansion retains the existing metadata value limit', () => {
	const ordered = masteredProject(Array.from({ length: 80 }, (_, index) => ({ id: `entry-${index}`, annotationId: 'late' })));
	assert.throws(() => createExportPlan(ordered, { format: 'wav', masteringSequenceId: 'order',
		metadata: { synchronizedLyrics: `[00:00.750]${'a'.repeat(1000)}` } }), /Metadata field synchronizedLyrics is too long/u);
});

test('clip artifacts use the project position of their own occurrence', () => {
	const base = project();
	const split = createSoundscaperProject({ ...base, sequences: undefined, mixer: undefined,
		tracks: [{ id: 't', type: 'audio', name: 'Pulse', clipIds: ['c', 'second'] }],
		clips: [...base.clips, { id: 'second', sourceId: 's', title: 'Again', timelineStartFrame: 96_000, sourceStartFrame: 0, durationFrames: 48_000 }],
	});
	const plan = createExportPlan(split, { format: 'wav', mode: 'clips', metadata: { synchronizedLyrics: '[00:00.750]First\n[00:02.750]Again' } });
	assert.equal(plan.outputs.length, 2);
	for (const [index, output] of plan.outputs.entries()) {
		const clip = createExportClipPlan(plan, output);
		assert.equal(clip.metadata.synchronizedLyrics, `[00:00.750]${index ? 'Again' : 'First'}`);
		assert.deepEqual(clip.encoding.metadata, clip.metadata);
	}
});

test('invalid lyric syntax retains the existing owning ID3 refusal', () => {
	assert.throws(() => createExportPlan(project(), { format: 'wav', range: { startFrame: 24_000, endFrame: 48_000 },
		metadata: { synchronizedLyrics: 'invalid syntax' } }), /Timed lyrics require/u);
});

function masteredProject(entries: readonly Readonly<Record<string, unknown>>[]) {
	const base = project(); const sequenceId = base.primarySequenceId;
	return createSoundscaperProject({ ...base,
		timelineAnnotations: ([['early', 0, 24_000], ['late', 24_000, 48_000]] as const).map(([id, startFrame, endFrame]) => ({
			id, sequenceId, kind: 'region', anchor: 'sample', name: id, startFrame, endFrame, color: 'auto', batchId: null, opaqueExtensions: {},
		})),
		masteringSequences: [{ id: 'order', sequenceId, name: 'Order', entries }],
	});
}

function lyricTimes(tag: Uint8Array): number[] {
	for (let offset = 10; offset + 10 <= tag.length;) {
		const length = tag.subarray(offset + 4, offset + 8).reduce((value, byte) => value * 128 + byte, 0);
		const id = new TextDecoder().decode(tag.subarray(offset, offset + 4));
		if (id === 'SYLT') {
			const payload = tag.subarray(offset + 10, offset + 10 + length), times: number[] = [];
			let index = payload.indexOf(0, 6) + 1;
			while (index < payload.length) {
				index = payload.indexOf(0, index) + 1;
				times.push(new DataView(payload.buffer, payload.byteOffset + index, 4).getUint32(0)); index += 4;
			}
			return times;
		}
		offset += 10 + length;
	}
	return [];
}
