/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperCaptureSessionService } from '../src/common/editor/controller/capture/internal/framescaper-capture-session-service.ts';
import { createFramescaperCaptureOriginGuard } from '../src/common/editor/controller/capture/framescaper-capture-origin-guard.ts';
import { createCaptureRuntimeAvailability } from '../src/common/editor/framescaper-capture-domain.ts';

test('Record waits for an already requested camera format change before freezing encoder geometry', async context => {
	let release!: () => void;
	let entered!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const changing = new Promise<void>(resolve => { entered = resolve; });
	class Camera extends EventTarget {
		readonly readyState = 'live';
		width = 1280;
		getSettings() { return { width: this.width, height: 720, frameRate: 30 }; }
		async applyConstraints(constraints: Readonly<Record<string, unknown>>) {
			entered(); await gate;
			const width = constraints.width;
			assert.ok(width && typeof width === 'object' && 'exact' in width && typeof width.exact === 'number');
			this.width = width.exact;
		}
	}
	const camera = new Camera();
	const encoderWidths: number[] = [];
	const service = createFramescaperCaptureSessionService<{ id: string }, Camera>({
		enabled: true, embedded: false, originGuard: createFramescaperCaptureOriginGuard(),
		sourcePort: {
			async probe() { return createCaptureRuntimeAvailability({ status: 'available', sourceRoles: ['camera'] }); },
			async enumerate() { return { devices: [] }; },
			async openPreview() { return { sources: [{ sourceId: 'camera', role: 'camera', stream: { id: 'stream' },
				track: camera, settings: camera.getSettings(), capabilities: {} }], async dispose() {} }; },
		},
		durable: { async prepare(request) { return request; }, async append(session) { return session; },
			async recordPauseSpan(session) { return session; }, async seal(session) { return session; },
			async discard() {}, async findRecovery() { return null; } },
		captureOrigin: () => ({ projectFence: { schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: 'project', baseRevision: 0, baseSha256: 'ab'.repeat(32) },
			origin: { sequenceId: 'sequence', playheadMicroseconds: 0, destination: 'both' } }),
		createRecorder(request) { encoderWidths.push(request.source.track.getSettings().width); return {
			format: { kind: 'encoded-media', mimeType: 'video/webm' }, start() {}, pause() { return true; }, resume() { return true; }, stop() {}, dispose() {},
		}; }, finalize() {}, waitCountdown: async () => undefined,
	});
	context.after(async () => { await service.dispose(); });
	await service.initialize(); await service.actions.requestPreview(['camera']);
	const configuring = service.actions.configureSource('camera', { width: 1920 });
	await changing;
	service.actions.arm({ destination: 'both', countdownMs: 0 });
	const starting = service.actions.start();
	await new Promise<void>(resolve => { setTimeout(resolve, 0); });
	const preparedBeforeChange = encoderWidths.length;
	release(); await Promise.all([configuring, starting]);
	assert.equal(preparedBeforeChange, 0, 'an encoder must not freeze stale dimensions while browser constraints are pending');
	assert.deepEqual(encoderWidths, [1920]);
});
