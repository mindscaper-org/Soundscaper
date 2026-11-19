/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

const RATE = 48_000, FRAMES = 96_000;
type Position = 'pre-fader' | 'post-fader';
type Detector = 'tone' | 'muted' | 'zero' | 'master';

function originalInput(position: Position, detector: Detector) {
	const sources = ['programme', 'detector'].map(id => createAudioSource({ id, storageKey: id, name: id,
		sampleRate: RATE, channelCount: 1, frameCount: FRAMES }));
	const base = createSoundscaperProject({ id: `analysis-${position}-${detector}`, sampleRate: RATE, sources,
		clips: sources.map(source => createAudioClip({ id: `${source.id}-clip`, sourceId: source.id, title: source.name,
			durationFrames: FRAMES, sourceDurationFrames: FRAMES })),
		tracks: sources.map(source => createAudioTrack({ id: source.id, name: source.name, clipIds: [`${source.id}-clip`],
			...(source.id === 'programme' ? { effectsActive: true, effects: [createEffect('gate', { id: 'gate',
				params: { threshold: -30, attack: 0, hold: .1, release: .01, rangeDb: -80 } })] } : { mute: detector === 'muted' }) })),
		selection: { startFrame: 0, endFrame: FRAMES, trackIds: ['programme', 'detector'], clipIds: [] } });
	const master = detector === 'master';
	const project = createSoundscaperProject({ ...base,
		...(master ? { master: { ...base.master, gain: .001, effects: [createEffect('gate', { id: 'master-control-gate' })] } } : {}),
		mixer: { ...base.mixer, edges: [...base.mixer.edges.map(edge => master && edge.source.kind === 'track' && edge.source.id === 'programme'
			? { ...edge, destination: { kind: 'output', id: 'main' } } : edge),
			{ id: 'key', kind: 'sidechain', source: master ? { kind: 'master' } : { kind: 'track', id: 'detector' },
				destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'programme' }, effectId: 'gate' },
				position, enabled: true, level: 1, channelMap: [0] }],
		} });
	const programme = Float32Array.from({ length: FRAMES }, (_, frame) => .1 * Math.sin(2 * Math.PI * 440 * frame / RATE));
	const key = Float32Array.from({ length: FRAMES }, (_, frame) => (detector === 'zero' ? 0 : .5) * Math.sin(2 * Math.PI * 880 * frame / RATE));
	const expectedProgramme = Float32Array.from(programme, sample => sample * Math.SQRT1_2 * (detector === 'tone' ? 1 : .0001));
	const expectedDelivery = Float32Array.from(expectedProgramme, (sample, frame) => {
		if (detector === 'muted' || detector === 'zero') return sample;
		// The master Gate starts at -80 dB and has its original 5 ms zero-to-open attack.
		const masterGain = master ? .001 * (1 - .9999 * Math.exp(-frame / (RATE * .005))) : 1;
		return sample + key[frame]! * Math.SQRT1_2 * masterGain;
	});
	return { project: clipboardProject(project), pcm: new Map([['programme', [programme]], ['detector', [key]]]), expectedProgramme, expectedDelivery };
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertDelivery(channels: readonly Float32Array[], expected: Float32Array) {
	assert.equal(channels.length, 2);
	for (const [channel, samples] of channels.entries()) {
		assert.equal(samples.length, FRAMES);
		for (let frame = 0; frame < FRAMES; frame++) if (!(Math.abs(samples[frame]! - expected[frame]!) < 1e-7))
			assert.fail(`independent analysis delivery channel${channel}/frame${frame}: ${samples[frame]} versus ${expected[frame]}`);
	}
}

