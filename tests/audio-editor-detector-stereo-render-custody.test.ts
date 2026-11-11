/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';

const RATE = 48_000, FRAMES = 96_000;
type Position = 'pre-fader' | 'post-fader';
const PROFILES: readonly (readonly [boolean, boolean, Position])[] = [
	[true, false, 'post-fader'], [false, false, 'post-fader'],
	[false, true, 'post-fader'], [true, false, 'pre-fader'],
];

/** Exact original authored Float32 programmes and routing, before any render. */
function originalFixture(keyMuted: boolean, pairMuted: boolean, position: Position) {
	const sources = ['programme', 'partner', 'key'].map(id => createAudioSource({
		id, storageKey: id, name: id, sampleRate: RATE, channelCount: 1, frameCount: FRAMES,
	}));
	const clips = sources.map(source => createAudioClip({ id: `${source.id}-clip`, sourceId: source.id,
		title: source.name, durationFrames: FRAMES, sourceDurationFrames: FRAMES }));
	const base = createSoundscaperProject({ id: `merge-key-${keyMuted}-${pairMuted}-${position}`, sampleRate: RATE, sources, clips,
		tracks: sources.map(source => createAudioTrack({ id: source.id, name: source.name, clipIds: [`${source.id}-clip`],
			mute: source.id === 'key' ? keyMuted : pairMuted,
			...(source.id === 'programme' ? { effectsActive: true, effects: [createEffect('gate', { id: 'gate',
				params: { threshold: -30, attack: 0, hold: .1, release: .01, rangeDb: -80 } })] } : {}),
		})), selection: { startFrame: 0, endFrame: FRAMES, trackIds: ['programme'], clipIds: ['programme-clip'] } });
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, edges: [...base.mixer.edges,
		{ id: 'key-feed', kind: 'sidechain', source: { kind: 'track', id: 'key' },
			destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'programme' }, effectId: 'gate' },
			position, enabled: true, level: 1, channelMap: [0] },
	] } });
	const inputs = new Map(sources.map(source => {
		const frequency = source.id === 'programme' ? 440 : source.id === 'partner' ? 660 : 880;
		return [source.id, [Float32Array.from({ length: FRAMES }, (_, frame) =>
			(source.id === 'key' ? .5 : .1) * Math.sin(2 * Math.PI * frequency * frame / RATE))]] as const;
	}));
	const programmeInput = inputs.get('programme')?.[0], partner = inputs.get('partner')?.[0], key = inputs.get('key')?.[0];
	assert.ok(programmeInput && partner && key);
	const closed = keyMuted && position === 'post-fader';
	// Attack0/hold100ms opens on the first sine threshold crossing and spans every later crossing.
	const keyGain = position === 'post-fader' ? Math.SQRT1_2 : 1;
	const firstOpen = Math.ceil(Math.asin(10 ** (-30 / 20) / (.5 * keyGain)) / (2 * Math.PI * 880 / RATE));
	const left = Float32Array.from(programmeInput, (sample, frame) => sample * (closed || frame < firstOpen ? .0001 : 1));
	const before = Array.from({ length: 2 }, () => Float32Array.from({ length: FRAMES }, (_, frame) =>
		((pairMuted ? 0 : left[frame]! + partner[frame]!) + (keyMuted ? 0 : key[frame]!)) * Math.SQRT1_2));
	const delivered = (muted: boolean) => [left, partner].map(channel => Float32Array.from(channel, (sample, frame) =>
		(muted ? 0 : sample) + (keyMuted ? 0 : key[frame]! * Math.SQRT1_2)));
	return { project, inputs, printed: [left, partner], before, delivered, closed };
}

function assertProgramme(actual: readonly Float32Array[], expected: readonly Float32Array[], label: string) {
	assert.equal(actual.length, 2, `${label} channel count`);
	for (let channel = 0; channel < 2; channel++) {
		assert.equal(actual[channel]!.length, FRAMES, `${label} frame count`);
		for (let frame = 0; frame < FRAMES; frame++) if (!(Math.abs(actual[channel]![frame]! - expected[channel]![frame]!) < 1e-7))
			assert.fail(`${label} channel${channel}/frame${frame}: ${actual[channel]![frame]} versus ${expected[channel]![frame]}`);
	}
}

function programmeAmplitude(samples: Float32Array) {
	let sine = 0, cosine = 0;
	for (let frame = 9600; frame < 76_800; frame++) {
		const phase = 2 * Math.PI * 440 * frame / RATE;
		sine += samples[frame]! * Math.sin(phase); cosine += samples[frame]! * Math.cos(phase);
	}
	return 2 * Math.hypot(sine, cosine) / 67_200;
}

