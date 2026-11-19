/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject, type SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createExportPlan } from '../src/common/editor/export.js';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { mixDetectorProject } from './helpers/next-mix-detector-project.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';

const RATE = 48_000;
type Position = 'pre-fader' | 'post-fader';
type Mode = 'leaf' | 'vca-mute' | 'vca-gain' | 'bus';
type AudibilityProfile = readonly [boolean, Position, Mode];
const AUDIBILITY_PROFILES: readonly AudibilityProfile[] = [
	[true, 'pre-fader', 'leaf'], [true, 'post-fader', 'leaf'],
	[false, 'pre-fader', 'leaf'], [false, 'post-fader', 'leaf'],
	[true, 'post-fader', 'vca-mute'], [true, 'post-fader', 'vca-gain'], [true, 'post-fader', 'bus'],
];
interface Fixture {
	readonly project: SoundscaperProject;
	readonly channels: ReadonlyMap<string, readonly Float32Array[]>;
	readonly clipId: string;
	readonly programme: Float32Array;
	readonly delivery: Float32Array;
	readonly audible: boolean;
	readonly constant: boolean;
}

function originalAudibilityFixture([_mixDown, position, mode]: AudibilityProfile): Fixture {
	const length = RATE * 2;
	const sources = ['programme', 'key'].map(id => createAudioSource({ id, storageKey: id, name: id,
		sampleRate: RATE, channelCount: 1, frameCount: length }));
	const clips = sources.map(source => createAudioClip({ id: `${source.id}-clip`, sourceId: source.id,
		title: source.name, durationFrames: length, sourceDurationFrames: length }));
	const base = createSoundscaperProject({ id: `print-key-${position}-${mode}`, sampleRate: RATE, sources, clips,
		tracks: sources.map(source => createAudioTrack({ id: source.id, name: source.name, clipIds: [`${source.id}-clip`],
			...(source.id === 'programme' ? { effectsActive: true, effects: [createEffect('gate', { id: 'gate',
				params: { threshold: -30, attack: 0, hold: .1, release: .01, rangeDb: -80 } })] } : { mute: mode === 'leaf' }) })),
		selection: { startFrame: 0, endFrame: length, trackIds: ['programme'], clipIds: ['programme-clip'] } });
	const bus = mode === 'bus';
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer,
		groups: bus ? [{ id: 'key-bus', name: 'Key bus', color: '#808080', channelCount: 2, gain: .5,
			pan: 0, mute: true, solo: false, collapsed: false, effectsActive: true, effects: [] }] : [],
		vcas: mode === 'vca-mute' || mode === 'vca-gain' ? [{ id: 'key-vca', name: 'Key VCA', gain: .5,
			mute: mode === 'vca-mute', members: mode === 'vca-mute' ? [{ kind: 'track', id: 'key' }]
				: [{ kind: 'track', id: 'programme' }, { kind: 'track', id: 'key' }] }] : [],
		edges: [...base.mixer.edges.map(edge => bus && edge.source.kind === 'track' && edge.source.id === 'key'
			? { ...edge, destination: { kind: 'mixer-node', id: 'key-bus' } } : edge),
			...(bus ? [{ id: 'key-bus-output', kind: 'assignment', source: { kind: 'mixer-node', id: 'key-bus' },
				destination: { kind: 'master' }, position: 'post-fader', enabled: true, level: 1, channelMap: [0, 1] }] : []),
			{ id: 'key-feed', kind: 'sidechain', source: bus ? { kind: 'mixer-node', id: 'key-bus' } : { kind: 'track', id: 'key' },
				destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'programme' }, effectId: 'gate' },
				position, enabled: true, level: 1, channelMap: [0] }],
	} });
	const programmeInput = Float32Array.from({ length }, (_, frame) => .1 * Math.sin(2 * Math.PI * 440 * frame / RATE));
	const keyInput = Float32Array.from({ length }, (_, frame) => .5 * Math.sin(2 * Math.PI * 880 * frame / RATE));
	const audible = position === 'pre-fader' || mode === 'vca-gain';
	// Attack is zero and the 100 ms hold exceeds every tone zero crossing. The first
	// threshold crossing follows directly from the authored sine amplitude/panner/VCA.
	const detectorGain = mode === 'vca-gain' ? Math.SQRT1_2 * .5 : 1;
	const firstOpen = Math.ceil(Math.asin(10 ** (-30 / 20) / (.5 * detectorGain)) / (2 * Math.PI * 880 / RATE));
	const programme = Float32Array.from(programmeInput, (sample, frame) => sample * Math.SQRT1_2
		* (mode === 'vca-gain' ? .5 : 1) * (audible && frame >= firstOpen ? 1 : .0001));
	const delivery = Float32Array.from(programme, (sample, frame) => sample
		+ (mode === 'vca-gain' ? keyInput[frame]! * .5 * Math.SQRT1_2 : 0));
	return { project: clipboardProject(project), channels: new Map([['programme', [programmeInput]], ['key', [keyInput]]]),
		clipId: 'programme-clip', programme, delivery, audible, constant: false };
}

