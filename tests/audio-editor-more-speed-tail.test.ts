/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine, estimatePlayAtSpeedStaffPadPeakBytes, PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES } from '../src/common/editor/engine.js';
import { createEffect } from '../src/common/editor/effects.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { MockAudioContext } from './helpers/mock-audio-context.js';

function project(seconds = 1, sampleRate = 48_000) {
	const frames = Math.round(seconds * sampleRate);
	return createSoundscaperProject({ id: 'speed-tail', sampleRate,
		sources: [createAudioSource({ id: 'source', frameCount: frames, channelCount: 2, sampleRate })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: frames, sourceDurationFrames: frames })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'], effects: [createEffect('delay', { id: 'echo', params: { time: 1, feedback: 0, mix: 1 } })] }, sampleRate)] });
}

function fixture(seconds = 1, rate = 48_000) {
	const device = new MockAudioContext({ sampleRate: rate });
	const requests: Array<{ frames: number; tail: number }> = [];
	const engine = createAudioEditorEngine({ audioContextFactory: () => device as unknown as AudioContext,
		offlineAudioContextFactory: null, softwareRenderer: ({ startFrame, endFrame, tailFrames }) => {
			const frames = Number(endFrame) - Number(startFrame) + Number(tailFrames);
			requests.push({ frames, tail: Number(tailFrames) });
			// Deterministic storage/render boundary: the production range planner
			// decides whether the known one-second audible release is admitted.
			return { channels: Array.from({ length: 2 }, () => new Float32Array(frames).fill(.25)), sampleRate: rate };
		} });
	engine.loadProject(project(seconds, rate));
	const pitchPreserver: NonNullable<NonNullable<Parameters<typeof engine.playAtSpeed>[1]>['pitchPreserver']> =
		(channels, _rate, speed) => Promise.resolve(channels.map(channel => Float32Array.from({ length: Math.ceil(channel.length / speed) },
			(_, frame) => channel[Math.min(channel.length - 1, Math.floor(frame * speed))]!)));
	return { engine, device, requests, pitchPreserver };
}

test('pitch-preserving playback admits the audible release and maps seeks over its complete prepared extent', async context => {
	const { engine, device, requests, pitchPreserver } = fixture();
	context.after(async () => { await engine.dispose(); });
	await engine.playAtSpeed(2, { preservePitch: true, pitchPreserver });
	assert.deepEqual(requests, [{ frames: 96_000, tail: 48_000 }]);
	assert.equal(device.bufferSources[0]!.buffer.length, 48_000);
	engine.seek(48_000);
	for (let turn = 0; turn < 20; turn++) await Promise.resolve();
	assert.equal(device.bufferSources.at(-1)!.started?.[1], .5, 'the source ending maps before the prepared release, not to its end');
});

test('a loop boundary inside the prepared release cuts that body at the authored loop edge', async context => {
	const { engine, device, pitchPreserver } = fixture();
	context.after(async () => { await engine.dispose(); });
	engine.setLoop({ enabled: true, startFrame: 0, endFrame: 72_000 });
	await engine.playAtSpeed(2, { preservePitch: true, pitchPreserver });
	assert.equal(device.bufferSources[0]!.loop, true);
	assert.equal(device.bufferSources[0]!.loopEnd, .75);
	assert.equal(device.bufferSources[0]!.buffer.length, 48_000);
});

test('pausing and resuming inside the prepared release retains the actual source offset', async context => {
	const { engine, device, pitchPreserver } = fixture(31, 8_000);
	context.after(async () => { await engine.dispose(); });
	await engine.playAtSpeed(2, { preservePitch: true, pitchPreserver });
	assert.equal(device.bufferSources[0]!.buffer.duration, 16);
	device.currentTime = 15.75;
	await new Promise<void>(resolve => { setTimeout(resolve, 80); });
	assert.equal(engine.getState().state, 'playing');
	assert.equal(engine.getPositionFrames(), 252_000);
	engine.pause(); await engine.playAtSpeed(2, { preservePitch: true, pitchPreserver });
	assert.equal(device.bufferSources.at(-1)!.started?.[1], 15.75, 'resuming in the release keeps its actual prepared position');
});

test('StaffPad memory preflight includes the release before allocating offline PCM', async context => {
	let low = 1; let high = 20_000_000;
	while (high - low > 1) {
		const middle = Math.floor((low + high) / 2);
		if (estimatePlayAtSpeedStaffPadPeakBytes(middle, 48_000, 1) <= PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES) low = middle; else high = middle;
	}
	const frames = low - 24_000;
	assert.ok(estimatePlayAtSpeedStaffPadPeakBytes(frames, 48_000, 1) <= PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES);
	let allocated = 0;
	const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: () => { allocated++; throw new Error('Unexpected PCM allocation'); } });
	context.after(async () => { await engine.dispose(); });
	engine.loadProject(project(frames / 48_000));
	await assert.rejects(engine.playAtSpeed(1, { preservePitch: true, pitchPreserver: channels => Promise.resolve(channels) }),
		(error: unknown) => error instanceof RangeError && 'code' in error && error.code === 'PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT');
	assert.equal(allocated, 0);
});
