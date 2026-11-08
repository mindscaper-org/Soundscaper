/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createEditorTransportService } from '../src/common/editor/controller/transport/internal/transport-service.ts';
import { calculateAudioEditorMetronomeSchedule } from '../src/common/editor/controller/transport/transport-model.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createTransportFixture } from './helpers/audio-editor-transport-fixture.ts';

function fixture(t: TestContext, options: Readonly<{ endFrame?: number; rate?: number; loop?: boolean;
	origin?: number; fromFrame?: number; recording?: boolean; reportedEnd?: 'missing' | 'null' | 'zero' }> = {}) {
	const base = createTransportFixture(), starts: number[] = [], voices: { stops: number; times: (number | undefined)[] }[] = [];
	const rate = options.rate ?? 1, origin = options.origin ?? 0, fromFrame = options.fromFrame ?? 0;
	const endFrame = options.endFrame ?? 24_000;
	const loop = { enabled: options.loop ?? false, startFrame: 0, endFrame };
	const context = { currentTime: origin, destination: {},
		createOscillator() {
			const voice: { stops: number; times: (number | undefined)[] } = { stops: 0, times: [] }; voices.push(voice);
			return { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, onended: null,
				start(when: number) { starts.push(when); }, stop(when?: number) { voice.stops++; voice.times.push(when); } };
		},
		createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }),
	};
	base.setAudioContext(context); base.state.metronomeEnabled = true;
	base.state.transportState = options.recording ? 'recording' : 'playing';
	const durationFrames = options.recording ? endFrame : 96_000;
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: durationFrames, channelCount: 1 });
	const project = createSoundscaperProject({ id: 'bounded-metronome', sampleRate: 48_000, loop, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames, sourceDurationFrames: durationFrames })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
		selection: { startFrame: fromFrame, endFrame: options.recording ? fromFrame : endFrame, trackIds: ['track'], clipIds: [] } });
	const position = () => {
		const frame = fromFrame + Math.round((context.currentTime - origin) * 48_000 * rate);
		return loop.enabled ? frame % endFrame : Math.min(frame, endFrame);
	};
	const service = createEditorTransportService({ ...base.runtime, getProject: () => project,
		calculateAudioEditorMetronomeSchedule,
		engine: { ...base.runtime.engine, getPositionFrames: position, getPlaybackAudibleStartTime: () => origin,
			getState: () => ({ state: options.recording && position() >= endFrame ? 'stopped' : 'playing', positionFrame: position(), durationFrames,
				playbackStartFrame: fromFrame,
				...(options.reportedEnd === 'missing' ? {} : { playbackEndFrame: options.reportedEnd === 'null' ? null
					: options.reportedEnd === 'zero' ? 0 : endFrame }), playbackRate: rate,
				playbackMode: rate === 1 ? 'normal' as const : 'naive' as const, loop }),
		},
	});
	t.after(() => service.stopMetronome());
	return { starts, voices, service, async at(elapsed: number) {
		context.currentTime = origin + elapsed;
		await service.runMetronomeScheduler();
		clearTimeout(base.state.metronomeTimer); base.state.metronomeTimer = 0;
	} };
}

test('normal selection lookahead never starts a click at its terminal frame', async t => {
	const f = fixture(t); await f.at(0); await f.at(.4); await f.at(.49); await f.at(.5);
	assert.deepEqual(f.starts, [0]);
});

test('double-speed selection uses the scheduled source end rather than full project duration', async t => {
	const f = fixture(t, { rate: 2, endFrame: 48_000 });
	await f.at(0); await f.at(.2); await f.at(.4); await f.at(.5);
	assert.deepEqual(f.starts, [0, .25]);
});

test('a resumed selection retains its source offset and omits its terminal downbeat', async t => {
	const f = fixture(t, { origin: 50, fromFrame: 12_000, endFrame: 48_000 });
	await f.at(0); await f.at(.2); await f.at(.6); await f.at(.75);
	assert.deepEqual(f.starts, [50.25]);
});

test('a live loop continues through its wraps despite its finite body end', async t => {
	const f = fixture(t, { loop: true }); await f.at(0); await f.at(.4); await f.at(.9);
	assert.deepEqual(f.starts, [0, .5, 1]);
});

test('capture cadence continues after its backing playback boundary', async t => {
	const f = fixture(t, { recording: true }); await f.at(0); await f.at(.4); await f.at(.9);
	assert.deepEqual(f.starts, [0, .5, 1]);
});

test('Stop still cancels every already queued valid click', async t => {
	const f = fixture(t, { endFrame: 48_000 }); await f.at(0); await f.at(.4);
	assert.deepEqual(f.starts, [0, .5]); f.service.stopMetronome();
	assert.ok(f.voices.every(voice => voice.stops === 2));
});

for (const reportedEnd of ['missing', 'null'] as const) test(`${reportedEnd} optional boundary retains unbounded scheduling`, async t => {
	const f = fixture(t, { reportedEnd }); await f.at(0); await f.at(.4);
	assert.deepEqual(f.starts, [0, .5]);
});

test('a reported zero boundary is a real end, rather than an absent capability', async t => {
	const f = fixture(t, { reportedEnd: 'zero' }); await f.at(0); await f.at(.4);
	assert.deepEqual(f.starts, []);
});

for (const [rate, origin, fromFrame, endFrame, elapsed, expected] of [
	[1, 0, 0, 24_048, .4, .501], [2, 0, 0, 48_048, .4, .5005], [1, 50, 12_000, 48_048, .6, 50.751],
] as const) test(`a retained click stops at the exact audio boundary (rate=${rate},origin=${origin})`, async t => {
	const f = fixture(t, { rate, origin, fromFrame, endFrame }); await f.at(0); await f.at(elapsed);
	assert.ok(f.starts.length > 0);
	assert.equal(f.voices.at(-1)?.times[0], expected);
});

for (const options of [{ loop: true }, { recording: true }]) test(`an independent clock keeps a full click at the body boundary ${JSON.stringify(options)}`, async t => {
	const f = fixture(t, options); await f.at(0); await f.at(.4);
	assert.equal(f.voices.at(-1)?.times[0], .54);
});
