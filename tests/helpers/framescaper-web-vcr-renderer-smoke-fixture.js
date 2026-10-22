/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

import { validateWebVcrSnapshotV1 } from '../../desktop/framescaper-web-vcr-contract.ts';

export function exactBridge(overrides = {}) {
	const unavailable = async () => { throw new Error('unused'); };
	return {
		dispatch: unavailable,
		dispose: unavailable,
		handshake: unavailable,
		open: unavailable,
		prepareCapture: unavailable,
		setCaptureState: unavailable,
		subscribe: () => () => undefined,
		...overrides,
	};
}

export function activeRendererFixture(plan) {
	let session = 1;
	let generation = 1;
	let resolution = '720p';
	let url = 'about:blank';
	let loading = false;
	let target = null;
	let authenticated = false;
	let loginClicks = 0;
	let typed = '';
	let listener = null;
	const tracks = [];
	const fixture = { tracks, captureRequests: [], disposed: false, unsubscribed: false };
	const dimensions = () => resolution === '720p'
		? { width: 1_280, height: 720 } : { width: 1_920, height: 1_080 };
	const snapshot = (phase = 'ready') => validateWebVcrSnapshotV1({
		version: 1,
		sessionId: String(session).padStart(32, '0'),
		generation,
		phase,
		capability: { status: 'available', resolutions: ['720p', '1080p'] },
		resolution,
		aspect: 'free',
		crop: { x: 0, y: 0, width: 1, height: 1 },
		captureSurface: dimensions(),
		navigation: { generation, url, canGoBack: false, canGoForward: false, isLoading: loading },
		target,
		autoCrop: true,
		monitorMuted: false,
		autoStop: false,
		visible: true,
		targetEndedRecordingToken: null,
		outputSize: null,
		metrics: null,
		failure: null,
	});
	const emit = (phase) => {
		const value = snapshot(phase);
		listener?.(value);
		return value;
	};
	const result = (phase) => ({ version: 1, kind: 'snapshot', snapshot: emit(phase) });
	const bridge = exactBridge({
		handshake: async () => ({
			version: 1,
			capability: { status: 'available', resolutions: ['720p', '1080p'] },
			captureGrantTtlMs: 10_000,
		}),
		open: async () => emit(),
		subscribe: (next) => {
			listener = next;
			return () => { fixture.unsubscribed = true; listener = null; };
		},
		dispatch: async (command) => {
			if (command.kind === 'request-data-clear') {
				return { ...reference(), kind: 'data-clear-confirmation', nonce: 'a'.repeat(32), expiresAtMs: Date.now() + 30_000 };
			}
			if (command.kind === 'clear-browser-data') {
				authenticated = false;
				session += 1;
				generation += 1;
				url = 'about:blank';
				target = null;
				return result();
			}
			if (command.kind === 'set-resolution') {
				resolution = command.resolution;
				session += 1;
				generation += 1;
				target = null;
				return result();
			}
			if (command.kind === 'navigate') {
				loading = true;
				const destination = new URL(command.url);
				if (destination.pathname === '/session/check') {
					destination.pathname = authenticated ? '/session/authenticated' : '/session/anonymous';
				}
				url = destination.href;
				typed = '';
				target = null;
				const pending = result();
				setTimeout(() => { loading = false; emit(); }, 0);
				return pending;
			}
			if (command.kind === 'key-input' && command.action === 'down') {
				if (command.key === 'Enter' && new URL(url).pathname === '/login') {
					authenticated = true;
					url = `${plan.origin}/session`;
				} else if (command.key.length === 1) typed += command.key;
				return result();
			}
			if (command.kind === 'pointer-input' && command.action === 'down') {
				if (loading) return result();
				const path = new URL(url).pathname;
				if (path === '/login') {
					loginClicks += 1;
					if (loginClicks === 3) {
						authenticated = true;
						url = `${plan.origin}/session`;
					}
				} else if (path === '/input') {
					url = `${plan.origin}/input/result?value=${typed}&pointer=64%2C160`;
				} else if (path === '/media/ended') {
					target = {
						targetId: 'c'.repeat(32), generation: 1,
						mediaState: 'playing',
						intrinsicSize: { width: 640, height: 360 },
						aperture: { x: 0, y: 0, width: 1, height: 1 },
					};
				} else if (path === '/media/loop') {
					setTimeout(() => {
						target = {
							targetId: 'c'.repeat(32), generation: 1,
							mediaState: 'playing',
							intrinsicSize: { width: 640, height: 360 },
							aperture: { x: 0, y: 0, width: 1, height: 1 },
						};
						emit();
					}, 0);
				}
				return result();
			}
			return result();
		},
		prepareCapture: async (request) => {
			const current = reference();
			assert.equal(request.version, current.version);
			assert.equal(request.sessionId, current.sessionId);
			assert.equal(request.generation, current.generation);
			return { ...reference(), grantId: 'b'.repeat(32), expiresAtMs: Date.now() + 10_000 };
		},
		setCaptureState: async (request) => {
			if (request.state === 'recording' && new URL(url).pathname === '/media/ended') {
				target = { ...target, mediaState: 'ended' };
			}
			emit(request.state);
			return true;
		},
		dispose: async () => { fixture.disposed = true; return true; },
	});
	const fakeTrack = (kind) => {
		const track = {
			kind,
			stopped: false,
			getSettings: () => kind === 'video' ? dimensions() : {},
			stop() { track.stopped = true; },
		};
		tracks.push(track);
		return track;
	};
	class FakeMediaStream {
		constructor(value) { this.value = value; }
		getTracks() { return this.value; }
		getVideoTracks() { return this.value.filter(({ kind }) => kind === 'video'); }
		getAudioTracks() { return this.value.filter(({ kind }) => kind === 'audio'); }
	}
	class FakeAudioContext {
		constructor() { this.destination = {}; }
		createMediaStreamSource() { return connection(); }
		createAnalyser() {
			return {
				...connection(),
				fftSize: 2_048,
				getFloatTimeDomainData: (samples) => samples.fill(0.01),
			};
		}
		createGain() { return { ...connection(), gain: { value: 1 } }; }
		async resume() {}
		async close() {}
	}
	fixture.scope = {
		framescaperWebVcr: { v1: bridge },
		crypto: { getRandomValues: (bytes) => { bytes.fill(session); return bytes; } },
		document: {
			permissionsPolicy: { allowsFeature: () => true },
			createElement(name) {
				if (name === 'video') return {
					readyState: 4, play: async () => undefined, pause: () => undefined,
					requestVideoFrameCallback: (callback) => callback(),
				};
				return { getContext: () => ({
					drawImage: () => undefined,
					getImageData: (x) => ({ data: x < 256 ? [23, 197, 89, 255] : [211, 43, 173, 255] }),
				}) };
			},
		},
		isSecureContext: true,
		navigator: {
			userActivation: { isActive: true },
			mediaDevices: { getDisplayMedia: async (request) => {
				fixture.captureRequests.push(structuredClone(request));
				return new FakeMediaStream([fakeTrack('video'), fakeTrack('audio')]);
			} },
		},
		MediaStream: FakeMediaStream,
		AudioContext: FakeAudioContext,
	};
	Object.defineProperty(fixture.scope, '__framescaperWebVcrSmokeStageV1', {
		configurable: true,
		set(value) {
			if (String(value).endsWith('-capture-user-gesture')) {
				void Promise.resolve().then(() => fixture.scope.__framescaperWebVcrSmokeCaptureGestureV1?.());
			}
		},
	});
	return fixture;

	function reference() {
		return { version: 1, sessionId: String(session).padStart(32, '0'), generation };
	}
}

function connection() {
	return { connect: () => undefined, disconnect: () => undefined };
}
