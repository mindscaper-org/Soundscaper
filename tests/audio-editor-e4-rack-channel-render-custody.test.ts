/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { resolveTerminalChannelWidths } from '../src/common/editor/terminal-channel-widths.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';

const SAMPLE_RATE = 48_000, RECORDING_FRAMES = 768_000;
type Width = 1 | 2 | 6;
const RECORDING_HASHES = {
	1: '205899e66a01c7abab8be0b34d9786f78d144bf3dad787f2bc19ad25160b4d32',
	2: 'a737569095145280aba63656f0866eaacede2bfb5288bd66d10f2ae19a967393',
	6: '10a1ec0b3bc87766654382457f55a1fe53a0fbe5ffe25ba7bce49f5f4add3e35',
};
// Digests come from independently executing the original browser createWavFixture.
const WIDE_HASHES = {
	2: 'c8cc59b36af8d7360eda593b020040e51aed8165f0af41a70c16b4a947b7b18b',
	6: 'c785b0bc1b4512b5cd0710b82c7d4891cab785b0e82cb1934ee72986e9d67969',
};

function originalWav(width: Width, silent = false) {
	const frames = silent ? 12_000 : RECORDING_FRAMES;
	const bytes = Buffer.alloc(44 + frames * width * 2);
	bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(width, 22);
	bytes.writeUInt32LE(SAMPLE_RATE, 24); bytes.writeUInt32LE(SAMPLE_RATE * width * 2, 28);
	bytes.writeUInt16LE(width * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
	const amplitudes = [.25, .125, .08, .04, .02, .01];
	const pcm = Array.from({ length: width }, () => new Float32Array(frames));
	for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < width; channel++) {
		const sample = silent ? 0 : Math.round(Math.sin(2 * Math.PI * 1000 * frame / SAMPLE_RATE + (channel ? Math.PI / 3 : 0)) * amplitudes[channel]! * 32_767);
		bytes.writeInt16LE(sample, 44 + (frame * width + channel) * 2); pcm[channel]![frame] = (sample || 0) / 32_768;
	}
	if (silent) { assert.ok(width === 2 || width === 6); assert.equal(createHash('sha256').update(bytes).digest('hex'), WIDE_HASHES[width]); }
	else assert.equal(createHash('sha256').update(bytes).digest('hex'), RECORDING_HASHES[width]);
	return { file: new File([bytes], silent ? 'Wide.wav' : 'Recording.wav', { type: 'audio/wav' }), pcm };
}

function rms(pcm: Float32Array): number {
	let power = 0;
	for (let frame = SAMPLE_RATE; frame < SAMPLE_RATE * 2; frame++) power += pcm[frame]! ** 2;
	return Math.sqrt(power / SAMPLE_RATE);
}

