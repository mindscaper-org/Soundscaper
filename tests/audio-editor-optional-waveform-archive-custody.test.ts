/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { assertAudioProjectArchivePcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { audioProject, assertSine, optionalPcmCacheSession } from './helpers/optional-pcm-cache-custody.ts';

for (const operation of ['tone', 'nyquist'] as const) test(`${operation} preserves actual authored PCM through waveform-cache failure, history and fresh Scape`, async context => {
	const nyquist = operation === 'nyquist' ? await loadNyquistWasm(readFileSync(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url))) : null;
	const { controller, store, cacheFailures } = await optionalPcmCacheSession(context, {
		...(nyquist ? { nyquistEvaluator: (request: Parameters<typeof nyquist.evaluate>[0]) => Promise.resolve(nyquist.evaluate(request)) } : {}),
	});
	const before = audioProject(structuredClone(controller.project));
	const history = controller.getSnapshot().history.undoEntries.length;
	if (operation === 'tone') await controller.actions.generators.generate('tone', { durationSeconds: .5, frequency: 440, amplitude: .8, channelCount: 1 });
	else await controller.actions.nyquist.evaluate({ source: '(scale .25 (osc 60 .5))', role: 'generate' });
	const published = audioProject(structuredClone(controller.project));
	assert.equal(published.clips.length, 1, JSON.stringify(controller.getSnapshot().status)); assert.equal(published.sources.length, 1);
	const source = published.sources[0]; assert.ok(source?.kind === 'audio');
	assert.equal(source.sampleRate, 48_000); assert.equal(source.channelCount, 1);
	assert.ok(cacheFailures() > 0, 'the optional cache really failed during this publication');
	assert.deepEqual(controller.getSnapshot().missingSourceIds, []);
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, published.clips);
	await controller.actions.project.flush();
	await assertAudioProjectArchivePcm(context, store, controller.project, (_name, channels) => {
		assert.equal(channels.length, 1); const channel = channels[0]!;
		if (operation === 'tone') {
			assert.equal(channel.length, 24_000); assertSine(channel, 48_000, 440, .8);
		} else {
			assert.equal(channel.length, 24_000);
			const peak = channel.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
			assert.ok(peak > .24 && peak < .26);
			const end = Math.min(channel.length, 24_000); let crossings = 0;
			for (let frame = 4_801; frame < end; frame++) if (channel[frame - 1]! <= 0 && channel[frame]! > 0) crossings++;
			const expected = 440 * 2 ** (-9 / 12);
			assert.ok(Math.abs(crossings * 48_000 / (end - 4_800) - expected) < 4, 'real Nyquist output retains independently authored middle C');
		}
	});
});

test('clip resampling publishes every 96 kHz source sample despite optional waveform-cache failure', async context => {
	const { controller, store, cacheFailures } = await optionalPcmCacheSession(context);
	const source = createAudioSource({ id: 'original', name: 'Healthy recording', sampleRate: 48_000, frameCount: 24_000, channelCount: 1 });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(24_000).fill(.25)]); await writer.commit();
	await controller.actions.project.open(createSoundscaperProject({ id: `${context.name}:recording`, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 24_000, sourceDurationFrames: 24_000 })] }));
	const before = audioProject(structuredClone(controller.project)); const previousFailures = cacheFailures();
	await controller.actions.clip.resample('clip', { sampleRate: 96_000 });
	const after = audioProject(structuredClone(controller.project));
	assert.equal(after.sampleRate, 48_000);
	const clip = after.clips[0]; assert.ok(clip?.kind === 'audio');
	assert.equal(clip.durationFrames, 24_000); assert.equal(clip.sourceDurationFrames, 48_000);
	const derived = after.sources.find(value => value.id === clip.sourceId); assert.ok(derived?.kind === 'audio');
	assert.equal(derived.sampleRate, 96_000); assert.equal(derived.frameCount, 48_000);
	assert.ok(cacheFailures() > previousFailures);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, after.clips);
	await controller.actions.project.flush();
	await assertAudioProjectArchivePcm(context, store, controller.project, (_name, channels) => {
		assert.equal(channels.length, 1);
		assert.ok(channels[0]?.length === 24_000 || channels[0]?.length === 48_000);
		for (const sample of channels[0]!) assert.ok(Math.abs(sample - .25) < 1e-7);
	});
});
