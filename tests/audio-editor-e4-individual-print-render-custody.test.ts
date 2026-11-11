/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createExportPlan } from '../src/common/editor/export.js';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';

const RATE = 48_000, FRAMES = 48_000;
type Position = 'pre-fader' | 'post-fader';
type Width = 1 | 2 | 6 | 'mixed';
type Control = 'plain' | 'automation' | 'sibling' | 'reverb';
type Profile = readonly [Position, number, boolean, Width, Control];
const PROFILES: readonly Profile[] = [
	['pre-fader', .5, false, 2, 'plain'], ['post-fader', .5, false, 2, 'plain'],
	['pre-fader', 1, false, 2, 'plain'], ['pre-fader', .5, true, 2, 'plain'],
	['pre-fader', .5, false, 1, 'plain'], ['pre-fader', .5, false, 'mixed', 'plain'],
	['pre-fader', .5, false, 6, 'plain'], ['pre-fader', .5, false, 2, 'automation'],
	['pre-fader', .5, false, 2, 'sibling'], ['pre-fader', .5, false, 1, 'reverb'],
	['pre-fader', .5, false, 2, 'reverb'],
];

// This is the exact original authored Float32 programme, not a rendered reference.
const ORIGINAL_PCM = Float32Array.from({ length: FRAMES }, (_, frame) => frame < 480 || frame >= 47_520
	? 0 : .25 * Math.sin(2 * Math.PI * 1000 * frame / RATE));

function originalProject([position, gain, mixDown, width, control]: Profile) {
	const source = createAudioSource({ id: 'source', name: 'Recording', sampleRate: RATE, frameCount: FRAMES,
		channelCount: typeof width === 'number' ? width : 2 });
	const extra = width === 'mixed' ? createAudioSource({ id: 'mono', name: 'Mono', sampleRate: RATE, frameCount: FRAMES, channelCount: 1 }) : null;
	const base = createSoundscaperProject({ id: `print-taps-${position}-${gain}-${mixDown}-${width}-${control}`,
		sources: extra ? [source, extra] : [source],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', gain, pan: control === 'sibling' ? .4 : 0,
			...(control === 'reverb' ? { effects: [{ id: 'verb', type: 'reverb', enabled: true, params: { mix: .3, decay: .1, preDelay: 0 } }] } : {}),
			clipIds: extra ? ['clip', 'mono-clip'] : ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, sourceDurationFrames: FRAMES, durationFrames: FRAMES }),
			...(extra ? [createAudioClip({ id: 'mono-clip', sourceId: extra.id, timelineStartFrame: FRAMES,
				sourceDurationFrames: FRAMES, durationFrames: FRAMES })] : [])] });
	return createSoundscaperProject({ ...base, mixer: { ...base.mixer,
		sends: [{ id: 'aux', name: 'Aux', color: '#456789', channelCount: 2, gain: 1, pan: 0,
			mute: false, solo: false, collapsed: false, effectsActive: true, effects: [] }],
		edges: [...base.mixer.edges,
			{ id: 'aux-send', kind: 'send', source: { kind: 'track', id: 'voice' }, destination: { kind: 'mixer-node', id: 'aux' },
				position, level: .2, enabled: true, channelMap: width === 1 ? [0, 0] : [0, 1] },
			{ id: 'aux-return', kind: 'assignment', source: { kind: 'mixer-node', id: 'aux' }, destination: { kind: 'master' },
				position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] }],
	}, ...(control === 'automation' ? { automationLanes: [
		{ id: 'gain', address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: 'gain-start', position: 0, value: .25 }], segments: [] },
		{ id: 'pan', address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'pan' },
			timebase: 'absolute-samples', points: [{ id: 'pan-start', position: 0, value: .4 }], segments: [] },
	] } : {}) });
}

function closeProgramme(actual: readonly Float32Array[], expected: readonly Float32Array[], scale = 1, label = 'programme'): void {
	assert.equal(actual.length, expected.length, `${label} channels`);
	for (let channel = 0; channel < expected.length; channel++) {
		assert.equal(actual[channel]!.length, expected[channel]!.length, `${label} frames`);
		for (let frame = 0; frame < expected[channel]!.length; frame++) {
			const reference = expected[channel]![frame]! * scale;
			if (!(Math.abs(actual[channel]![frame]! - reference) < .0001))
				assert.fail(`${label} channel${channel}/frame${frame}: ${actual[channel]![frame]} versus ${reference}`);
		}
	}
}

