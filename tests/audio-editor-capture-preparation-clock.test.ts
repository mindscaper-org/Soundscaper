/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperCaptureSessionService } from '../src/common/editor/controller/capture/internal/framescaper-capture-session-service.ts';
import { createFramescaperCaptureOriginGuard } from '../src/common/editor/controller/capture/framescaper-capture-origin-guard.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperCaptureDurableSessionCoordinator } from '../src/common/editor/controller/capture/internal/framescaper-capture-durable-session.ts';
import { createFramescaperCaptureDurablePortBinding } from '../src/common/editor/controller/capture/internal/framescaper-capture-durable-port.ts';
import { createFramescaperCaptureAssetStreams } from '../src/common/editor/controller/capture/internal/framescaper-capture-stream-timing.ts';
import { planFramescaperCapturePublication } from '../src/common/editor/controller/capture/internal/framescaper-capture-publication-plan.ts';
import { videoFrameToSampleFrame } from '../src/common/editor/timeline-time.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createCaptureRuntimeAvailability } from '../src/common/editor/framescaper-capture-domain.ts';

test('capture initialization time does not become recorded duration or a leading timeline gap', async context => {
	let now = 100;
	let recorderOriginUs = -1;
	let publishedStartFrame = -1;
	let nextId = 0;
	const createId = (prefix: string) => `${prefix}-${nextId++}`;
	const store = createFramescaperProjectStore(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, { indexedDB: null, preferOpfs: false });
	context.after(async () => { await store.clear(); await store.close(); });
	const encodedSpools = store.encodedCaptureSpoolRepository;
	const rawPcmSpools = store.rawPcmSpoolRepository;
	const manifests = store.framescaperCaptureManifestRepository;
	assert.ok(encodedSpools && rawPcmSpools && manifests);
	const durable = createFramescaperCaptureDurablePortBinding({ createId,
		coordinator: createFramescaperCaptureDurableSessionCoordinator({ encodedSpools, rawPcmSpools, manifests }),
	});
	const service = createFramescaperCaptureSessionService<{ id: string }, object>({
		enabled: true, embedded: false, originGuard: createFramescaperCaptureOriginGuard(), now: () => now,
		sourcePort: {
			async probe() { return createCaptureRuntimeAvailability({ status: 'available', sourceRoles: ['camera'] }); },
			async enumerate() { return { devices: [] }; },
			async openPreview() { return { sources: [{ sourceId: 'camera', role: 'camera', stream: { id: 'stream' },
				track: {}, settings: {}, capabilities: {} }], async dispose() {} }; },
		},
		durable: { ...durable.port, async prepare(request) { now += 2000; return durable.port.prepare(request); } },
		captureOrigin: () => ({ projectFence: { schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: 'project', baseRevision: 0, baseSha256: 'ab'.repeat(32) },
			origin: { sequenceId: 'sequence', playheadMicroseconds: 0, destination: 'both' } }),
		createRecorder(request) { now += 1000; return {
			format: { kind: 'encoded-media', mimeType: 'video/webm' },
			async start(origin = 0) { recorderOriginUs = origin; await request.onPacket({
				kind: 'encoded-video', sessionId: request.sessionId, streamId: request.streamId, role: 'camera',
				sequence: 0, presentationTimeUs: origin, durationUs: 1_000_000, receiptTimeMs: now,
				droppedBefore: { value: null, confidence: 'unavailable' }, byteLength: 1, bytes: Uint8Array.of(1),
				mimeType: 'video/webm', keyFrame: true,
			}); }, pause() { return true; }, resume() { return true; }, stop() {}, dispose() {},
		}; }, finalize(request) {
			const manifest = durable.coordinatorSession(request.session).manifest;
			assert.equal(manifest.clock.monotonicOriginMicroseconds, 100_000);
			assert.deepEqual(manifest.clock.pauseSpans, [{ startMicroseconds: 0, endMicroseconds: 3_000_000 }]);
			const streams = createFramescaperCaptureAssetStreams(manifest, request.metrics, 48000);
			const plan = planFramescaperCapturePublication({ sessionId: manifest.sessionId,
				manifestSha256: 'cd'.repeat(32), recoveryProvenance: 'live', destination: 'timeline',
				recordStartFrame: 0, projectSampleRate: 48000, sequence: { id: 'sequence', rate: { num: 30, den: 1 } },
				trackInsertionIndex: 0, createId, streams: streams.map(stream => ({ ...stream,
					timelineDurationFrames: 48000, source: { ...createVideoSource({ id: 'video', sampleFrameCount: 48000,
						sourceFrameCount: 30, sampleRate: 48000, frameRate: { num: 30, den: 1 }, width: 640, height: 480 }) },
				})),
			});
			const command = plan.command.commands.find(value => value.type === 'clip/add');
			assert.ok(command?.type === 'clip/add');
			publishedStartFrame = videoFrameToSampleFrame(Number(command.clip.sequenceStartFrame), { num: 30, den: 1 }, 48000, 'point');
		}, waitCountdown: async () => undefined,
	});
	context.after(async () => { await service.dispose(); });
	await service.initialize(); await service.actions.requestPreview(['camera']);
	service.actions.arm({ destination: 'both', countdownMs: 0 }); await service.actions.start();
	assert.equal(service.snapshot.phase, 'recording');
	const elapsedTimeMs = service.snapshot.elapsedTimeMs;
	await service.actions.stop();
	assert.deepEqual({ elapsedTimeMs, publishedStartFrame, recorderOriginUs },
		{ elapsedTimeMs: 0, publishedStartFrame: 0, recorderOriginUs: 0 },
		'with a stopped timeline, initialization must not add captured duration or a leading timeline gap');
});
