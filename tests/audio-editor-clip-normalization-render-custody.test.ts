/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { measureBextLoudness } from '../src/common/editor/broadcast-loudness.ts';
import { localizedErrorMessage } from '../src/common/i18n/presentation-message.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';

interface Profile {
	readonly name: string;
	readonly duration: number;
	readonly channels: number;
	readonly frequency: number;
	readonly amplitude: number;
	readonly peak: boolean;
	readonly initialGain: number;
	readonly sha256: string;
}

const PROFILES: readonly Profile[] = [
	{ name: 'short LUFS refusal recovers through Peak', duration: .1, channels: 1, frequency: 1000, amplitude: .25,
		peak: false, initialGain: 1, sha256: 'b9a71f041c4715bf23a4096f6f4e29c664aae203b07c6c2157987b40afd0e2c5' },
	{ name: 'short Peak succeeds', duration: .1, channels: 1, frequency: 1000, amplitude: .25,
		peak: true, initialGain: 1, sha256: 'b9a71f041c4715bf23a4096f6f4e29c664aae203b07c6c2157987b40afd0e2c5' },
	{ name: 'one-second silence refuses LUFS', duration: 1, channels: 1, frequency: 1000, amplitude: 0,
		peak: false, initialGain: 1, sha256: '0a8f76d89c709043814cb74f331a4578d17ff61256303bd0019a263d053f86e8' },
	{ name: 'one-second programme reaches minus14 LUFS', duration: 1, channels: 1, frequency: 1000, amplitude: .25,
		peak: false, initialGain: 1, sha256: 'fea552ea9f8d86ae1ee08c415de211a62713f4e13d954152d3da9decf925e8a5' },
	{ name: 'sixteen-channel Peak measures unity rather than current gain', duration: 1, channels: 16, frequency: 523, amplitude: .35,
		peak: true, initialGain: .1, sha256: 'a1644a99bc5ced2cc7d113657234335de293c7a7e6ca4379aa4cface4c17f051' },
	{ name: 'short mono Peak measures unity rather than current gain', duration: .1, channels: 1, frequency: 523, amplitude: .35,
		peak: true, initialGain: .1, sha256: '2f37f44a017ba000f2e1d4d07295e1538cd24b774e968115212c649030512c7d' },
];

/** Digests come from the unchanged browser RIFF constructor, including its channel phases. */
function originalRecording(profile: Profile) {
	const frames = Math.round(profile.duration * 48_000), bytes = Buffer.alloc(44 + frames * profile.channels * 2);
	bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(profile.channels, 22);
	bytes.writeUInt32LE(48_000, 24); bytes.writeUInt32LE(48_000 * profile.channels * 2, 28);
	bytes.writeUInt16LE(profile.channels * 2, 32); bytes.writeUInt16LE(16, 34);
	bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
	const pcm = Array.from({ length: profile.channels }, () => new Float32Array(frames));
	for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < profile.channels; channel++) {
		const value = Math.round(Math.sin(2 * Math.PI * profile.frequency * frame / 48_000 + (channel ? Math.PI / 3 : 0)) * profile.amplitude * 32_767);
		bytes.writeInt16LE(value, 44 + (frame * profile.channels + channel) * 2);
		pcm[channel]![frame] = (value || 0) / 32_768;
	}
	assert.equal(createHash('sha256').update(bytes).digest('hex'), profile.sha256);
	return { frames, pcm, file: new File([bytes], profile.initialGain === .1 ? 'peak-normalize.wav' : 'Recording.wav', { type: 'audio/wav' }) };
}

function independentProgramme(input: readonly Float32Array[]) {
	return input.map(channel => Float32Array.from(channel, (sample, frame) => sample
		* (frame < 96 ? Math.sin(frame / 96 * Math.PI / 2) : 1)
		* (frame > channel.length - 96 ? Math.sin((channel.length - frame) / 96 * Math.PI / 2) : 1)));
}

function assertMeasuredProgramme(actual: readonly Float32Array[], expected: readonly Float32Array[]) {
	assert.equal(actual.length, expected.length, 'the actual normalization preview keeps every source channel');
	for (let channel = 0; channel < expected.length; channel++) {
		assert.equal(actual[channel]!.length, expected[channel]!.length);
		let peak = 0; for (const value of expected[channel]!) peak = Math.max(peak, Math.abs(value));
		for (let frame = 0; frame < expected[channel]!.length; frame++) {
			const edge = frame < 96 || frame > expected[channel]!.length - 96;
			// The native graph's adaptive linear ramps approximate curved gain within .001.
			const tolerance = edge ? peak * .0011 + 1e-7 : 1e-7;
			if (!(Math.abs(actual[channel]![frame]! - expected[channel]![frame]!) < tolerance))
				assert.fail(`Independent unity preview channel${channel}/frame${frame}: ${actual[channel]![frame]} versus ${expected[channel]![frame]}`);
		}
	}
}