function peak(pcm: readonly Float32Array[]): number {
	let maximum = 0;
	// Original browser window9600..28800 contains interleaved stereo samples.
	for (let frame = 4800; frame < 14_400; frame++) for (const channel of pcm) maximum = Math.max(maximum, Math.abs(channel[frame]!));
	return maximum;
}

for (const profile of PROFILES) {
	const [position, gain, mixDown, width, control] = profile;
	test(`real ${mixDown ? 'combined' : 'individual'} print preserves ${position}/${gain}/${width}/${control} PCM and history`, { timeout: 30_000 }, async context => {
		const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
		const archive = createSoundscaperScapeNativeRuntime();
		const { controller, store } = await controllerSession(context, { engine, engineFactory: native.createEngine, scapeProjectRuntime: archive });
		const authored = originalProject(profile);
		const donor = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `print-donor-${authored.id}` });
		try {
			for (const source of authored.sources) {
				assert.ok(source.kind === 'audio');
				const writer = await donor.beginSourceWrite(source.storageKey, source);
				await writer.write(Array.from({ length: source.channelCount }, () => ORIGINAL_PCM)); await writer.commit();
			}
			const exported = await archive.exportScapeProject(authored, donor); assert.ok(exported.blob);
			await controller.actions.project.openScapeFile(new File([exported.blob], 'Print.sscape', { type: 'application/zip' }), () => 'copy');
			await controller.actions.project.flush();
			const initial = clipboardProject(controller.project);
			assert.equal(initial.id, authored.id); assert.equal(controller.getSnapshot().readOnly, false);
			assert.equal(initial.sources.length, width === 'mixed' ? 2 : 1);
			assert.deepEqual(clipboardDocument(initial), clipboardDocument(authored));
			assert.deepEqual(await store.loadProject(initial.id), controller.project);
			for (const source of initial.sources) {
				assert.ok(source.kind === 'audio');
				assertPcmChannelsEqual(await readCustodyPcm(store, source), Array.from({ length: source.channelCount }, () => ORIGINAL_PCM), `original ${source.id}`);
			}
			const renderDelivery = async () => {
				const project = clipboardProject(controller.project), buffers = new Map<string, AudioBuffer>();
				for (const source of project.sources) {
					assert.ok(source.kind === 'audio');
					const buffer = await store.loadSourceAudioBuffer(source.storageKey, await engine.getAudioContext({ resume: false }));
					assert.ok(buffer instanceof AudioBuffer); buffers.set(source.id, buffer);
				}
				const runtime = projectForRuntimeConsumers(project), plan = createExportPlan(runtime, { format: 'wav' });
				const renderer = native.createEngine();
				try {
					renderer.loadProject(runtime, buffers);
					const output = await renderer.renderMix({ startFrame: plan.range.startFrame, endFrame: plan.range.endFrame,
						includeTail: plan.tailFrames ? plan.tailFrames / RATE : false });
					assert.ok(output instanceof AudioBuffer); assert.equal(output.sampleRate, RATE);
					assert.equal(output.numberOfChannels, 2); assert.equal(output.length, plan.outputFrames);
					return Array.from({ length: output.numberOfChannels }, (_, channel) => output.getChannelData(channel).slice());
				} finally { await renderer.dispose(); }
			};
			const before = await renderDelivery();
			if (control === 'plain') {
				const amplitude = .25 * (gain * (width === 1 ? Math.SQRT1_2 : 1) + (position === 'pre-fader' ? .2 : gain * .2));
				assert.ok(Math.abs(peak(before) - amplitude) < .0001, `independent original peak ${peak(before)} versus ${amplitude}`);
				for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < FRAMES; frame++) {
					const expected = ORIGINAL_PCM[frame]! * amplitude / .25;
					if (!(Math.abs(before[channel]![frame]! - expected) < .0001)) assert.fail(`independent routing channel${channel}/frame${frame}: ${before[channel]![frame]} versus ${expected}`);
				}
			} else if (control === 'automation' || control === 'sibling') {
				const stripGain = control === 'automation' ? .25 : gain;
				const factors = [stripGain * Math.cos(.4 * Math.PI / 2) + .2,
					stripGain * (1 + Math.sin(.4 * Math.PI / 2)) + .2];
				for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < FRAMES; frame++) {
					const expected = ORIGINAL_PCM[frame]! * factors[channel]!;
					if (!(Math.abs(before[channel]![frame]! - expected) < .0001)) assert.fail(`independent strip/channel${channel}/frame${frame}: ${before[channel]![frame]} versus ${expected}`);
				}
			} else {
				assert.ok(peak(before) > .01, 'the original real Reverb programme is audible');
				let wetDifference = 0;
				for (const channel of before) for (let frame = 0; frame < FRAMES; frame++) {
					const dry = ORIGINAL_PCM[frame]! * (gain * (width === 1 ? Math.SQRT1_2 : 1) + .2);
					wetDifference = Math.max(wetDifference, Math.abs(channel[frame]! - dry));
				}
				assert.ok(wetDifference > .001, 'the shipping Convolver must change the independently known dry programme');
			}
			controller.actions.timeline.selectClip('clip');
			const baseline = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
			const refused = width === 'mixed' || width === 1 && control === 'reverb';
			const operation = () => controller.actions.track.mixAndRender({ mixDown, renderEffects: true, replaceOriginals: control !== 'sibling' });
			if (refused) {
				await assert.rejects(operation(), width === 'mixed' ? /changing channel widths/u : /mono track with stereo reverb/u);
				assert.deepEqual(controller.project, baseline); assert.equal(controller.getSnapshot().history.undoEntries.length, history);
			} else {
				const printed = await operation(); assert.ok(printed);
				assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
				const project = clipboardProject(controller.project), clip = project.clips.find(value => value.id === printed.clipId); assert.ok(clip);
				assert.equal(project.tracks.length, control === 'sibling' ? 2 : 1);
				assert.equal(project.clips.length, control === 'sibling' ? 2 : 1);
				assert.equal(project.sources.filter(source => !initial.sources.some(original => original.id === source.id)).length, 1);
				assert.deepEqual([clip.fadeInFrames, clip.fadeOutFrames], [0, 0]);
				const source = project.sources.find(value => value.id === clip.sourceId); assert.ok(source && source.kind === 'audio');
				assert.deepEqual([source.sampleRate, source.channelCount], [RATE, mixDown ? 2 : width]);
				const stored = await readCustodyPcm(store, source); assert.equal(stored[0]!.length, source.frameCount);
				assert.ok(peak(stored) > .01, 'actual derived sourcewriter persisted sounding PCM');
				if (control !== 'reverb') {
					const scale = mixDown ? gain + .2 : position === 'post-fader' ? gain : 1;
					const expected = Float32Array.from(ORIGINAL_PCM, sample => sample * scale);
					closeProgramme(stored, Array.from({ length: source.channelCount }, () => expected), 1, 'every stored printed sample');
				} else {
					// Both original routes carry this same real convolved programme; neither strip has pan.
					closeProgramme(stored, before, 1 / (gain + .2), 'every stored real Reverb sample');
				}
			}
			const after = await renderDelivery(); closeProgramme(after, before, control === 'sibling' ? 2 : 1, 'full printed delivery');
			await controller.actions.project.flush();
			// Selection is transient: a refused operation must leave the original saved document intact.
			assert.deepEqual(await store.loadProject(initial.id), refused ? initial : controller.project);
			if (refused) return;
			const committed = clipboardProject(controller.project);
			controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(baseline));
			closeProgramme(await renderDelivery(), before, 1, 'full Undo delivery');
			controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(committed));
			await controller.actions.project.flush(); assert.deepEqual(await store.loadProject(initial.id), controller.project);
			for (const source of initial.sources) {
				assert.ok(source.kind === 'audio');
				assertPcmChannelsEqual(await readCustodyPcm(store, source), Array.from({ length: source.channelCount }, () => ORIGINAL_PCM), `unchanged original ${source.id} after print/Undo/Redo`);
			}
			assert.ok(native.snapshot().offlineContexts >= 3, 'the public operation and independent deliveries use real offline contexts');
		} finally { await donor.close(); await controller.dispose(); await native.dispose(); }
	});
}