function originalQuietFixture(kind: 'track' | 'bus'): Fixture {
	const fixture = mixDetectorProject(kind);
	// A connected .001 key is below the explicit -20dB threshold at every sample.
	// Its level 0 programme assignment must not leak into the output.
	const programme = new Float32Array(RATE).fill(.25 * .0001 * Math.SQRT1_2);
	return { project: clipboardProject(fixture.project), channels: fixture.channels, clipId: 'voice-clip',
		programme, delivery: programme, audible: false, constant: true };
}

function assertProgramme(actual: readonly Float32Array[], expected: Float32Array, label: string): void {
	assert.equal(actual.length, 2, `${label} channel count`);
	for (const [channel, samples] of actual.entries()) {
		assert.equal(samples.length, expected.length, `${label} frame count`);
		for (let frame = 0; frame < samples.length; frame++) if (!(Math.abs(samples[frame]! - expected[frame]!) < 1e-7))
			assert.fail(`${label} channel${channel}/frame${frame}: ${samples[frame]} versus ${expected[frame]}`);
	}
}

function programmeAmplitude(samples: Float32Array): number {
	let sine = 0, cosine = 0;
	for (let frame = 9600; frame < 76_800; frame++) {
		const phase = 2 * Math.PI * 440 * frame / RATE;
		sine += samples[frame]! * Math.sin(phase); cosine += samples[frame]! * Math.cos(phase);
	}
	return 2 * Math.hypot(sine, cosine) / 67_200;
}

const cases = [
	...AUDIBILITY_PROFILES.map(profile => ({ name: `${profile[0] ? 'Combined' : 'Individual'} ${profile[1]} ${profile[2]} detector`,
		mixDown: profile[0], create: () => originalAudibilityFixture(profile) })),
	...(['track', 'bus'] as const).flatMap(kind => [true, false].map(mixDown => ({
		name: `${mixDown ? 'Combined' : 'Individual'} quiet ${kind} detector`, mixDown, create: () => originalQuietFixture(kind),
	}))),
];

