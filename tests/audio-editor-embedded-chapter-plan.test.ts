/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { captureCanonicalCompressedPlanCore } from '../src/common/editor/controller/export/internal/direct/direct-compressed-plan.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { normalizeMediaExportSettings } from '../src/common/editor/media-export.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createEffect } from '../src/common/editor/effects.js';

function projectWithLabels() {
	return createCurrentAudioEditorProject({
		id: 'embedded-chapters', sampleRate: 48_000,
		tracks: [
			{ id: 'audio', type: 'audio' },
			{ id: 'labels', type: 'label', labels: [
				{ id: 'intro', startFrame: 0, endFrame: 0, title: 'Intro / 日本語' },
				{ id: 'outro', startFrame: 48_000, endFrame: 96_000, title: 'Outro' },
			] },
		],
	});
}

test('embedding labels is opt-in and remains a single compressed mix delivery', () => {
	const project = projectWithLabels();
	const range = { startFrame: 24_000, endFrame: 96_000 };
	for (const format of ['mp3', 'aac-m4a']) {
		const ordinary = createExportPlan(project, { format, range });
		assert.equal('embeddedChapters' in ordinary.encoding, false);
		const plan = createExportPlan(project, { format, range, sampleRate: 24_000, embedLabelChapters: true });
		assert.deepEqual(plan.encoding.embeddedChapters, [
			{ startFrame: 0, endFrame: 12_000, title: 'Intro / 日本語' },
			{ startFrame: 12_000, endFrame: 36_000, title: 'Outro' },
		]);
		assert.equal(plan.mode, 'mix');
		assert.equal(plan.outputs.length, 1);
		assert.equal(plan.archive, null);
		assert.ok(captureCanonicalCompressedPlanCore(plan), 'chapter settings survive direct compressed-plan admission');
		assert.deepEqual(normalizeMediaExportSettings(format, { ...plan.encoding, channelMapping: 'preserve' }), plan.encoding);
	}
});

test('the chosen chapter track feeds both chapter metadata and PCM cue writers', () => {
	const range = { startFrame: 0, endFrame: 96_000 };
	const project = createCurrentAudioEditorProject({
		sampleRate: 48_000,
		sources: [{ id: 'source', storageKey: 'source', frameCount: 96_000, channelCount: 2, sampleRate: 48_000 }],
		clips: [{ id: 'audio-clip', sourceId: 'source', durationFrames: 96_000 }],
		tracks: [
			{ id: 'audio', type: 'audio', clipIds: ['audio-clip'] },
			{ id: 'labels-a', type: 'label', labels: [{ id: 'a', startFrame: 0, endFrame: 0, title: 'Label A' }] },
			{ id: 'labels-b', type: 'label', labels: [{ id: 'b', startFrame: 24_000, endFrame: 36_000, title: 'Label B' }] },
		],
		timelineAnnotations: [0, 48_000].map((positionFrame, index) => ({
			id: `marker-${index}`, sequenceId: 'main-sequence', name: `Marker ${index + 1}`, kind: 'marker', anchor: 'sample',
			color: 'auto', batchId: null, opaqueExtensions: {}, positionFrame,
		})),
	});
	for (const format of ['mp3', 'aac-m4a']) {
		const plan = createExportPlan(project, { format, range, embedChapters: true, embeddedChapterTrack: 'markers' });
		assert.deepEqual(plan.encoding.embeddedChapters, [
			{ startFrame: 0, endFrame: 48_000, title: 'Marker 1' },
			{ startFrame: 48_000, endFrame: 96_000, title: 'Marker 2' },
		]);
		assert.deepEqual(plan.markers, []);
	}
	const mp3 = createExportPlan(project, { format: 'mp3', range, embedChapters: true, embeddedChapterTrack: 'label:labels-b' });
	assert.deepEqual(mp3.encoding.embeddedChapters, [{ startFrame: 24_000, endFrame: 36_000, title: 'Label B' }]);
	const adm = { mode: 'authored', programme: { name: 'Programme' }, content: { name: 'Content' },
		bed: { name: 'Stereo', layout: 'stereo', assignments: ['L', 'R'].map((bedChannel, sourceChannel) => ({
			stripKind: 'track', stripId: 'audio', sourceChannel, bedChannel,
		})) } };
	for (const format of ['wav', 'bwf', 'bw64', 'aiff']) {
		const options = { format, range, ...(format === 'bw64' ? { adm } : {}) };
		const cuePlan = createExportPlan(project, { ...options, embedChapters: true, embeddedChapterTrack: 'label:labels-b' });
		assert.deepEqual(cuePlan.markers.map(cue => [cue.label, cue.sampleOffset, cue.sampleLength]), [['Label B', 24_000, 12_000]]);
		const all = createExportPlan(project, { ...options, embedChapters: true, embeddedChapterTrack: 'all-label-tracks' });
		assert.deepEqual(all.markers.map(cue => cue.label), ['Label A', 'Label B']);
		const off = createExportPlan(project, { ...options, embedChapters: false });
		assert.deepEqual(off.markers, []);
	}
	assert.throws(() => createExportPlan(project, { format: 'wav', range, embedChapters: true, embeddedChapterTrack: 'label:missing' }), /No chapters occur/u);
});

