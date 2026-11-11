/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { zeroCrossingDetectorProject } from './helpers/zero-crossing-detector-project.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

const RATE = 48_000, FRAMES = 48_000, DELAY = 4800;

/** Closed-form zero-attack/no-hold release and the original single feedforward echo. */
function independentWetProgramme(programme: Float32Array, key: Float32Array, preFader: boolean): Float32Array {
	const gated = new Float32Array(FRAMES);
	let lastOpen = -1;
	for (let frame = 0; frame < FRAMES; frame++) {
		if (preFader && Math.abs(key[frame]!) >= 10 ** (-30 / 20)) lastOpen = frame;
		const envelope = lastOpen < 0 ? .01 : .01 + .99 * Math.exp(-(frame - lastOpen) / (RATE * .01));
		gated[frame] = programme[frame]! * envelope;
	}
	return Float32Array.from({ length: FRAMES + DELAY }, (_, frame) => Math.fround(
		.5 * (gated[frame] ?? 0) + .5 * (gated[frame - DELAY] ?? 0)) * Math.SQRT1_2);
}

/** Independently enumerate crossings; the production finder searches outwards instead. */
function referenceCrossing(samples: Float32Array, target: number): number {
	const candidates: number[] = [];
	for (let frame = target - 480; frame <= target + 480; frame++) {
		const current = samples[frame]!, previous = samples[frame - 1]!;
		if (current === 0 || current * previous < 0) candidates.push(frame);
	}
	assert.ok(candidates.length);
	candidates.sort((left, right) => Math.abs(left - target) - Math.abs(right - target)
		|| Math.abs(samples[left]!) - Math.abs(samples[right]!));
	return candidates[0]!;
}

for (const [position, mode] of [
	['pre-fader', 'leaf'], ['post-fader', 'leaf'], ['post-fader', 'folder'], ['post-fader', 'vca'],
] as const) test(`real zero-crossing selection retains original ${position} ${mode} Gate and Delay history`, { timeout: 30_000 }, async context => {
	const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine(), archive = createSoundscaperScapeNativeRuntime();
	const { controller, store } = await controllerSession(context, { engine, engineFactory: native.createEngine, scapeProjectRuntime: archive });
	const input = zeroCrossingDetectorProject(position, mode), authored = clipboardProject(input.project);
	const donor = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		for (const [index, source] of authored.sources.entries()) {
			assert.ok(source.kind === 'audio'); const samples = input.samples[index]; assert.ok(samples);
			const writer = await donor.beginSourceWrite(source.storageKey, source);
			for (let offset = 0; offset < FRAMES; offset += source.chunkFrames) await writer.write([samples.slice(offset, offset + source.chunkFrames)]);
			await writer.commit();
		}
		const exported = await archive.exportScapeProject(authored, donor); assert.ok(exported.blob);
		await controller.actions.project.openScapeFile(new File([exported.blob], 'Crossing detector.sscape', { type: 'application/zip' }), () => 'copy');
		const imported = clipboardProject(controller.project), buffers = new Map<string, AudioBuffer>();
		assert.deepEqual(clipboardDocument(imported), clipboardDocument(authored));
		for (const [index, source] of imported.sources.entries()) {
			assert.ok(source.kind === 'audio'); const samples = input.samples[index]; assert.ok(samples);
			assertPcmChannelsEqual(await readCustodyPcm(store, source), [samples], `original ${source.id}`);
			const buffer = await store.loadSourceAudioBuffer(source.storageKey, await engine.getAudioContext({ resume: false }));
			assert.ok(buffer instanceof AudioBuffer); buffers.set(source.id, buffer);
		}
		const programmeIndex = input.sources.findIndex(source => source.id === 'programme'), keyIndex = input.sources.findIndex(source => source.id === 'key');
		assert.ok(programmeIndex >= 0 && keyIndex >= 0);
		const expected = independentWetProgramme(input.samples[programmeIndex]!, input.samples[keyIndex]!, position === 'pre-fader');
		const renderer = native.createEngine();
		try {
			renderer.loadProject(projectForRuntimeConsumers(imported), buffers);
			const output = await renderer.renderMix({ startFrame: 0, endFrame: FRAMES, includeTail: .1 }); assert.ok(output instanceof AudioBuffer);
			assert.deepEqual([output.sampleRate, output.numberOfChannels, output.length], [RATE, 2, FRAMES + DELAY]);
			for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < expected.length; frame++) {
				const actual = output.getChannelData(channel)[frame]!;
				if (!(Math.abs(actual - expected[frame]!) < 1e-7)) assert.fail(`independent wet programme channel${channel}/frame${frame}: ${actual} versus ${expected[frame]}`);
			}
		} finally { await renderer.dispose(); }
		controller.actions.timeline.selectClip('programme-clip'); controller.actions.timeline.selectTrackStartToEnd();
		if (position === 'pre-fader') controller.actions.track.update('programme', { mute: true });
		controller.actions.timeline.setSelection(10_007, 11_007, { trackIds: ['programme'] });
		const before = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
		const result = await controller.actions.timeline.zeroCross(); assert.ok(result);
		const selected = clipboardProject(controller.project), expectedStart = referenceCrossing(expected, 10_007), expectedEnd = referenceCrossing(expected, 11_007);
		assert.ok(Math.abs(selected.selection.startFrame - expectedStart) <= 1);
		assert.ok(Math.abs(selected.selection.endFrame - expectedEnd) <= 1);
		assert.deepEqual(selected.selection.trackIds, ['programme']); assert.deepEqual(selected.selection.clipIds, []);
		assert.deepEqual(clipboardDocument(selected), clipboardDocument(before));
		assert.match(controller.getSnapshot().status.message, /zero crossings/iu);
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
		controller.actions.edit.undo(); assert.deepEqual(clipboardProject(controller.project).selection, before.selection);
		controller.actions.edit.redo(); assert.deepEqual(clipboardProject(controller.project).selection, selected.selection);
		await controller.actions.project.flush(); assert.deepEqual(await store.loadProject(selected.id), controller.project);
		for (const [index, source] of selected.sources.entries()) {
			assert.ok(source.kind === 'audio'); const samples = input.samples[index]; assert.ok(samples);
			assertPcmChannelsEqual(await readCustodyPcm(store, source), [samples], `original ${source.id} after zero-crossing history`);
		}
		const stats = native.snapshot();
		assert.ok(stats.worklets.some(worklet => worklet.name === 'kw-audio-dynamics' && worklet.processorType === 'gate'));
		assert.ok(stats.worklets.filter(worklet => worklet.name === 'kw-audio-delay').length >= 2, 'the full reference and wet selection use the actual Delay worker');
		assert.ok(stats.worklets.every(worklet => worklet.processorErrors.length === 0));
	} finally { await donor.close(); await controller.dispose(); await native.dispose(); }
});