for (const value of cases) test(`real Gate print retains original ${value.name} PCM, source custody and history`, { timeout: 30_000 }, async context => {
	const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
	const archive = createSoundscaperScapeNativeRuntime();
	const { controller, store } = await controllerSession(context, { engine, engineFactory: native.createEngine, scapeProjectRuntime: archive });
	const fixture = value.create(), donor = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		for (const source of fixture.project.sources) {
			assert.ok(source.kind === 'audio'); const pcm = fixture.channels.get(source.id); assert.ok(pcm);
			const writer = await donor.beginSourceWrite(source.storageKey, source);
			for (let offset = 0; offset < source.frameCount; offset += source.chunkFrames)
				await writer.write(pcm.map(channel => channel.slice(offset, offset + source.chunkFrames)));
			await writer.commit();
		}
		const exported = await archive.exportScapeProject(fixture.project, donor); assert.ok(exported.blob);
		await controller.actions.project.openScapeFile(new File([exported.blob], 'Detector.sscape', { type: 'application/zip' }), () => 'copy');
		await controller.actions.project.flush();
		const imported = clipboardProject(controller.project);
		assert.equal(imported.id, fixture.project.id); assert.equal(controller.getSnapshot().readOnly, false);
		assert.deepEqual(clipboardDocument(imported), clipboardDocument(fixture.project));
		assert.equal(imported.sources.length, 2); assert.equal(imported.clips.length, 2); assert.equal(imported.tracks.length, 2);
		for (const source of imported.sources) {
			assert.ok(source.kind === 'audio'); const expected = fixture.channels.get(source.id); assert.ok(expected);
			assertPcmChannelsEqual(await readCustodyPcm(store, source), expected, `all original ${source.id} samples`);
		}
		const render = async () => {
			const project = clipboardProject(controller.project), buffers = new Map<string, AudioBuffer>();
			for (const source of project.sources) {
				assert.ok(source.kind === 'audio');
				const buffer = await store.loadSourceAudioBuffer(source.storageKey, await engine.getAudioContext({ resume: false }));
				assert.ok(buffer instanceof AudioBuffer); buffers.set(source.id, buffer);
			}
			const runtime = projectForRuntimeConsumers(project), plan = createExportPlan(runtime, { format: 'wav' });
			assert.equal(plan.tailFrames, 0, 'the original Gate has no authored output tail');
			const renderer = native.createEngine();
			try {
				renderer.loadProject(runtime, buffers);
				const output = await renderer.renderMix({ startFrame: plan.range.startFrame, endFrame: plan.range.endFrame });
				assert.ok(output instanceof AudioBuffer);
				assert.deepEqual([output.sampleRate, output.length, output.numberOfChannels], [RATE, fixture.delivery.length, 2]);
				return Array.from({ length: 2 }, (_, channel) => output.getChannelData(channel).slice());
			} finally { await renderer.dispose(); }
		};
		const before = await render(); assertProgramme(before, fixture.delivery, 'independent original delivery');
		if (fixture.constant) {
			let peak = 0; for (let frame = 9600; frame < 28_800; frame++) peak = Math.max(peak, Math.abs(before[0]![frame]!));
			assert.ok(peak < .0001, 'the original quiet connected-key bound');
		} else {
			const amplitude = programmeAmplitude(before[0]!);
			assert.ok(fixture.audible ? amplitude > .03 : amplitude < .00001, `original programme amplitude ${amplitude}`);
		}
		controller.actions.timeline.selectClip(fixture.clipId);
		const baseline = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
		const printed = await controller.actions.track.mixAndRender({ mixDown: value.mixDown, renderEffects: true, replaceOriginals: true }); assert.ok(printed);
		const committed = clipboardProject(controller.project), source = committed.sources.find(source => source.id === printed.sourceId);
		const clip = committed.clips.find(clip => clip.id === printed.clipId);
		assert.ok(source?.kind === 'audio' && clip?.kind === 'audio');
		assert.deepEqual([source.channelCount, source.sampleRate, source.frameCount], [2, RATE, fixture.programme.length]);
		assert.deepEqual([clip.fadeInFrames, clip.fadeOutFrames], [0, 0]);
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
		assertProgramme(await readCustodyPcm(store, source), fixture.programme, 'independent stored printed programme without detector leak');
		assertProgramme(await render(), fixture.delivery, 'full printed delivery');
		controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(baseline));
		assertProgramme(await render(), fixture.delivery, 'full Undo delivery');
		controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(committed));
		await controller.actions.project.flush(); assert.deepEqual(await store.loadProject(imported.id), controller.project);
		assertProgramme(await readCustodyPcm(store, source), fixture.programme, 'full Redo stored programme');
		for (const original of imported.sources) {
			assert.ok(original.kind === 'audio'); const expected = fixture.channels.get(original.id); assert.ok(expected);
			assertPcmChannelsEqual(await readCustodyPcm(store, original), expected, `original ${original.id} after print and history`);
		}
		const worklets = native.snapshot().worklets.filter(worklet => worklet.name === 'kw-audio-dynamics');
		assert.ok(worklets.length >= 3 && worklets.every(worklet => worklet.processorType === 'gate' && worklet.processorErrors.length === 0),
			'the actual shipping Gate worker processes the source and print; no fallback or synthetic PCM');
	} finally { await donor.close(); await controller.dispose(); await native.dispose(); }
});