test('explicit requests reject unsupported formats, split exports, sequences, and empty ranges', () => {
	const project = projectWithLabels();
	const options = { embedLabelChapters: true, range: { startFrame: 0, endFrame: 96_000 } };
	for (const format of ['wav', 'flac', 'opus', 'ogg-vorbis', 'custom-ffmpeg']) {
		assert.throws(() => createExportPlan(project, { ...options, format, extension: 'mka', customArguments: ['-c:a', 'aac'] }), /chapter.*format|MP3.*M4A/iu);
	}
	for (const mode of ['stems', 'chapters', 'clips']) {
		assert.throws(() => createExportPlan(project, { ...options, format: 'mp3', mode }), /chapter.*mix|single.*mix/iu);
	}
	assert.throws(() => createExportPlan(project, {
		...options, format: 'mp3', masteringSequenceId: 'sequence',
	}), /chapter.*sequence|sequence.*chapter/iu);
	assert.throws(() => createExportPlan(project, {
		...options, format: 'mp3', range: { startFrame: 100_000, endFrame: 120_000 },
	}), /label.*range/iu);
});

test('MP3 delivery refuses a region that would have empty ID3 chapter timing', () => {
	const project = createCurrentAudioEditorProject({ sampleRate: 48_000, tracks: [{
		id: 'labels', type: 'label', labels: [{ id: 'short', title: 'Short region', startFrame: 48, endFrame: 60 }],
	}] });
	const options = { range: { startFrame: 0, endFrame: 48_000 }, embedLabelChapters: true };
	assert.throws(() => createExportPlan(project, { ...options, format: 'mp3' }), /MP3.*chapter.*same millisecond/u);
	assert.deepEqual(createExportPlan(project, { ...options, format: 'mp3', embedLabelChapters: false }).encoding.embeddedChapters, undefined);
});

test('encoding settings preserve and validate chapter data without changing ordinary settings', () => {
	const chapters = [{ startFrame: 0, endFrame: 48_000, title: 'One' }];
	const normalized = normalizeMediaExportSettings('mp3', { embeddedChapters: chapters });
	assert.deepEqual(normalized.embeddedChapters, chapters);
	assert.notEqual(normalized.embeddedChapters, chapters);
	assert.equal(Object.isFrozen(normalized.embeddedChapters), true);
	assert.throws(() => normalizeMediaExportSettings('flac', { embeddedChapters: chapters }), /MP3.*M4A/iu);
	assert.throws(() => normalizeMediaExportSettings('mp3', {
		embeddedChapters: [{ startFrame: 10, endFrame: 1, title: 'Bad' }],
	}), /chapter/iu);
	assert.throws(() => normalizeMediaExportSettings('mp3', {
		embeddedChapters: [{ startFrame: 0, endFrame: 4_294_967_295 * 48 + 1, title: 'Too long' }],
	}), /MP3.*chapter.*time/iu);
	assert.throws(() => normalizeMediaExportSettings('aac-m4a', {
		embeddedChapters: [{ startFrame: 0, endFrame: 48_000, title: 'あ'.repeat(86) }],
	}), /M4A.*255/iu);
	assert.throws(() => normalizeMediaExportSettings('aac-m4a', {
		embeddedChapters: Array.from({ length: 256 }, (_, index) => ({ startFrame: index, endFrame: index + 1, title: '' })),
	}), /M4A.*255/iu);
});

test('last point chapters include delivered effect tails and the final enclosing output frame', () => {
	const created = createCurrentAudioEditorProject({
		id: 'point-chapter-tail', sampleRate: 48_000,
		tracks: [
			{ id: 'audio', type: 'audio', effects: [createEffect('delay', { params: { time: 0.25, feedback: 0, mix: 0.5 } })] },
			{ id: 'labels', type: 'label', labels: [{ id: 'one', startFrame: 0, endFrame: 0, title: 'One' }] },
		],
	});
	const plan = createExportPlan(created, { format: 'mp3', range: { startFrame: 0, endFrame: 48_000 }, embedLabelChapters: true, includeTail: true });
	assert.ok(plan.tailFrames > 0);
	assert.ok(plan.encoding.embeddedChapters);
	assert.equal(plan.encoding.embeddedChapters[0].endFrame, plan.outputFrames);
	const oneFrame = createExportPlan(created, { format: 'aac-m4a', sampleRate: 8_000, range: { startFrame: 0, endFrame: 1 }, embedLabelChapters: true, includeTail: false });
	assert.equal(oneFrame.outputFrames, 1);
	assert.deepEqual(oneFrame.encoding.embeddedChapters, [{ startFrame: 0, endFrame: 1, title: 'One' }]);
});
