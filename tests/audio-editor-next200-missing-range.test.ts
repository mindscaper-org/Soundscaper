/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { COPY, createAudioEditorController, createCurrentAudioEditorProject, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { MockAudioBuffer, createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { audioExportSourceInventory } from '../src/common/editor/controller/export/audio-export-source-inventory.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

let fixtureId = 0;
type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

for (const requested of ['selection', 'loop', { startFrame: 0, endFrame: 4800 }] as const) {
	test(`audio delivery ${typeof requested === 'string' ? requested : 'resolved range'} ignores a later unavailable source`, async () => {
		const fixture = await setup(48_000);
		try {
			assert.deepEqual(fixture.controller.getSnapshot().missingSourceIds, ['missing']);
			await fixture.controller.actions.export.start({ format: 'wav', bitDepth: 32, includeTail: false, range: requested });
			assert.equal(fixture.renders.length, 1);
			assert.deepEqual(fixture.renders[0], { startFrame: 0, endFrame: 4800 });
		} finally { await fixture.controller.dispose(); }
	});
}

for (const placement of [0, 2400, 4799]) test(`missing input at ${placement} remains required by the selected audio`, async () => {
	const fixture = await setup(placement);
	try {
		await assert.rejects(async () => await fixture.controller.actions.export.start({ format: 'wav', includeTail: false, range: 'selection' }), /Local sources missing/u);
		assert.equal(fixture.renders.length, 0);
	} finally { await fixture.controller.dispose(); }
});

test('whole-project export still requires the later missing input', async () => {
	const fixture = await setup(48_000);
	try { await assert.rejects(async () => await fixture.controller.actions.export.start({ format: 'wav', range: 'project' }), /Local sources missing/u); }
	finally { await fixture.controller.dispose(); }
});

test('source readiness keeps earlier history, exact endpoint exclusion and full-project scalar cache dependencies', () => {
	const source = createAudioSource({ id: 'input', sampleRate: 48_000, channelCount: 1, frameCount: 4800 });
	const clips = [
		createAudioClip({ id: 'history', sourceId: source.id, timelineStartFrame: 0, sourceDurationFrames: 4800 }),
		createAudioClip({ id: 'endpoint', sourceId: source.id, timelineStartFrame: 48_000, sourceDurationFrames: 4800 }),
		createAudioClip({ id: 'cached', sourceId: source.id, timelineStartFrame: 96_000, sourceDurationFrames: 4800, pitchCents: 100 }),
	];
	const project = createSoundscaperProject({ id: 'source-readiness', sampleRate: 48_000, sources: [source], clips,
		tracks: [createAudioTrack({ id: 'voice', clipIds: clips.map(clip => clip.id) })] });
	const before = JSON.stringify(project);
	const settings = { range: { startFrame: 24_000, endFrame: 48_000 }, masteringSequenceId: null };
	assert.deepEqual(audioExportSourceInventory(project, settings).clips.map(clip => clip.id), ['history', 'cached']);
	assert.equal(audioExportSourceInventory(project, { ...settings, range: 'project' }), project);
	assert.equal(audioExportSourceInventory(project, { ...settings, masteringSequenceId: 'order' }), project);
	assert.equal(JSON.stringify(project), before);
});

test('readiness resolves musical clip positions from the authored clock', () => {
	const tempoMap = { mode: 'musical' as const, events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] };
	const source = createAudioSource({ id: 'musical-input', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 });
	const clip = createAudioClip({ id: 'musical', sourceId: source.id, anchor: 'musical', musicalStartBeat: 2,
		musicalExtent: 'beat', musicalDurationBeats: 2, sourceDurationFrames: 48_000, linkPitchAndTempo: true }, { projectSampleRate: 48_000, tempoMap });
	const project = createSoundscaperProject({ id: 'musical-readiness', sampleRate: 48_000, tempoMap, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', clipIds: [clip.id] })] });
	assert.equal(audioExportSourceInventory(project, { range: { startFrame: 0, endFrame: 48_000 }, masteringSequenceId: null }).clips.length, 0);
	assert.equal(audioExportSourceInventory(project, { range: { startFrame: 0, endFrame: 48_001 }, masteringSequenceId: null }).clips.length, 1);
});

async function setup(placement: number) {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `missing-range-${placement}-${++fixtureId}` });
	const project = createCurrentAudioEditorProject({ id: 'missing-range', sampleRate: 48_000,
		sources: ['healthy', 'missing'].map(id => ({ id, storageKey: id, name: `${id}.wav`, sampleRate: 48_000, channelCount: 1, frameCount: 4800 })),
		clips: ['healthy', 'missing'].map((id, index) => ({ id, sourceId: id, title: id, timelineStartFrame: index ? placement : 0, sourceStartFrame: 0, sourceDurationFrames: 4800, durationFrames: 4800 })),
		tracks: ['healthy', 'missing'].map(id => ({ id, type: 'audio', name: id, clipIds: [id] })),
		selection: { startFrame: 0, endFrame: 4800, clipIds: [], trackIds: [] }, loop: { enabled: true, startFrame: 0, endFrame: 4800 },
	});
	const writer = await store.beginSourceWrite('healthy', { sampleRate: 48_000, channelCount: 1, chunkFrames: 65_536 });
	await writer.write([new Float32Array(4800).fill(.25)]); await writer.commit(); await store.saveProject(project);
	const renders: { startFrame: number; endFrame: number }[] = [];
	const options: Options & { renderSnapshot: (_project: unknown, range: { startFrame: number; endFrame: number }) => Promise<MockAudioBuffer> } = { headless: true, locale: 'en', copy: { ...COPY, localSourcesMissing: 'Local sources missing' },
		store, engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		renderSnapshot: async (_project: unknown, range: { startFrame: number; endFrame: number }) => {
			renders.push({ startFrame: range.startFrame, endFrame: range.endFrame }); return new MockAudioBuffer(2, 4800, 48_000);
		},
	};
	const controller = createAudioEditorController(null, options);
	await controller.ready; await controller.actions.project.open(project);
	return { controller, renders };
}
