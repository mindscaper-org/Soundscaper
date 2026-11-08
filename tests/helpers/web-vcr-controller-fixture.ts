/* SPDX-License-Identifier: AGPL-3.0-only */

import { createFramescaperWebVcrController, type FramescaperWebVcrBridgeV1 } from '../../src/common/editor/controller/capture/internal/web-vcr/framescaper-web-vcr-controller.ts';
import { normalizeWebVcrSnapshot, type WebVcrCommandV1, type WebVcrSnapshot } from '../../src/common/editor/web-vcr-domain.ts';
import { createFramescaperCaptureStateMachine } from '../../src/common/editor/controller/capture/internal/framescaper-capture-state-machine.ts';
import { createCaptureRuntimeAvailability, type CapturePhase, type CaptureDestination, type CaptureSelectedSource } from '../../src/common/editor/framescaper-capture-domain.ts';
import type { FramescaperCaptureSessionSnapshot } from '../../src/common/editor/controller/capture/framescaper-capture-session-types.ts';
import type { FramescaperWebVcrCaptureController } from '../../src/common/editor/controller/capture/framescaper-web-vcr-controller-types.ts';

export function harness(options: Readonly<{
	enabled?: boolean; host?: Readonly<WebVcrSnapshot>; openGate?: Promise<void>;
	startGate?: Promise<void>; rejectHostState?: string;
	rejectHostStateOnce?: string; preparingGate?: Promise<void>;
		admissionGate?: Promise<void>;
		admissionFailure?: unknown;
	dispatchFailure?: string;
	rejectReopen?: boolean;
}> = {}) {
	const calls: string[] = [];
	const warnings: string[] = [];
	const commands: WebVcrCommandV1[] = [];
	const arms: unknown[] = [];
	const frozenCrops: unknown[] = [];
	const recordingTokens: string[] = [];
	const previewStream = Object.freeze({ kind: 'preview' });
	let listener: ((snapshot: Readonly<WebVcrSnapshot>) => void) | null = null;
	let currentHost = options.host ?? hostSnapshot();
	let rejectedHostStateOnce = false;
	const bridge: FramescaperWebVcrBridgeV1 = {
		async handshake() {
			calls.push('handshake');
			return { version: 1, capability: { status: 'available', resolutions: ['720p', '1080p', '4k'] }, captureGrantTtlMs: 10_000 };
		},
		async open({ resolution }) {
			const reopening = calls.includes(`open:${resolution}`);
			calls.push(`open:${resolution}`);
			await options.openGate;
			if (reopening && options.rejectReopen) throw new Error('reopen failed');
			if (currentHost.sessionId === null) currentHost = hostSnapshot({ sessionId: 'f'.repeat(32), generation: currentHost.generation + 1,
				navigation: { generation: 1, url: 'about:blank' } });
			return currentHost;
		},
		async dispatch(command) {
			calls.push(`dispatch:${command.kind}`);
			commands.push(command);
			if (command.kind === options.dispatchFailure) {
				if (command.kind === 'clear-browser-data') {
					currentHost = hostSnapshot({ sessionId: null, generation: currentHost.generation, phase: 'closed', visible: false, target: null });
					listener?.(currentHost);
				}
				throw new Error(`${command.kind} failed`);
			}
			if (command.kind === 'set-visibility') currentHost = hostSnapshot({ visible: command.visible });
			if (command.kind === 'set-resolution') currentHost = hostSnapshot({
				resolution: command.resolution,
				captureSurface: command.resolution === '720p'
					? { width: 1_280, height: 720 }
					: { width: 1_920, height: 1_080 },
				outputSize: command.resolution === '720p'
					? { width: 768, height: 360 }
					: { width: 1_152, height: 540 },
			});
			if (command.kind === 'set-crop') currentHost = hostSnapshot({
				autoCrop: false, crop: command.crop, aspect: command.aspect,
			});
			if (command.kind === 'request-data-clear') return {
				version: 1, kind: 'data-clear-confirmation', sessionId: ID, generation: 1,
				nonce: 'c'.repeat(32), expiresAtMs: 20_000,
			};
			if (command.kind === 'clear-browser-data') currentHost = hostSnapshot({
				sessionId: null, generation: 2, phase: 'closed', visible: false,
				target: null, navigation: { generation: 0, url: 'about:blank' },
			});
			return { version: 1, kind: 'snapshot', snapshot: currentHost };
		},
		async prepareCapture() { calls.push('grant'); return {
			version: 1, grantId: 'b'.repeat(32), sessionId: ID, generation: 1, expiresAtMs: 11_000,
		}; },
		async setCaptureState(request) {
			const captureState = request.state;
			calls.push(`host:${captureState}`);
			if (captureState === 'preparing') recordingTokens.push(request.recordingToken);
			if (captureState === 'preparing') await options.preparingGate;
			if (captureState === options.rejectHostState) throw new Error(`${captureState} rejected`);
			if (captureState === options.rejectHostStateOnce && !rejectedHostStateOnce) {
				rejectedHostStateOnce = true;
				throw new Error(`${captureState} rejected once`);
			}
			if (captureState === 'ready' && currentHost.visible === false) {
				currentHost = hostSnapshot({
					sessionId: null, generation: currentHost.generation, phase: 'closed', visible: false,
					target: null, navigation: { generation: 0, url: 'about:blank' },
				});
				listener?.(currentHost);
			}
			return true;
		},
		subscribe(value) { calls.push('subscribe'); listener = value; return () => { listener = null; }; },
		async dispose() { calls.push('dispose'); return true; },
	};
	const state: {
		phase: CapturePhase;
		sources: CaptureSelectedSource[];
		setupDefaults: { destination: CaptureDestination; countdownMs: number };
	} = {
		phase: 'inactive', sources: [], setupDefaults: { destination: 'timeline', countdownMs: 5_000 },
	};
	const empty = createFramescaperCaptureStateMachine({ availability: createCaptureRuntimeAvailability({
		status: 'available', sourceRoles: ['display', 'system-audio', 'microphone'],
	}) }).snapshot;
	const capture: FramescaperWebVcrCaptureController & { readonly state: typeof state } = {
		state,
		get snapshot(): FramescaperCaptureSessionSnapshot { return { ...empty, ...state, devices: [], selectedDeviceIds: {},
			displaySelectionMode: 'owned-source', displaySources: [], selectedDisplaySourceToken: null,
			monitoring: false, inputGain: 1, elapsedTimeMs: 0, metrics: [], sources: state.sources.map((source) => ({
			...source,
			...(source.role === 'display' ? { previewStream } : {}),
		})) }; },
		actions: {
			async release() { calls.push('release'); state.phase = 'inactive'; state.sources = []; },
			async requestPreview(roles) {
				calls.push(`preview:${roles.join(',')}`);
				state.phase = 'previewing';
				state.sources = [
					{ sourceId: 'guest-display', role: 'display' },
					{ sourceId: 'page-audio', role: 'system-audio' },
				];
			},
			arm(value: unknown) { calls.push('arm'); arms.push(value); state.phase = 'armed'; },
			async start() {
				calls.push('start');
				state.phase = 'countdown';
				await options.startGate;
				if (state.phase === 'countdown') state.phase = 'recording';
			},
			async stop() { calls.push('stop'); state.phase = 'inactive'; state.sources = []; },
			async sealForShutdown() { calls.push('seal'); state.phase = 'recovery'; },
			resetFailure() { calls.push('reset-failure'); state.phase = 'inactive'; },
		},
	};
	const controller = createFramescaperWebVcrController({
		enabled: options.enabled ?? true,
		bridge,
		getCapture: () => capture,
		adapter: {
			select(id) { if (id === 'devices' && state.phase !== 'inactive') throw new Error('capture is active'); calls.push(`select:${id}`); },
			freezeCrop(value) { frozenCrops.push(value); },
		},
		cropRuntimeAvailable: true,
		showPanel: () => { calls.push('show-panel'); },
		hidePanel: () => { calls.push('hide-panel'); },
		onWarning: (error) => { warnings.push(error instanceof Error ? error.message : String(error)); },
		startAdmission: {
			begin() {
				return {
					captured: {
						projectFence: {
							schemaFamily: 'framescaper', schemaVersion: 1,
							projectId: 'project-a', baseRevision: 4, baseSha256: 'ab'.repeat(32),
						},
						origin: { sequenceId: 'sequence-a', playheadMicroseconds: 500_000, destination: 'both' as const },
					},
					async prepare() {},
					release: () => true,
				};
			},
		},
		...((options.admissionGate || options.admissionFailure) ? {
			startAdmission: {
				begin() {
					calls.push('admission:begin');
					return {
						captured: {
							projectFence: {
								schemaFamily: 'framescaper', schemaVersion: 1,
								projectId: 'project-a', baseRevision: 4, baseSha256: 'ab'.repeat(32),
							},
							origin: { sequenceId: 'sequence-a', playheadMicroseconds: 500_000, destination: 'both' as const },
						},
						async prepare() {
							calls.push('admission:prepare');
							await options.admissionGate;
							if (options.admissionFailure) throw options.admissionFailure;
						},
						release() { calls.push('admission:release'); return true; },
					};
				},
			},
		} : {}),
	});
	return {
		controller, calls, capture, arms, frozenCrops, recordingTokens, previewStream, warnings, commands,
		publish(value: Readonly<WebVcrSnapshot>) { currentHost = value; listener?.(value); },
	};
}

