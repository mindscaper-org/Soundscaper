/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createSoundscaperNativeAudioRenderer } from '../src/common/editor/soundscaper-native-audio-renderer.ts';
import { createPlaybackPreviewEngines } from '../src/common/editor/controller/composition/internal/playback-preview-engines.ts';
import { createClipSourcePreviewService } from '../src/common/editor/controller/clip-video/internal/clip-source-preview-service.ts';
import { createProjectBinPreviewService } from '../src/common/editor/controller/import/internal/project-bin/project-bin-preview-service.ts';
import type { ProjectBinPreview } from '../src/common/editor/controller/import/project-bin-types.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { MockAudioContext } from './helpers/mock-audio-context.js';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import type { NormalizedPlayRange } from '../src/common/editor/engine/buffer-math.ts';
import { formatPresentationMessage, localizedErrorMessage } from '../src/common/i18n/presentation-message.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

for (const kind of ['source', 'bin'] as const) for (const duringWait of [false, true]) test(`${kind} audition settles a terminal native loss ${duringWait ? 'during readiness' : 'before Play'}`, async () => {
	const fixture = createFixture(kind);
	try {
		await fixture.prepare('first');
		if (!duringWait) fixture.attach('first');
		const result: { settled: boolean; error?: unknown } = { settled: false };
		const playing = duringWait ? fixture.play() : null;
		if (playing) void playing.then(() => { result.settled = true; }, error => { result.settled = true; result.error = error; });
		await setImmediate();
		fixture.lose(0, duringWait ? 'output-overrun' : 'device-loss');
		await setImmediate();
		if (!playing) void fixture.play().then(() => { result.settled = true; }, error => { result.settled = true; result.error = error; });
		await setImmediate();
		assert.equal(result.settled, true, 'known device failure must not leave Play waiting for a route that cannot arrive');
		assert.match(String(result.error), /output.*unavailable|output.*lost/iu);
		const message = localizedErrorMessage(result.error);
		assert.ok(message); assert.equal(message.key, 'audioHostDeviceLost');
		assert.equal(formatPresentationMessage({ audioHostDeviceLost: 'Dispositif audio déconnecté.' }, message), 'Dispositif audio déconnecté.');
		assert.notEqual(fixture.state(), 'playing');
		assert.equal(fixture.plays(), 0);
	} finally { await fixture.dispose(); }
});

for (const kind of ['source', 'bin'] as const) test(`${kind} waits for healthy native attachment and pauses on later loss`, async () => {
	const fixture = createFixture(kind);
	try {
		await fixture.prepare('first');
		const playing = fixture.play();
		await setImmediate();
		assert.equal(fixture.plays(), 0, 'initial route preparation remains a healthy wait');
		fixture.attach('first');
		await playing;
		assert.equal(fixture.state(), 'playing'); assert.equal(fixture.plays(), 1);
		fixture.lose(0, 'device-loss');
		await setImmediate();
		assert.notEqual(fixture.state(), 'playing');
	} finally { await fixture.dispose(); }
});

test('healthy native replacement and stale old loss preserve the current audition', async () => {
	const fixture = createFixture('source');
	try {
		await fixture.prepare('first'); fixture.attach('first'); await fixture.play();
		await fixture.prepare('second');
		await setImmediate();
		fixture.lose(0, 'device-loss');
		fixture.attach('second');
		await setImmediate();
		assert.equal(fixture.state(), 'playing'); assert.equal(fixture.plays(), 2);
	} finally { await fixture.dispose(); }
});

for (const kind of ['source', 'bin'] as const) test(`${kind} settles output loss before its host report finishes and can retry a prepared route`, async () => {
	let finishReport: (() => void) | undefined;
	const reporting = new Promise<void>(resolve => { finishReport = resolve; });
	const fixture = createFixture(kind, () => reporting);
	try {
		await fixture.prepare('first'); fixture.attach('first');
		fixture.lose(0, 'device-loss');
		const failed: { settled: boolean; error?: unknown } = { settled: false };
		void fixture.play().then(() => { failed.settled = true; }, error => { failed.settled = true; failed.error = error; });
		await setImmediate();
		assert.equal(failed.settled, true, 'host-report latency cannot keep a known failed route playing');
		assert.match(String(failed.error), /output.*unavailable|output.*lost/iu);
		await fixture.prepare('second');
		const retrying = fixture.play();
		await setImmediate(); assert.equal(fixture.plays(), 0);
		fixture.attach('second'); await retrying;
		assert.equal(fixture.state(), 'playing');
		assert.equal(fixture.plays(), 1);
		finishReport?.();
		await setImmediate();
		assert.equal(fixture.state(), 'playing', 'the old report completion cannot retire the replacement');
	} finally { finishReport?.(); await fixture.dispose(); }
});

