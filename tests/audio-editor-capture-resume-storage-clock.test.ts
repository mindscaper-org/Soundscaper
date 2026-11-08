/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaptureRuntimeAvailability } from '../src/common/editor/framescaper-capture-domain.ts';
import { createFramescaperCapturePauseActions } from '../src/common/editor/controller/capture/internal/framescaper-capture-pause-actions.ts';
import { createFramescaperCaptureActiveTimeClock } from '../src/common/editor/controller/capture/internal/framescaper-capture-active-time-clock.ts';
import { createFramescaperCaptureStateMachine } from '../src/common/editor/controller/capture/internal/framescaper-capture-state-machine.ts';
import type { FramescaperCaptureDurableSession } from '../src/common/editor/controller/capture/framescaper-capture-session-types.ts';

test('Resume starts encoders alongside journal publication instead of counting storage wait without media', async context => {
	const machine = createFramescaperCaptureStateMachine({ availability: createCaptureRuntimeAvailability({ status: 'available', sourceRoles: ['camera'] }) });
	const generation = machine.requestPreview(machine.issueDirectGesture(), ['camera']);
	machine.previewReady(generation, [{ sourceId: 'camera', role: 'camera' }]);
	machine.arm({ destination: 'both', countdownMs: 0 }); machine.beginCountdown(); machine.startRecording();
	let now = 1000;
	let excludedUs = -1, resumedAtMs = -1;
	let release!: () => void, entered!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const writing = new Promise<void>(resolve => { entered = resolve; });
	context.after(() => { release(); });
	const clock = createFramescaperCaptureActiveTimeClock(0);
	const session: FramescaperCaptureDurableSession = { sessionId: 'session', sources: [{ streamId: 'camera', sourceId: 'source', role: 'camera' }],
		destination: 'both', projectFence: { schemaFamily: 'framescaper', schemaVersion: 1, projectId: 'project', baseRevision: 0, baseSha256: 'ab'.repeat(32) },
		origin: { sequenceId: 'sequence', playheadMicroseconds: 0, destination: 'both' } };
	const actions = createFramescaperCapturePauseActions({ machine, assertActive() {}, clock: () => clock,
		session: () => session, setSession() {}, now: () => now, notify() {}, recover: async error => { throw error; },
		durable: { async recordPauseSpan(value) { entered(); await gate; return value; } },
		recorders: () => [{ format: { kind: 'encoded-media', mimeType: 'video/webm' }, start() {},
			pause() { return true; }, resume(value = 0) { resumedAtMs = now; excludedUs = value; return true; }, stop() {}, dispose() {} }],
	});
	await actions.pause(); now = 2000; const resuming = actions.resume(); await writing;
	await new Promise<void>(resolve => { setImmediate(resolve); });
	const startedBeforePublication = resumedAtMs; now = 5000; release(); await resuming;
	assert.deepEqual({ startedBeforePublication, activeMs: clock.snapshot(now).activeTimeMs, excludedUs },
		{ startedBeforePublication: 2000, activeMs: 4000, excludedUs: 1_000_000 });
});
