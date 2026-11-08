/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperBrowserVideoRecorder, type FramescaperMediaRecorderLike } from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-video-recorder.ts';
import { createFramescaperCaptureMetrics } from '../src/common/editor/controller/capture/internal/framescaper-capture-metrics.ts';
import type { CaptureEncodedVideoPacket } from '../src/common/editor/framescaper-capture-domain.ts';

class NativeTimecodeRecorder implements FramescaperMediaRecorderLike {
	readonly mimeType = 'video/webm';
	state = 'inactive';
	ondataavailable: FramescaperMediaRecorderLike['ondataavailable'] = null;
	onerror: FramescaperMediaRecorderLike['onerror'] = null;
	onstop: FramescaperMediaRecorderLike['onstop'] = null;
	start() { this.state = 'recording'; }
	pause() { this.state = 'paused'; }
	resume() { this.state = 'recording'; }
	stop() { this.state = 'inactive'; queueMicrotask(() => { this.onstop?.(); }); }
	emit(timecode: number) { this.ondataavailable?.({ data: new Blob([Uint8Array.of(1)]), timecode }); }
}

for (const length of ['short', 'two-chunks'] as const) test(`a ${length} camera recording retains its relative native BlobEvent clock without false drift`, async () => {
	let now = 0;
	const packets: CaptureEncodedVideoPacket[] = [];
	const metrics = createFramescaperCaptureMetrics([{ streamId: 'camera', role: 'camera' }]);
	const recorder = createFramescaperBrowserVideoRecorder({ MediaRecorder: NativeTimecodeRecorder,
		stream: {}, sessionId: 'session', streamId: 'camera', role: 'camera', selectedMimeType: 'video/webm',
		receiptTime: () => now, onPacket: packet => { packets.push(packet); },
	});
	recorder.start(); now = length === 'short' ? 200 : 1000;
	// Real Chromium starts BlobEvent.timecode at zero even though this event ends
	// a non-empty first chunk. A second event has the relative offset, with jitter.
	recorder.mediaRecorder.emit(0);
	if (length === 'two-chunks') { now = 2000.1; recorder.mediaRecorder.emit(1000.1); }
	await recorder.stop();
	const endUs = Math.round(now * 1000);
	assert.equal(packets.reduce((sum, packet) => sum + packet.durationUs, 0), endUs);
	for (const packet of packets) metrics.observe(packet, endUs);
	assert.equal(metrics.snapshot[0]?.capturedDurationUs, endUs);
	assert.equal(metrics.snapshot[0]?.currentDriftUs.value, 0);
	await recorder.dispose();
});
