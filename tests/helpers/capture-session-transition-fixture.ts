/* SPDX-License-Identifier: AGPL-3.0-only */
import { createFramescaperCaptureSessionService } from '../../src/common/editor/controller/capture/internal/framescaper-capture-session-service.ts';
import { createFramescaperCaptureOriginGuard } from '../../src/common/editor/controller/capture/framescaper-capture-origin-guard.ts';
import { createCaptureRuntimeAvailability } from '../../src/common/editor/framescaper-capture-domain.ts';

export function captureSessionTransitionFixture(options: Readonly<{ onChange?: () => void }> = {}) {
	const events: string[] = [];
	class CaptureTrack extends EventTarget {
		readyState = 'live';
		constructor(readonly role: string, readonly label = role) { super(); }
		end() { this.readyState = 'ended'; this.dispatchEvent(new Event('ended')); }
	}
	const tracks = new Map<string, CaptureTrack>();
	const origin = createFramescaperCaptureOriginGuard();
	let pauseStorageFailure: unknown = null;
	let pauseRecorderFailure: unknown = null;
	let recorderCreationFailure: unknown = null;
	let pauseStorageGate: Promise<void> | undefined;
	let sealGate: Promise<void> | undefined;
	let discardGate: Promise<void> | undefined;
	const errors = new Map<string, (error: unknown) => void>();
	let clock = 100;
	const service = createFramescaperCaptureSessionService({
		enabled: true, embedded: false, originGuard: origin,
		...(options.onChange ? { onChange: options.onChange } : {}),
		sourcePort: {
			async probe() { return createCaptureRuntimeAvailability({ status: 'available', sourceRoles: ['camera', 'microphone'] }); },
			async enumerate() { return { devices: [] }; },
			async openPreview(request) {
				return { sources: request.roles.map(role => {
					const track = new CaptureTrack(role); tracks.set(role, track);
					return { sourceId: `${role}-device`, role,
					stream: { role }, track, settings: role === 'microphone'
						? { sampleRate: 48000, channelCount: 1 } : { width: 1280, height: 720 }, capabilities: {} };
				}),
				async dispose() { events.push('lease:dispose'); } };
			},
		},
		durable: {
			async prepare(request) { events.push('prepare'); return request; },
			async append(session) { return session; },
			async recordPauseSpan(session) {
				events.push('pause:write'); await pauseStorageGate;
				if (pauseStorageFailure) throw pauseStorageFailure;
				events.push('pause:committed'); return session;
			},
			async seal(session) { events.push('seal'); await sealGate; events.push('seal:committed'); return session; },
			async discard() { events.push('discard'); await discardGate; }, async findRecovery() { return null; },
		},
		captureOrigin: () => ({ projectFence: { schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
			projectId: 'capture-project', baseRevision: 0, baseSha256: 'ab'.repeat(32) },
			origin: { sequenceId: 'main', playheadMicroseconds: 0, destination: 'both' as const } }),
		createRecorder: request => {
			const role = request.source.role;
			errors.set(role, request.onError);
			if (recorderCreationFailure && role === 'camera') request.onError(recorderCreationFailure);
			return { format: role === 'camera' ? { kind: 'encoded-media' as const, mimeType: 'video/webm' }
				: { kind: 'raw-pcm' as const, sampleRate: 48000, channelCount: 1, chunkFrames: 480 },
				start() { events.push(`start:${role}`); },
				pause() { events.push(`pause:${role}`); if (pauseRecorderFailure && role === 'camera') throw pauseRecorderFailure; return true; },
				resume() { events.push(`resume:${role}`); return true; },
				stop() { events.push(`stop:${role}`); }, dispose() { events.push(`dispose:${role}`); } };
		},
		finalize() { events.push('finalize'); }, createId: prefix => `${prefix}-id`, now: () => ++clock,
		waitCountdown: async () => undefined,
	});
	return { service, events, origin,
		endSource(role: string) { tracks.get(role)!.end(); },
		failPauseStorage(error: unknown) { pauseStorageFailure = error; },
		failPauseRecorder(error: unknown) { pauseRecorderFailure = error; },
		failRecorderCreation(error: unknown) { recorderCreationFailure = error; },
		gatePauseStorage(gate: Promise<void>) { pauseStorageGate = gate; },
		gateSeal(gate: Promise<void>) { sealGate = gate; },
		gateDiscard(gate: Promise<void>) { discardGate = gate; },
		failRecorder(role: string, error: unknown) { errors.get(role)!(error); },
		async start() {
			await service.initialize(); await service.actions.requestPreview(['camera', 'microphone']);
			service.actions.arm({ destination: 'both', countdownMs: 0 }); await service.actions.start();
		} };
}
