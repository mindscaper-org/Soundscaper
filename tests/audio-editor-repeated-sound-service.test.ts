/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepeatedSoundService } from '../src/common/editor/controller/analysis/internal/repeated-sound-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

function fixture() {
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate('podcast');
	let project = { id: 'podcast', revision: 1, tracks: [{ id: 'voice', type: 'audio' }] };
	const reads: [number, number][] = [], commands: unknown[] = [], processing: boolean[] = [];
	const samples = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * i) * .3);
	const timeline = new Float32Array(24_000);
	for (const offset of [100, 14_950, 23_872]) timeline.set(samples, offset);
	const deps = {
		lifetime, copy: ENGLISH_COPY,
		getProject: () => project,
		captureProject: () => generation.capture(), assertProject: generation.assertCurrent.bind(generation),
		getSelection: () => ({ startFrame: 100, endFrame: 228, trackIds: ['voice'] }),
		getSelectedTrackId: () => 'voice', projectSampleRate: () => 1000,
		projectDurationFrames: () => timeline.length,
		renderAudio: async (_scope: string, range: { startFrame: number; endFrame: number }) => {
			reads.push([range.startFrame, range.endFrame]);
			const data = timeline.slice(range.startFrame, range.endFrame);
			return { sampleRate: 1000, numberOfChannels: 1, length: data.length, getChannelData: () => data };
		},
		commit: (command: unknown) => { commands.push(command); },
		setProcessing: (value: boolean) => { processing.push(value); }, publish() {},
	};
	return { deps, commands, reads, processing, generation, edit: () => { project = { ...project, revision: 2 }; } };
}

test('repeated-sound service searches the whole track in bounded overlapping windows and publishes one label-track command', async () => {
	const f = fixture();
	const result = await createRepeatedSoundService(f.deps)({ similarityThreshold: .99 });
	assert.equal(result.sourceTrackId, 'voice');
	assert.deepEqual(result.matches.map(match => [match.startFrame, match.endFrame, match.original]),
		[[100, 228, true], [14_950, 15_078, false], [23_872, 24_000, false]]);
	assert.equal(f.commands.length, 1);
	assert.partialDeepStrictEqual(f.commands[0], { type: 'track/add', track: {
		id: result.trackId, type: 'label', name: 'Repeated sounds', labels: [
			{ startFrame: 100, endFrame: 228, title: 'Original sound' },
			{ startFrame: 14_950, endFrame: 15_078, title: 'Repeated sound 1' },
			{ startFrame: 23_872, endFrame: 24_000, title: 'Repeated sound 2' },
		],
	} });
	assert.deepEqual(f.reads, [[100, 228], [0, 15_127], [15_000, 24_000]]);
	assert.deepEqual(f.processing, [true, false]);
});

test('a project edit, tab switch or cancellation during analysis cannot publish labels', async () => {
	for (const change of ['edit', 'switch', 'cancel'] as const) {
		const f = fixture(), render = f.deps.renderAudio;
		f.deps.renderAudio = async (scope, range) => {
			const data = await render(scope, range);
			if (change === 'edit') f.edit();
			else if (change === 'switch') f.generation.activate('other');
			else f.deps.lifetime.cancelTask('analysis');
			return data;
		};
		await assert.rejects(createRepeatedSoundService(f.deps)(), { name: 'AbortError' });
		assert.deepEqual(f.commands, []);
		assert.equal(f.processing.at(-1), false);
	}
});

test('an empty or ambiguous selection and an invalid threshold are refused before rendering', async () => {
	const f = fixture();
	for (const selection of [null, { startFrame: 100, endFrame: 100, trackIds: ['voice'] },
		{ startFrame: 100, endFrame: 228, trackIds: ['voice', 'other'] }]) {
		await assert.rejects(createRepeatedSoundService({ ...f.deps, getSelection: () => selection })());
	}
	await assert.rejects(createRepeatedSoundService(f.deps)({ similarityThreshold: 2 }));
	assert.deepEqual(f.commands, []); assert.deepEqual(f.reads, []);
});

test('an unmatched example still produces a track containing the original label', async () => {
	const f = fixture();
	const service = createRepeatedSoundService({ ...f.deps, projectDurationFrames: () => 1000 });
	const result = await service();
	assert.deepEqual(result.matches.map(match => match.startFrame), [100]);
});

test('copies before the selected original are labeled in chronological order', async () => {
	const f = fixture();
	const result = await createRepeatedSoundService({ ...f.deps,
		getSelection: () => ({ startFrame: 14_950, endFrame: 15_078, trackIds: ['voice'] }),
	})();
	assert.deepEqual(result.matches.map(match => [match.startFrame, match.original]), [[100, false], [14_950, true], [23_872, false]]);
	assert.partialDeepStrictEqual(f.commands[0], { track: { labels: [
		{ title: 'Repeated sound 1' }, { title: 'Original sound' }, { title: 'Repeated sound 2' },
	] } });
});

test('a reference audio file searches without a template selection and labels every match as a copy', async () => {
	const f = fixture();
	const result = await createRepeatedSoundService({ ...f.deps, getSelection: () => null })({}, undefined, {
		name: 'jingle.wav', sampleRate: 1000,
		channels: [Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * i) * .3)],
	});
	assert.deepEqual(result.matches.map(match => [match.startFrame, match.original]), [[100, false], [14_950, false], [23_872, false]]);
	assert.equal(f.reads[0]?.[0], 0, 'the external example is not read from the episode');
});