const ID = 'a'.repeat(32);

export function hostSnapshot(overrides: Readonly<Record<string, unknown>> = {}): Readonly<WebVcrSnapshot> {
	const navigationOverride = overrides.navigation && typeof overrides.navigation === 'object' ? overrides.navigation : {};
	const targetOverride = overrides.target && typeof overrides.target === 'object' ? overrides.target : {};
	return normalizeWebVcrSnapshot({
		version: 1,
		sessionId: ID,
		generation: 1,
		phase: 'ready',
		capability: { status: 'available', resolutions: ['720p', '1080p'] },
		resolution: '1080p',
		aspect: 'free',
		crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 },
		autoCrop: true,
		monitorMuted: false,
		autoStop: false,
		visible: true,
		targetEndedRecordingToken: null,
		captureSurface: { width: 1920, height: 1080 },
		outputSize: { width: 1152, height: 540 },
		metrics: null,
		failure: null,
		...overrides,
		navigation: {
			generation: 1, url: 'https://example.test/', canGoBack: false, canGoForward: false,
			isLoading: false, ...navigationOverride,
		},
		target: overrides.target === null ? null : {
			targetId: 'd'.repeat(32), generation: 1, mediaState: 'playing', aperture: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 },
			intrinsicSize: { width: 1920, height: 1080 }, ...targetOverride,
		},
	});
}

export async function tick(): Promise<void> { await new Promise((resolve) => setTimeout(resolve, 0)); }

export function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve }; }
