/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createEffectMacroStep } from '../src/common/editor/effect-macro-steps.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertMacroPcm, independentlyFaded, macroDspCustody, macroRecording } from './helpers/macro-dsp-custody.ts';
import { createMacroThreadOwner } from './helpers/macro-thread-worker-transport.ts';

const FRAMES = 38_400;
const SIMPLE_PROGRAMS = [
	['faded single Invert', "await sound.select.all(); await sound.effect('audacity-invert');", -1, 1],
	['two concurrent awaited Inverts', "await sound.select.all(); await Promise.all([sound.effect('audacity-invert'), sound.effect('audacity-invert')]);", 1, 2],
	['offline Amplify followed by staged Invert', "await sound.effects([{type:'audacity-amplify',params:{gainDb:0}},{type:'audacity-invert',params:{}}]);", -1, 1],
] as const;

for (const [name, program, sign, invertCount] of SIMPLE_PROGRAMS) test(`real macro DSP retains ${name}`, { timeout: 30_000 }, async context => {
	const custody = await macroDspCustody(context);
	try {
		const { controller, store, factory } = custody, recording = macroRecording('browser-tone-a.wav', 330);
		await controller.actions.project.importFiles([recording.file]);
		const imported = clipboardProject(controller.project), original = imported.sources[0], originalClip = imported.clips[0];
		assert.ok(original?.kind === 'audio' && originalClip?.kind === 'audio');
		assert.deepEqual([original.frameCount, original.sampleRate, original.channelCount,
			originalClip.fadeInFrames, originalClip.fadeOutFrames], [FRAMES, 48_000, 2, 96, 96]);
		await custody.source(original, recording.pcm);
		const before = await custody.render(FRAMES);
		assertMacroPcm(before, independentlyFaded(recording.pcm), 'independent original RIFF programme', .35);
		if (name.startsWith('offline')) controller.actions.timeline.selectAll();
		const baseline = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
		await assert.doesNotReject(controller.actions.macros.runScript({ name, source: program }));
		const changed = clipboardProject(controller.project), clip = changed.clips[0]; assert.ok(clip?.kind === 'audio');
		const printed = changed.sources.find(source => source.id === clip.sourceId); assert.ok(printed?.kind === 'audio');
		assert.notEqual(printed.id, original.id);
		assert.deepEqual([changed.clips.length, printed.frameCount, printed.channelCount, clip.fadeInFrames, clip.fadeOutFrames], [1, FRAMES, 2, 0, 0]);
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1, 'one actual macro transaction');
		const expected = before.map(channel => Float32Array.from(channel, sample => sign * sample));
		assertMacroPcm(await readCustodyPcm(store, printed), expected, 'real macro sourcewriter');
		assertMacroPcm(await custody.render(FRAMES), expected, 'real macro delivery');
		await custody.history(baseline, changed, before, expected);
		await custody.source(original, recording.pcm);
		const inverts = factory.snapshot().worklets.filter(worklet => worklet.processorType === 'audacity-invert');
		assert.equal(inverts.length, 2 * invertCount, 'each requested Invert reached shipping DSP for both channels');
		await custody.assertPrograms([program], [name.startsWith('offline') ? ['effect.chain'] : ['select.all', ...Array.from({ length: invertCount }, () => 'effect.apply')]]);
	} finally { await custody.dispose(); }
});

test('real step-list Invert rewrites both tracks selected by Select all', { timeout: 30_000 }, async context => {
	const custody = await macroDspCustody(context);
	try {
		const { controller, store, factory } = custody;
		const recordings = [macroRecording('browser-tone-a.wav', 330), macroRecording('browser-tone-b.wav', 660)];
		await controller.actions.project.importFiles(recordings.map(recording => recording.file));
		const imported = clipboardProject(controller.project); assert.equal(imported.clips.length, 2);
		for (const [index, source] of imported.sources.entries()) await custody.source(source, recordings[index]!.pcm);
		const independent = independentlyFaded(recordings[0]!.pcm).map((channel, index) => {
			const partner = independentlyFaded(recordings[1]!.pcm)[index]!;
			return Float32Array.from(channel, (sample, frame) => sample + partner[frame]!);
		});
		const before = await custody.render(FRAMES); assertMacroPcm(before, independent, 'independent two-track programme', .7);
		controller.actions.timeline.selectAll();
		const baseline = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
		assert.ok(Array.isArray(baseline.selection.trackIds), 'Select all publishes the complete selected track set');
		assert.equal(baseline.selection.trackIds.length, baseline.tracks.length, 'Select all includes the empty starter track');
		assert.deepEqual([baseline.selection.startFrame, baseline.selection.endFrame, baseline.selection.clipIds], [0, FRAMES, []]);
		await assert.doesNotReject(controller.actions.macros.run({ name: 'Two selected tracks', effects: [createEffectMacroStep('audacity-invert')] }));
		const changed = clipboardProject(controller.project); assert.equal(changed.clips.length, 2);
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
		for (const clip of changed.clips) {
			assert.ok(clip.kind === 'audio'); const source = changed.sources.find(source => source.id === clip.sourceId); assert.ok(source?.kind === 'audio');
			assert.ok(imported.sources.every(original => original.id !== source.id));
			const owner = changed.tracks.find(track => track.type === 'audio' && track.clipIds.includes(clip.id)); assert.ok(owner);
			const originalOwner = imported.tracks.find(track => track.id === owner.id); assert.ok(originalOwner?.type === 'audio');
			const originalIndex = imported.clips.findIndex(original => originalOwner.clipIds.includes(original.id));
			assert.ok(originalIndex >= 0);
			assertMacroPcm(await readCustodyPcm(store, source), independentlyFaded(recordings[originalIndex]!.pcm).map(channel => Float32Array.from(channel, sample => -sample)), 'each selected track source', .35);
		}
		const expected = before.map(channel => Float32Array.from(channel, sample => -sample));
		assertMacroPcm(await custody.render(FRAMES), expected, 'both selected tracks are inverted');
		await custody.history(baseline, changed, before, expected);
		for (const [index, source] of imported.sources.entries()) await custody.source(source, recordings[index]!.pcm);
		assert.equal(factory.snapshot().worklets.filter(worklet => worklet.processorType === 'audacity-invert').length, 4);
		await custody.assertPrograms([], []);
	} finally { await custody.dispose(); }
});