for (const profile of PROFILES) test(`real clip normalization: ${profile.name}`, { timeout: 30_000 }, async context => {
	const native = createNodeWebAudioEngineFactory(context), previews: Float32Array[][] = [];
	let observing = false;
	const createEngine: typeof native.createEngine = options => {
		const engine = native.createEngine(options), render = engine.renderMix.bind(engine);
		// Observe the completed genuine render; return its original buffer without changing scheduling or PCM.
		engine.renderMix = async options => {
			const output = await render(options);
			if (observing) {
				assert.ok(output instanceof AudioBuffer);
				assert.equal(output.sampleRate, 48_000);
				previews.push(Array.from({ length: output.numberOfChannels }, (_, channel) => {
					const pcm = new Float32Array(output.length); output.copyFromChannel(pcm, channel); return pcm;
				}));
			}
			return output;
		};
		return engine;
	};
	const { controller, store } = await controllerSession(context, { engine: createEngine(), engineFactory: createEngine });
	try {
		const recording = originalRecording(profile), programme = independentProgramme(recording.pcm);
		await controller.actions.project.importFiles([recording.file]);
		const imported = clipboardProject(controller.project), clip = imported.clips[0], source = imported.sources[0];
		assert.ok(clip?.kind === 'audio' && source?.kind === 'audio');
		assert.deepEqual([imported.clips.length, imported.sources.length, source.channelCount, source.frameCount, source.sampleRate],
			[1, 1, profile.channels, recording.frames, 48_000]);
		assert.deepEqual([clip.sourceId, clip.sourceStartFrame, clip.timelineStartFrame, clip.sourceDurationFrames, clip.durationFrames,
			clip.gain, clip.fadeInFrames, clip.fadeOutFrames, clip.fadeInShape, clip.fadeOutShape],
			[source.id, 0, 0, recording.frames, recording.frames, 1, 96, 96, 1, 1]);
		assertPcmChannelsEqual(await readCustodyPcm(store, source), recording.pcm, 'original decoded RIFF16');
		if (profile.initialGain !== 1) controller.actions.clip.update(clip.id, { gain: profile.initialGain });
		controller.actions.timeline.selectClip(clip.id);
		const baseline = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
		const contexts = native.snapshot().offlineContexts;
		const normalize = async (peak: boolean) => {
			observing = true;
			try { await (peak ? controller.actions.clip.normalizePeak(clip.id) : controller.actions.clip.normalizeLoudness(clip.id)); }
			finally { observing = false; }
		};
		const refuses = !profile.peak && (profile.duration < .4 || profile.amplitude === 0);
		if (refuses) {
			await assert.rejects(normalize(false), error => error instanceof RangeError
				&& localizedErrorMessage(error)?.key === 'clipNormalizationUnmeasurable');
			assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(baseline));
			assert.equal(controller.getSnapshot().history.undoEntries.length, history, 'refused measurement creates no history');
			if (profile.amplitude > 0) await assert.doesNotReject(normalize(true), 'Peak recovers after a short LUFS refusal');
		} else await assert.doesNotReject(normalize(profile.peak), 'the original healthy normalization is admitted');
		assert.equal(previews.length, refuses && profile.amplitude > 0 ? 2 : 1);
		assert.equal(native.snapshot().offlineContexts, contexts + previews.length);
		for (const preview of previews) assertMeasuredProgramme(preview, programme);
		const changed = clipboardProject(controller.project), normalized = changed.clips.find(value => value.id === clip.id);
		assert.ok(normalized?.kind === 'audio');
		const changedGain = !refuses || profile.amplitude > 0;
		if (changedGain) {
			assert.ok(normalized.gain > 1 && normalized.gain < 10 ** (12 / 20), 'the original UI gain bounds remain satisfied');
			if (profile.peak || refuses) {
				let peak = 0; for (const channel of programme) for (const value of channel) peak = Math.max(peak, Math.abs(value));
				assert.ok(Math.abs(normalized.gain - 10 ** (-1 / 20) / peak) < 1e-6, 'Peak target is minus1dBFS at unity clip gain');
			} else {
				const normalizedProgramme = programme.map(channel => Float32Array.from(channel, sample => sample * normalized.gain));
				const lufs = measureBextLoudness(normalizedProgramme, 48_000).loudnessValue;
				assert.ok(typeof lufs === 'number' && Math.abs(lufs + 14) < .03, `independent programme LUFS ${lufs}`);
			}
			assert.deepEqual(clipboardDocument(changed), clipboardDocument({ ...baseline,
				clips: baseline.clips.map(value => value.id === clip.id ? { ...value, gain: normalized.gain } : value) }));
			assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
			controller.actions.edit.undo();
			assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(baseline));
			controller.actions.edit.redo();
			assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(changed));
		} else assert.equal(normalized.gain, 1);
		await controller.actions.project.flush(); assert.deepEqual(await store.loadProject(changed.id), controller.project);
		assertPcmChannelsEqual(await readCustodyPcm(store, source), recording.pcm, 'original PCM after normalization/history/store');
		assert.ok(native.snapshot().worklets.every(worklet => worklet.processorErrors.length === 0));
	} finally { await controller.dispose(); await native.dispose(); }
});