function createFixture(kind: 'source' | 'bin', reportLoss?: () => Promise<void>) {
	const context = new MockAudioContext();
	const contextPort = context as unknown as EngineAudioContext;
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate('project');
	const project = { id: 'project', revision: 0, schemaVersion: 17, sampleRate: 48000,
		tempoMap: createAudioEditorProjectV17({ sampleRate: 48000 }).tempoMap,
		sources: [{ id: 'source', kind: 'audio' as const, sampleRate: 48000, channelCount: 1, frameCount: 4800 }],
		tracks: [{ id: 'track', type: 'audio' as const, clipIds: ['clip'] }],
		clips: [{ id: 'clip', kind: 'audio' as const, timelineStartFrame: 0, durationFrames: 4800,
			sourceId: 'source', sourceStartFrame: 0, sourceDurationFrames: 4800 }],
		projectBin: { clips: [{ id: 'bin', kind: 'audio' as const, binItemId: 'bin', timelineStartFrame: 0,
			durationFrames: 4800, sourceId: 'source', sourceStartFrame: 0, sourceDurationFrames: 4800 }] },
	};
	const windowValue = {} as Window;
	let receive: ((event: Event) => void) | undefined;
	const losses: Array<(value: Readonly<{ reason: string }>) => void> = [];
	const renderer = createSoundscaperNativeAudioRenderer({
		onDeviceLoss: reportLoss,
		engine: { getAudioContext: async () => context as unknown as AudioContext, getState: () => ({ state: 'stopped' }), pause() {}, async play() {} },
		windowValue: { window: windowValue,
			addEventListener: (_name: string, callback: EventListenerOrEventListenerObject) => { receive = callback as (event: Event) => void; },
			removeEventListener() {},
		} as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>,
		createNode: async (_context, options) => {
			assert.equal(options.queueCapacity, 8, 'native credit budget remains unchanged');
			losses.push(options.onClose);
			return { node: context.createGain() as unknown as AudioNode, attach: (_port, value) => value.generation,
				revoke: () => 1, notifyPeerLoss: () => 1, calibrate: async () => 0, dispose() {} };
		},
	});
	let plays = 0;
	const factory = ({ onState }: Readonly<{ onState(state: string): void }>) => {
		let state = 'stopped';
		return { getState: () => ({ state }), getAudioContext: async () => contextPort,
			loadProject() {}, setSourceResolver() {}, setPlaybackGain() {}, async setOutputDevice() {},
			async play() { plays++; state = 'playing'; onState(state); },
			pause() { if (state === 'playing') { state = 'paused'; onState(state); } },
			stop() { state = 'stopped'; onState(state); }, seek: (frame: number) => frame,
			setLoop() {}, setPlayRange: (range: NormalizedPlayRange | null) => range,
			subscribePosition: (_listener: (frame: number) => void) => () => undefined,
			async dispose() {},
		};
	};
	const engines = createPlaybackPreviewEngines(factory, () => 1, () => 'native:alsa:audio-output:speakers', {
		getAudioContext: async () => contextPort, createEngine: (_lease, options) => factory(options),
	});
	const source = createClipSourcePreviewService({ lifetime, getProject: () => project,
		captureProject: () => generation.capture(), assertProject: token => generation.assertCurrent(token), handleError() {},
		resources: { sourceBuffers: new Map(), sourceChunkProviders: new Map(), createEngine: options => engines.create(options),
			prepare: async () => undefined, retirePlayback() {}, subscribeTimelineState: () => () => undefined },
	});
	let binState: ProjectBinPreview | null = null;
	const bin = createProjectBinPreviewService({ lifetime, getProject: () => project,
		copy: { audioClipNotFound: 'Not found', localSourcesMissing: 'Missing' },
		captureProject: () => generation.capture(), assertProject: token => generation.assertCurrent(token),
		retireTimelinePlayback() {}, sourceBuffers: new Map(), sourceChunkProviders: new Map(),
		createPreviewEngine: options => engines.create(options), createId: prefix => prefix,
		getPreview: () => binState, setPreview(value) { binState = value; },
		isSourceMissing: () => false, getVisualData: () => null, publish() {},
	});
	return {
		async prepare(sessionId: string) { await renderer.prepare(sessionId, { candidates: [{ backend: 'alsa', deviceHandle: 'speakers' }],
			direction: 'output', mode: 'shared', sampleRate: 48000, periodFrames: 128, channelCount: 2 }); },
		attach(sessionId: string) { receive?.({ source: windowValue, data: { type: 'soundscaper-native-realtime-port-v1', offer: {
			sessionId, protocolVersion: 1, generation: 1, sampleFormat: 'f32-planar', sampleRate: 48000,
			channelCount: 2, frameCount: 128, queueCapacity: 8, startFrame: 0,
		} }, ports: [{ close() {} }] } as unknown as Event); },
		lose(index: number, reason: string) { losses[index]!({ reason }); },
		play: async () => { if (kind === 'source') await source.playPause('clip'); else await bin.playPauseProjectBinClip('bin'); },
		state: () => kind === 'source' ? source.snapshot().state : binState?.state,
		plays: () => plays,
		async dispose() { await source.dispose(); await bin.stopProjectBinPreview({ dispose: true }); await renderer.dispose(); lifetime.beginDisposal(); },
	};
}
