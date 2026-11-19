/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { timecodeReceiveBlocked } from '../src/common/editor/ui/workspace/timecode-sync-workspace.ts';
import { createTimecodeSyncSession, DEFAULT_TIMECODE_SYNC_SETTINGS } from '../src/common/editor/controller/transport/timecode-sync-session.ts';

for (const receive of ['mtc', 'ltc'] as const) test(`${receive} receive rejects a pending varispeed choice before opening devices or starting playback`, async () => {
	let requestedRate = .5, opened = 0, played = 0;
	const session = createTimecodeSyncSession({
		io: { devices: async () => ({ midiInputs: [], midiOutputs: [], audioInputs: [], audioOutputs: [] }),
			open: async () => { opened++; return { sendMidi() {}, clearMidi() {}, updateLtc() {}, close: async () => {} }; } },
		read: () => ({ projectId: 'project', sampleRate: 48000, positionFrame: 0, playing: false, speed: 1, blocked: false,
			receiveBlocked: timecodeReceiveBlocked({ playbackOptions: { rate: requestedRate } }, { playbackRate: 1 }) }),
		seek() {}, play: async () => { played++; }, pause: async () => {}, schedule: () => () => {},
	});
	try {
		await assert.rejects(session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, receive }), /normal playback/u);
		assert.equal(opened, 0); assert.equal(played, 0); assert.equal(session.getSnapshot().active, false);
		requestedRate = 1;
		await session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, receive });
		assert.equal(opened, 1); assert.equal(session.getSnapshot().active, true);
	} finally { await session.dispose(); }
});