for (const [position, detector] of [
	['pre-fader', 'tone'], ['post-fader', 'tone'], ['post-fader', 'muted'], ['post-fader', 'zero'], ['post-fader', 'master'],
] as const) test(`real Plot spectrum retains original ${position} ${detector} detector PCM and report`, { timeout: 30_000 }, async context => {
	const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine(), archive = createSoundscaperScapeNativeRuntime();
	const { controller, store } = await controllerSession(context, { engine, engineFactory: native.createEngine, scapeProjectRuntime: archive });
	const input = originalInput(position, detector), donor = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		assert.equal(typeof globalThis.Worker, 'undefined', 'the shipping analysis client must select its genuine CPU fallback');
		for (const source of input.project.sources) {
			assert.ok(source.kind === 'audio'); const pcm = input.pcm.get(source.id); assert.ok(pcm);
			const writer = await donor.beginSourceWrite(source.storageKey, source);
			for (let offset = 0; offset < FRAMES; offset += source.chunkFrames) await writer.write(pcm.map(channel => channel.slice(offset, offset + source.chunkFrames)));
			await writer.commit();
		}
		const exported = await archive.exportScapeProject(input.project, donor); assert.ok(exported.blob);
		await controller.actions.project.openScapeFile(new File([exported.blob], 'sidechain.sscape', { type: 'application/zip' }), () => 'copy');
		await controller.actions.project.flush();
		const baseline = clipboardProject(controller.project), buffers = new Map<string, AudioBuffer>();
		assert.deepEqual(clipboardDocument(baseline), clipboardDocument(input.project));
		for (const source of baseline.sources) {
			assert.ok(source.kind === 'audio'); const expected = input.pcm.get(source.id); assert.ok(expected);
			assertPcmChannelsEqual(await readCustodyPcm(store, source), expected, `all original ${source.id} samples`);
			const buffer = await store.loadSourceAudioBuffer(source.storageKey, await engine.getAudioContext({ resume: false }));
			assert.ok(buffer instanceof AudioBuffer); buffers.set(source.id, buffer);
		}
		const renderer = native.createEngine();
		try {
			renderer.loadProject(projectForRuntimeConsumers(baseline), buffers);
			const rendered = await renderer.renderMix({ startFrame: 0, endFrame: FRAMES }); assert.ok(rendered instanceof AudioBuffer);
			assert.deepEqual([rendered.sampleRate, rendered.length, rendered.numberOfChannels], [RATE, FRAMES, 2]);
			assertDelivery([rendered.getChannelData(0), rendered.getChannelData(1)], input.expectedDelivery);
		} finally { await renderer.dispose(); }
		const history = controller.getSnapshot().history;
		const result: unknown = await controller.actions.analysis.plotSpectrum('master');
		assert.ok(record(result) && result.type === 'spectrum' && Array.isArray(result.tracks));
		assert.deepEqual([result.scope, result.startFrame, result.endFrame, result.sampleRate, result.size], ['master', 0, FRAMES, RATE, 2048]);
		assert.equal(result.tracks.length, 2);
		const programme: unknown = result.tracks.find((track: unknown) => record(track) && track.trackId === 'programme');
		assert.ok(record(programme) && record(programme.peak)); const peakDb = programme.peak.db;
		assert.ok(typeof peakDb === 'number');
		let real = 0, imaginary = 0;
		for (let frame = 9600; frame < 76_800; frame++) {
			const phase = 2 * Math.PI * 440 * frame / RATE;
			real += input.expectedProgramme[frame]! * Math.cos(phase); imaginary += input.expectedProgramme[frame]! * Math.sin(phase);
		}
		const amplitude = 2 * Math.hypot(real, imaginary) / 67_200;
		assert.ok(detector === 'tone' ? amplitude > .06 && amplitude < .08 : amplitude < .00001);
		assert.ok(Math.abs(peakDb - 20 * Math.log10(amplitude)) < 1, 'the real per-track report measures the independent programme, without detector leakage');
		assert.ok(detector === 'tone' ? peakDb > -25 : peakDb < -100);
		assert.deepEqual(controller.getSnapshot().analysisReport, result);
		assert.deepEqual(controller.project, baseline); assert.deepEqual(controller.getSnapshot().history, history);
		await controller.actions.project.flush(); assert.deepEqual(clipboardDocument(clipboardProject(await store.loadProject(baseline.id))), clipboardDocument(baseline));
		for (const source of baseline.sources) {
			assert.ok(source.kind === 'audio'); const expected = input.pcm.get(source.id); assert.ok(expected);
			assertPcmChannelsEqual(await readCustodyPcm(store, source), expected, `original ${source.id} after analysis`);
		}
		const worklets = native.snapshot().worklets.filter(worklet => worklet.name === 'kw-audio-dynamics');
		assert.ok(worklets.length >= 3 && worklets.every(worklet => worklet.processorType === 'gate' && worklet.processorErrors.length === 0));
	} finally { await donor.close(); await controller.dispose(); await native.dispose(); }
});
