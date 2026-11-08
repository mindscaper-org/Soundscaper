/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createEditorTransportService } from '../src/common/editor/controller/transport/internal/transport-service.ts';
import { calculateAudioEditorMetronomeSchedule } from '../src/common/editor/controller/transport/transport-model.ts';
import { createTransportFixture } from './helpers/audio-editor-transport-fixture.ts';

function fixture(t: TestContext, gapFrames = 2400) {
	const f = createTransportFixture(), starts: number[] = [];
	const context = { currentTime: 0, destination: {},
		createOscillator: () => ({ frequency: { setValueAtTime() {} }, connect() {}, disconnect() {},
			start(when: number) { starts.push(when); }, stop() {}, onended: null }),
		createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }),
	};
	f.setAudioContext(context); f.state.metronomeEnabled = true; f.state.transportState = 'playing';
	f.setPlaybackState({ state: 'playing', cutPreview: true });
	f.setPositionFrame(0);
	const segments = [{ startFrame: 0, endFrame: 22800, contextStartTime: 0 },
		{ startFrame: 22800 + gapFrames, endFrame: 70800 + gapFrames, contextStartTime: .475 }];
	const runtime = { ...f.runtime, calculateAudioEditorMetronomeSchedule,
		getProject: () => ({ sampleRate: 48000, tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 } } }),
		engine: { ...f.runtime.engine, getCutPreviewSegments: () => segments, getPlaybackAudibleStartTime: () => 0 },
	};
	const service = createEditorTransportService(runtime);
	t.after(() => { service.stopMetronome(); });
	return { starts, service, segments, async at(time: number) {
		context.currentTime = time;
		const segment = [...segments].reverse().find(segment => segment.contextStartTime <= time) ?? segments[0]!;
		f.setPositionFrame(Math.min(segment.endFrame, segment.startFrame + Math.round(Math.max(0, time - segment.contextStartTime) * 48000)));
		await service.runMetronomeScheduler();
		clearTimeout(f.state.metronomeTimer); f.state.metronomeTimer = 0;
	} };
}

for (const gap of [2400, 16800]) test(`cut-preview lookahead skips pulses inside the omitted ${gap}-frame range`, async t => {
	const f = fixture(t, gap);
	await f.at(0); await f.at(.4);
	assert.deepEqual(f.starts, [0], 'the next original beat is inside the omitted span');
});

test('cut-preview pulses after a short gap map to joined audio time without accumulating phase error', async t => {
	const f = fixture(t);
	await f.at(0); await f.at(.4); await f.at(.85); await f.at(1.35);
	assert.deepEqual(f.starts, [0, .95, 1.45]);
});

test('cut-preview lookahead does not schedule at or beyond the terminal audio boundary', async t => {
	const f = fixture(t);
	await f.at(0); await f.at(1.4); await f.at(1.5);
	assert.deepEqual(f.starts, [0, 1.45]);
	assert.ok(f.starts.every(when => when < 1.475));
});

for (const sourceFrame of [12000, 38400]) test(`resuming a cut-preview clock at source frame${sourceFrame} preserves its beat positions`, async t => {
	const f = fixture(t);
	await f.at(0); f.service.stopMetronome();
	f.segments.splice(0, f.segments.length, ...(sourceFrame < 22800
		? [{ startFrame: sourceFrame, endFrame: 22800, contextStartTime: 51 },
			{ startFrame: 25200, endFrame: 73200, contextStartTime: 51 + (22800 - sourceFrame) / 48000 }]
		: [{ startFrame: sourceFrame, endFrame: 73200, contextStartTime: 51 }]));
	await f.at(51.2); await f.at(51.7);
	assert.deepEqual(f.starts, sourceFrame < 22800 ? [0, 51.7] : [0, 51.2, 51.7]);
});