for (const [keyMuted, pairMuted, position] of PROFILES) {
	test(`real Make stereo retains ${position} detector mute=${keyMuted} and pair mute=${pairMuted}`, { timeout: 30_000 }, async context => {
		const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
		const archive = createSoundscaperScapeNativeRuntime();
		const { controller, store } = await controllerSession(context, { engine, engineFactory: native.createEngine, scapeProjectRuntime: archive });
		const fixture = originalFixture(keyMuted, pairMuted, position);
		const donor = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
		try {
			for (const source of fixture.project.sources) {
				assert.ok(source.kind === 'audio'); const pcm = fixture.inputs.get(source.id); assert.ok(pcm);
				const writer = await donor.beginSourceWrite(source.storageKey, source);
				for (let offset = 0; offset < FRAMES; offset += source.chunkFrames)
					await writer.write(pcm.map(channel => channel.slice(offset, offset + source.chunkFrames)));
				await writer.commit();
			}
			const exported = await archive.exportScapeProject(fixture.project, donor); assert.ok(exported.blob);
			await controller.actions.project.openScapeFile(new File([exported.blob], 'key.sscape', { type: 'application/zip' }), () => 'copy');
			const imported = clipboardProject(controller.project);
			assert.deepEqual(clipboardDocument(imported), clipboardDocument(fixture.project));
			assert.equal(controller.getSnapshot().readOnly, false);
			assert.deepEqual([imported.sources.length, imported.clips.length, imported.tracks.length], [3, 3, 3]);
			for (const source of imported.sources) {
				assert.ok(source.kind === 'audio'); const expected = fixture.inputs.get(source.id); assert.ok(expected);
				assertPcmChannelsEqual(await readCustodyPcm(store, source), expected, `original ${source.id}`);
			}
			const render = async () => {
				const project = clipboardProject(controller.project), renderer = native.createEngine();
				try {
					const buffers = new Map<string, AudioBuffer>();
					for (const source of project.sources) {
						assert.ok(source.kind === 'audio');
						const buffer = await store.loadSourceAudioBuffer(source.storageKey, await engine.getAudioContext({ resume: false }));
						assert.ok(buffer instanceof AudioBuffer); buffers.set(source.id, buffer);
					}
					renderer.loadProject(projectForRuntimeConsumers(project), buffers);
					const output = await renderer.renderMix({ startFrame: 0, endFrame: FRAMES }); assert.ok(output instanceof AudioBuffer);
					assert.deepEqual([output.length, output.sampleRate, output.numberOfChannels], [FRAMES, RATE, 2]);
					return Array.from({ length: 2 }, (_, channel) => {
						const pcm = new Float32Array(FRAMES); output.copyFromChannel(pcm, channel); return pcm;
					});
				} finally { await renderer.dispose(); }
			};
			const before = await render(); assertProgramme(before, fixture.before, 'independent original output');
			const beforeAmplitude = programmeAmplitude(before[0]!);
			assert.ok(fixture.closed || pairMuted ? beforeAmplitude < .00002 : beforeAmplitude > .03);
			controller.actions.timeline.selectClip('programme-clip');
			const baseline = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
			await controller.actions.track.makeStereo('programme', 'partner');
			const merged = clipboardProject(controller.project), track = merged.tracks.find(track => track.id === 'programme'); assert.ok(track);
			assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
			assert.deepEqual([merged.tracks.length, merged.clips.length], [2, 2]);
			assert.equal(merged.tracks.some(track => track.id === 'partner'), false);
			assert.deepEqual([track.gain, track.pan, track.mute, track.effects], [1, 0, pairMuted, []]);
			const clipIds = track.clipIds; assert.ok(Array.isArray(clipIds) && clipIds.length === 1);
			const clip = merged.clips.find(clip => clip.id === clipIds[0]); assert.ok(clip?.kind === 'audio');
			const source = merged.sources.find(source => source.id === clip.sourceId); assert.ok(source?.kind === 'audio');
			assert.deepEqual([source.channelCount, source.frameCount, source.sampleRate, source.sampleFormat], [2, FRAMES, RATE, 'float32']);
			assert.deepEqual([clip.timelineStartFrame, clip.sourceStartFrame, clip.sourceDurationFrames, clip.durationFrames,
				clip.fadeInFrames, clip.fadeOutFrames], [0, 0, FRAMES, FRAMES, 0, 0]);
			assert.equal(merged.mixer.edges.some(edge => edge.id === 'key-feed'), false);
			assert.deepEqual(merged.tracks.find(track => track.id === 'key'), baseline.tracks.find(track => track.id === 'key'));
			assertProgramme(await readCustodyPcm(store, source), fixture.printed, 'independent actual stereo sourcewriter');
			assertProgramme(await render(), fixture.delivered(pairMuted), 'merged mute before Unmute');
			if (pairMuted) controller.actions.track.update('programme', { mute: false });
			const final = clipboardProject(controller.project), after = await render();
			assertProgramme(after, fixture.delivered(false), 'independent stereo output after Unmute');
			const afterAmplitude = programmeAmplitude(after[0]!);
			assert.ok(fixture.closed ? afterAmplitude < .00002 : afterAmplitude > .03);
			if (pairMuted) controller.actions.edit.undo();
			controller.actions.edit.undo();
			assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(baseline));
			assertProgramme(await render(), fixture.before, 'full Undo output');
			controller.actions.edit.redo(); if (pairMuted) controller.actions.edit.redo();
			assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(final));
			await controller.actions.project.flush(); assert.deepEqual(await store.loadProject(final.id), controller.project);
			assertProgramme(await readCustodyPcm(store, source), fixture.printed, 'full Redo stored stereo source');
			for (const original of imported.sources) {
				assert.ok(original.kind === 'audio'); const expected = fixture.inputs.get(original.id); assert.ok(expected);
				assertPcmChannelsEqual(await readCustodyPcm(store, original), expected, `original ${original.id} after history`);
			}
			const worklets = native.snapshot().worklets.filter(worklet => worklet.name === 'kw-audio-dynamics');
			assert.ok(worklets.length >= 3 && worklets.every(worklet => worklet.processorType === 'gate' && worklet.processorErrors.length === 0));
		} finally { await donor.close(); await controller.dispose(); await native.dispose(); }
	});
}