for (const [gainDb, cropped] of [[0, false], [6, false], [6, true]] as const) test(`real offline ${gainDb}dB macro preserves Delay history, cropped=${cropped}`, { timeout: 30_000 }, async context => {
	const custody = await macroDspCustody(context);
	try {
		const { controller, factory } = custody;
		const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 96_000, channelCount: 1 });
		const project = createSoundscaperProject({ id: `macro-history-${gainDb}-${cropped}`, sources: [source],
			clips: [createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: cropped ? 48_000 : 0,
				sourceStartFrame: cropped ? 48_000 : 0, durationFrames: cropped ? 48_000 : 96_000, sourceDurationFrames: cropped ? 48_000 : 96_000 })],
			tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
		const input = Float32Array.from({ length: 96_000 }, (_, frame) =>
			frame >= 43_200 && frame < 43_680 || frame >= 67_200 && frame < 67_680 ? .25 * Math.sin(2 * Math.PI * 1000 * frame / 48_000) : 0);
		await custody.open(project, new Map([[source.id, [input]]])); await custody.source(source, [input]);
		const original = await custody.render(96_000);
		assertMacroPcm(original, Array.from({ length: 2 }, () => Float32Array.from(input, (sample, frame) => cropped && frame < 48_000 ? 0 : sample * Math.SQRT1_2)), 'independent authored bursts');
		const baseline = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
		const program = (prefix: string) => `await sound.select.frames(48000,96000); await sound.effects([${prefix}{type:'delay',params:{time:.2,feedback:0,mix:1}}]);`;
		const directProgram = program('');
		await assert.doesNotReject(controller.actions.macros.runScript({ name: 'Delay baseline', source: directProgram }));
		const direct = await custody.render(96_000);
		const independent = (gain: number) => Array.from({ length: 2 }, () => Float32Array.from({ length: 96_000 }, (_, frame) => {
			if (frame < 48_000) return cropped ? 0 : input[frame]! * Math.SQRT1_2;
			const origin = frame - 9600;
			return (cropped && origin < 48_000 ? 0 : input[origin]!) * Math.SQRT1_2 * (origin >= 48_000 ? gain : 1);
		}));
		assertMacroPcm(direct, independent(1), 'independent direct Delay with pre-range history');
		controller.actions.edit.undo();
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(baseline));
		const amplifiedProgram = program(`{type:'audacity-amplify',params:{gainDb:${gainDb}}},`);
		await assert.doesNotReject(controller.actions.macros.runScript({ name: 'Amplify then Delay', source: amplifiedProgram }));
		const changed = clipboardProject(controller.project), expected = independent(10 ** (gainDb / 20));
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
		assertMacroPcm(await custody.render(96_000), expected, 'independent staged Amplify and Delay output');
		await custody.history(baseline, changed, original, expected); await custody.source(source, [input]);
		assert.equal(factory.snapshot().worklets.filter(worklet => worklet.name === 'kw-audio-delay').length, 2);
		await custody.assertPrograms([directProgram, amplifiedProgram], [['select.frames', 'effect.chain'], ['select.frames', 'effect.chain']]);
	} finally { await custody.dispose(); }
});

test('macro thread ownership joins actual failing and naturally exited Workers', { timeout: 10_000 }, async () => {
	for (const source of ['throw new Error("actual macro worker import failure")', 'export {}',
		'void Promise.reject(new Error("actual macro worker rejection")); await new Promise(() => {});',
		'queueMicrotask(() => { throw new Error("actual macro worker uncaught failure"); }); await new Promise(() => {});']) {
		const owner = createMacroThreadOwner();
		try {
			const worker = owner.createWorker(source, 'macro-resource-failure');
			const failure = await new Promise<unknown>(resolve => { worker.addEventListener('error', resolve); });
			assert.ok(failure && typeof failure === 'object' && 'message' in failure);
			assert.match(String(failure.message), /actual macro worker (?:import failure|rejection|uncaught failure)|exited unexpectedly \(0\)/u);
			await owner.dispose(); const record = owner.snapshot()[0]; assert.ok(record);
			assert.notEqual(record.exitCode, null); assert.ok(record.terminationRequested);
			await owner.dispose();
		} finally { await owner.dispose(); }
	}
	const owner = createMacroThreadOwner();
	await assert.rejects(async () => {
		try {
			const worker = owner.createWorker('self.addEventListener("message", () => {}); self.postMessage("owner-active");', 'macro-owner-failure');
			const observed = await new Promise<unknown>(resolve => { worker.addEventListener('message', resolve); });
			assert.ok(observed && typeof observed === 'object' && 'data' in observed && observed.data === 'owner-active');
			throw new Error('actual owner failure after thread entry');
		} finally { await owner.dispose(); }
	}, /actual owner failure after thread entry/u);
	assert.notEqual(owner.snapshot()[0]?.exitCode, null);
});