for (const effectName of ['Tremolo', 'Invert'] as const) for (const topology of ['mixed-stereo', 'mono', 'stereo', 'surround', 'mixed-surround'] as const) {
	test(`shipping ${effectName} retains original ${topology} rack channels, PCM, history and source custody`, { timeout: 30_000 }, async context => {
		const native = createNodeWebAudioEngineFactory(context);
		const engine = native.createEngine();
		const { controller, store } = await controllerSession(context, { engine, engineFactory: native.createEngine });
		const mixed = topology.startsWith('mixed'), width = topology.endsWith('surround') ? 6 : 2;
		const recording = originalWav(mixed || topology === 'mono' ? 1 : width);
		const wide = mixed ? originalWav(width, true) : null;
		const inputs = wide ? [wide, recording] : [recording];
		try {
			const initialTracks = clipboardProject(controller.project).tracks.length;
			await controller.actions.project.importFiles(inputs.map(input => input.file));
			const imported = clipboardProject(controller.project);
			assert.equal(imported.sources.length, inputs.length); assert.equal(imported.clips.length, inputs.length);
			assert.equal(imported.tracks.length, initialTracks + inputs.length);
			const recordingSource = imported.sources.find(source => source.name === 'Recording.wav'); assert.ok(recordingSource);
			const recordingClip = imported.clips.find(clip => clip.sourceId === recordingSource.id); assert.ok(recordingClip);
			assert.equal(recordingClip.title, 'Recording');
			const sourceTrack = imported.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(recordingClip.id)); assert.ok(sourceTrack);
			let targetTrackId = sourceTrack.id;
			if (wide) {
				const wideSource = imported.sources.find(source => source.name === 'Wide.wav'); assert.ok(wideSource);
				const wideClip = imported.clips.find(clip => clip.sourceId === wideSource.id); assert.ok(wideClip);
				assert.equal(wideClip.title, 'Wide');
				const target = imported.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(wideClip.id)); assert.ok(target);
				targetTrackId = target.id;
				controller.actions.clip.move(recordingClip.id, target.id, 0);
				const moved = clipboardProject(controller.project);
				assert.deepEqual(moved.tracks.find(track => track.id === sourceTrack.id)?.clipIds, []);
				const movedIds = moved.tracks.find(track => track.id === target.id)?.clipIds; assert.ok(Array.isArray(movedIds));
				assert.deepEqual([...movedIds].sort(), [wideClip.id, recordingClip.id].sort());
				assert.deepEqual(moved.sources, imported.sources); assert.equal(moved.clips.length, 2);
			}
			const beforeProject = clipboardProject(controller.project), beforeHistory = controller.getSnapshot().history.undoEntries.length;
			const targetTrack = beforeProject.tracks.find(track => track.id === targetTrackId); assert.ok(targetTrack);
			assert.deepEqual(targetTrack.effects, []);
			assert.equal(beforeProject.masterChannels, 2);
			const assignment = beforeProject.mixer.edges.find(edge => edge.source.kind === 'track' && edge.source.id === targetTrackId && edge.destination.kind === 'master'); assert.ok(assignment);
			assert.deepEqual([assignment.position, assignment.level, assignment.enabled, assignment.channelMap], ['post-fader', 1, true, topology === 'mono' ? [0, 0] : [0, 1]]);
			assert.equal(resolveTerminalChannelWidths(projectForRuntimeConsumers(beforeProject), 2).tracks.get(targetTrackId), mixed ? width : topology === 'mono' ? 1 : width);
			const sourceBuffers = new Map<string, AudioBuffer>();
			for (const source of beforeProject.sources) {
				assert.ok(source.kind === 'audio'); const input = inputs.find(input => input.file.name === source.name); assert.ok(input);
				assert.deepEqual([source.sampleRate, source.channelCount, source.frameCount], [SAMPLE_RATE, input.pcm.length, input.pcm[0]!.length]);
				assertPcmChannelsEqual(await readCustodyPcm(store, source), input.pcm, `all original ${source.name} source samples`);
				const clip = beforeProject.clips.find(clip => clip.sourceId === source.id); assert.ok(clip);
				const visual = controller.getClipVisualData(clip.id);
				// Incremental imports intentionally retain chunk providers instead of eager visual buffers.
				// Use the production repository reader and the actual engine's allocation context, never fixture PCM.
				const buffer = visual?.buffer ?? await store.loadSourceAudioBuffer(source.storageKey, await engine.getAudioContext({ resume: false }));
				assert.ok(buffer instanceof AudioBuffer); sourceBuffers.set(source.id, buffer);
			}
			const render = async () => {
				const renderer = native.createEngine();
				try {
					renderer.loadProject(projectForRuntimeConsumers(clipboardProject(controller.project)), sourceBuffers);
					const output = await renderer.renderMix({ startFrame: 0, endFrame: RECORDING_FRAMES }); assert.ok(output instanceof AudioBuffer);
					assert.deepEqual([output.length, output.numberOfChannels, output.sampleRate], [RECORDING_FRAMES, 2, SAMPLE_RATE]);
					return Array.from({ length: 2 }, (_, channel) => {
						const pcm = new Float32Array(RECORDING_FRAMES); output.copyFromChannel(pcm, channel); return pcm;
					});
				} finally { await renderer.dispose(); }
			};
			const before = await render(), beforeRms = before.map(rms); assert.ok(beforeRms[0]! > .12);
			if (topology === 'mono' || topology === 'mixed-stereo') assert.ok(beforeRms[1]! / beforeRms[0]! > .99);
			// Static mono/stereo/front-pair geometry has an independent source/panner oracle.
			if (!mixed) for (let channel = 0; channel < 2; channel++) for (let frame = SAMPLE_RATE; frame < SAMPLE_RATE * 2; frame++) {
				const expected = recording.pcm[topology === 'mono' ? 0 : channel]![frame]! * (topology === 'mono' ? Math.SQRT1_2 : 1);
				if (!(Math.abs(before[channel]![frame]! - expected) < 1e-6)) assert.fail(`Independent baseline channel${channel}/frame${frame}: ${before[channel]![frame]} versus ${expected}`);
			}
			const effectType = effectName === 'Tremolo' ? 'tremolo' : 'audacity-invert';
			const effectId = controller.actions.effects.add({ scope: 'track', trackId: targetTrackId, type: effectType }); assert.ok(effectId);
			if (effectName === 'Tremolo') controller.actions.effects.update('track', targetTrackId, effectId, { params: { waveform: 'sine', phase: 0, depth: 0, frequency: 4 } });
			const afterProject = clipboardProject(controller.project), afterTrack = afterProject.tracks.find(track => track.id === targetTrackId); assert.ok(afterTrack);
			assert.ok(Array.isArray(afterTrack.effects)); assert.equal(afterTrack.effects.length, 1);
			const effect: unknown = afterTrack.effects[0]; assert.ok(effect && typeof effect === 'object' && 'type' in effect && 'params' in effect);
			assert.equal(effect.type, effectType);
			assert.deepEqual(effect.params, effectName === 'Tremolo' ? { waveform: 'sine', phase: 0, depth: 0, frequency: 4 } : {});
			assert.deepEqual(clipboardDocument(afterProject), { ...clipboardDocument(beforeProject),
				featureRequirements: { ...beforeProject.featureRequirements, requirements: [...beforeProject.featureRequirements.requirements,
					{ id: 'soundscaper.audio-effects', featureId: 'org.soundscaper.capability.audio-effects', displayName: 'Audio effects', disposition: 'bypass', fallback: null }] },
				tracks: beforeProject.tracks.map(track => track.id === targetTrackId ? { ...track, effects: afterTrack.effects } : track) });
			assert.equal(controller.getSnapshot().history.undoEntries.length, beforeHistory + (effectName === 'Tremolo' ? 2 : 1));
			const after = await render(), afterRms = after.map(rms);
			for (let channel = 0; channel < 2; channel++) {
				assert.ok(Math.abs(afterRms[channel]! - beforeRms[channel]!) < .005);
				for (let frame = 0; frame < RECORDING_FRAMES; frame++) {
					const expected = before[channel]![frame]! * (effectName === 'Invert' ? -1 : 1);
					if (!(Math.abs(after[channel]![frame]! - expected) < 1e-6)) assert.fail(`Whole rendered ${effectName} channel${channel}/frame${frame}: ${after[channel]![frame]} versus ${expected}`);
				}
			}
			const stats = native.snapshot(); assert.ok(stats.offlineContexts >= 2);
			const worklets = stats.worklets.filter(worklet => worklet.name === (effectName === 'Tremolo' ? 'kw-standard-effect' : 'kw-audacity-live-effect'));
			assert.ok(worklets.length >= (effectName === 'Invert' ? 2 : 1), 'the actual rack must instantiate a shipping worker, including the Audacity readiness probe');
			assert.ok(worklets.every(worklet => worklet.processorErrors.length === 0));
			if (effectName === 'Invert') assert.ok(worklets.some(worklet => worklet.module && worklet.wasmModuleKeys.includes('pffftWasmModule')
				&& worklet.messages.some(message => message.type === 'status' && message.status === 'ready')));
			controller.actions.edit.undo();
			if (effectName === 'Tremolo') controller.actions.edit.undo();
			assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(beforeProject));
			controller.actions.edit.redo(); if (effectName === 'Tremolo') controller.actions.edit.redo();
			assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(afterProject));
			await controller.actions.project.flush(); assert.deepEqual(await store.loadProject(afterProject.id), controller.project);
			assert.deepEqual(clipboardProject(controller.project).sources, beforeProject.sources);
		} finally { await controller.dispose(); await native.dispose(); }
	});
}
