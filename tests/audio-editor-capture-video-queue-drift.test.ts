/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperCaptureSessionService } from '../src/common/editor/controller/capture/internal/framescaper-capture-session-service.ts';
import { createFramescaperCaptureOriginGuard } from '../src/common/editor/controller/capture/framescaper-capture-origin-guard.ts';
import { createCaptureRuntimeAvailability } from '../src/common/editor/framescaper-capture-domain.ts';
import { createFramescaperBrowserRecorderFactory } from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-recorder-factory.ts';
import type { FramescaperMediaRecorderLike } from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-video-recorder.ts';

class QueuedVideoRecorder implements FramescaperMediaRecorderLike {
	static readonly instances: QueuedVideoRecorder[] = [];
	static isTypeSupported() { return true; }
	readonly mimeType = 'video/webm'; state = 'inactive';
	ondataavailable: FramescaperMediaRecorderLike['ondataavailable'] = null;
	onerror: FramescaperMediaRecorderLike['onerror'] = null;
	onstop: FramescaperMediaRecorderLike['onstop'] = null;
	constructor() { QueuedVideoRecorder.instances.push(this); }
	start() { this.state = 'recording'; } pause() { this.state = 'paused'; } resume() { this.state = 'recording'; }
	stop() { this.state = 'inactive'; queueMicrotask(() => { this.onstop?.(); }); }
	emit(timecode: number) { this.ondataavailable?.({ data: new Blob([Uint8Array.of(1)]), timecode }); }
}

test('a queued video packet keeps its native arrival time when a prior durable append is slow', async context => {
	let now = 0, writes = 0;
	let release!: () => void, entered!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const firstWriting = new Promise<void>(resolve => { entered = resolve; });
	const track = { kind: 'video', stop() {} };
	const stream = { getTracks: () => [track], getAudioTracks: () => [], getVideoTracks: () => [track] };
	const receipts: number[] = [];
	let finalDriftUs: number | null = null;
	const createRecorder = createFramescaperBrowserRecorderFactory({ MediaRecorder: QueuedVideoRecorder,
		getAudioContext: () => ({ sampleRate: 48000 }), receiptTime: () => now });
	const service = createFramescaperCaptureSessionService({
		enabled: true, embedded: false, originGuard: createFramescaperCaptureOriginGuard(), now: () => now,
		sourcePort: {
			async probe() { return createCaptureRuntimeAvailability({ status: 'available', sourceRoles: ['camera'] }); },
			async enumerate() { return { devices: [] }; },
			async openPreview() { return { sources: [{ sourceId: 'camera', role: 'camera', stream,
				track, settings: {}, capabilities: {} }], async dispose() {} }; },
		},
		durable: { async prepare(request) { return request; }, async append(session, packet) {
			receipts.push(packet.receiptTimeMs);
			if (++writes === 1) { entered(); await gate; }
			return session;
		}, async recordPauseSpan(session) { return session; }, async seal(session) { return session; },
		async discard() {}, async findRecovery() { return null; } },
		captureOrigin: () => ({ projectFence: { schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: 'project', baseRevision: 0, baseSha256: 'ab'.repeat(32) },
			origin: { sequenceId: 'sequence', playheadMicroseconds: 0, destination: 'both' } }),
		createRecorder, finalize(request) { finalDriftUs = request.metrics[0]?.currentDriftUs.value ?? null; }, waitCountdown: async () => undefined,
	});
	context.after(async () => { release(); await service.dispose(); });
	await service.initialize(); await service.actions.requestPreview(['camera']);
	service.actions.arm({ destination: 'both', countdownMs: 0 }); await service.actions.start();
	const recorder = QueuedVideoRecorder.instances.at(-1); assert.ok(recorder);
	now = 1000; recorder.emit(0); await firstWriting;
	now = 2000; recorder.emit(1000);
	now = 4000; release();
	await service.actions.stop();
	assert.deepEqual({ receipts, finalDriftUs }, { receipts: [1000, 2000], finalDriftUs: 0 },
		'storage queueing must not rewrite event receipt or create false encoder drift');
});
