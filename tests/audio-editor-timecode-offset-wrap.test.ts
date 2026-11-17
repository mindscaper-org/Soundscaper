/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimecodeSyncSession, DEFAULT_TIMECODE_SYNC_SETTINGS } from '../src/common/editor/controller/transport/timecode-sync-session.ts';
import { encodeMtcFullFrame, MtcDecoder } from '../src/common/editor/timecode-mtc.ts';
import { TIMECODE_RATES, timecodeRate, type TimecodeReading } from '../src/common/editor/timecode-sync-format.ts';

for (const rate of TIMECODE_RATES) for (const [offsetSeconds, targetSeconds] of [[-1, 0], [86399, 2], [0, 86399]] as const) {
	test(`MTC ${rate} locates ${targetSeconds}s across a wire day with offset ${offsetSeconds}`, async () => {
		let receive: ((reading: TimecodeReading, time: number) => void) | undefined;
		const seeks: number[] = [], sampleRate = 48000;
		const session = createTimecodeSyncSession({ now: () => 0, schedule: () => () => {},
			read: () => ({ projectId: 'project', sampleRate, positionFrame: offsetSeconds === 0 ? 0 : targetSeconds * sampleRate, playing: false, speed: 1, blocked: false }),
			seek: frame => { seeks.push(frame); }, play: async () => {}, pause: async () => {},
			io: { devices: async () => ({ midiInputs: [], midiOutputs: [], audioInputs: [], audioOutputs: [] }),
				open: async (_settings, handler) => { receive = handler; return { sendMidi() {}, clearMidi() {}, updateLtc() {}, close: async () => {} }; } },
		});
		try {
			await session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, receive: 'mtc', rate, offsetSeconds, midiInput: 'input' });
			const [reading] = new MtcDecoder().push(encodeMtcFullFrame(Math.floor((targetSeconds + offsetSeconds) * timecodeRate(rate)), rate));
			assert.ok(receive && reading); receive(reading, 0); await session.settled();
			assert.ok(Math.abs(seeks[0]! - targetSeconds * sampleRate) <= Math.ceil(sampleRate / timecodeRate(rate)), `received ${seeks[0]} samples`);
		} finally { await session.dispose(); }
	});
}
