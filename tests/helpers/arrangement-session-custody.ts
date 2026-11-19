/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import type { TestContext } from 'node:test';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { controllerSession } from './soundscaper-controller-session.ts';
import { assertAudioProjectArchivePcm } from './audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './assert-pcm-samples.ts';

export type ArrangementMedia = 'bed' | 'a' | 'b';
export async function arrangementSession(context: TestContext, media: readonly ArrangementMedia[]) {
	const { controller, store } = await controllerSession(context, {
		scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engineFactory: () => { throw new Error('Arrangement custody must preserve source PCM without rendering substitutes.'); },
	});
	const expected = new Map<string, readonly Float32Array[]>();
	for (const name of media) {
		const channels = name === 'bed' ? 1 : 2, frames = name === 'bed' ? 384000 : 38400;
		const frequency = name === 'bed' ? 220 : name === 'a' ? 330 : 660;
		const bytes = Buffer.alloc(44 + frames * channels * 2);
		bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
		bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
		bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(48000 * channels * 2, 28);
		bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
		const pcm = Array.from({ length: channels }, () => new Float32Array(frames));
		for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
			const sample = Math.round(Math.sin(2 * Math.PI * frequency * frame / 48000 + (channel ? Math.PI / 3 : 0)) * .35 * 32767);
			bytes.writeInt16LE(sample, 44 + (frame * channels + channel) * 2); pcm[channel]![frame] = sample === 0 ? 0 : sample / 32768;
		}
		expected.set(`${name}.wav`, pcm);
		await controller.actions.project.importFiles([new File([Uint8Array.from(bytes)], `${name}.wav`, { type: 'audio/wav' })]);
	}
	function project() { const value: unknown = controller.project; assert.ok(validateSoundscaperProject(value)); return value; }
	function clips(name: ArrangementMedia) {
		const value = project(), source = value.sources.find(value => value.name === `${name}.wav`);
		if (!source) return []; // Cut may remove its unreferenced source from the document while the real clipboard retains its bytes.
		assert.ok(source.kind === 'audio');
		return value.clips.filter(value => value.sourceId === source.id).map(value => {
			assert.ok(value.kind === 'audio'); return value;
		}).sort((a, b) => Number(a.timelineStartFrame) - Number(b.timelineStartFrame));
	}
	function track(clipId: string) {
		const value = project().tracks.find(value => value.type === 'audio' && Array.isArray(value.clipIds) && value.clipIds.includes(clipId));
		assert.ok(value?.type === 'audio'); return value;
	}
	function edit(name: ArrangementMedia, source: number, duration: number, fadeIn: number, fadeOut: number, gain = 0) {
		const clip = clips(name)[0]; assert.ok(clip);
		controller.actions.clipSourcePreview.trim(clip.id, { sourceStartFrame: source, sourceDurationFrames: duration, durationFrames: duration });
		controller.actions.clip.update(clip.id, { fadeInFrames: fadeIn, fadeOutFrames: fadeOut, gain: 10 ** (gain / 20) });
		return clip.id;
	}
	function gain(clipId: string, points: readonly { frame: number; value: number }[]) { controller.actions.clip.update(clipId, { envelope: points }); }
	function automation(trackId: string) {
		const lane = { id: `gain-${trackId}`, address: { kind: 'strip', strip: { kind: 'track', id: trackId }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: 'begin', position: 0, value: .5 }, { id: 'end', position: 384000, value: .75 }], segments: [{ kind: 'linear' }] };
		controller.actions.edit.commit({ type: 'automation-lane/set', laneId: lane.id, expected: null, lane }); return lane.id;
	}
	function geometry(name: ArrangementMedia) { return clips(name).map(clip => [clip.timelineStartFrame, clip.durationFrames, clip.sourceStartFrame]); }
	async function reopen() {
		await controller.actions.project.flush();
		return assertAudioProjectArchivePcm(context, store, controller.project, (name, channels) => {
			const pcm = expected.get(name); assert.ok(pcm, `unexpected rendered source ${name}`);
			assertPcmChannelsEqual(channels, pcm, `${name} independently authored16-bit PCM`);
		});
	}
	return { controller, store, project, clips, track, edit, gain, automation, geometry, reopen };
}
