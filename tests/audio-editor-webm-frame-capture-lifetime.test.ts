/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorVideoFrameExtractor } from '../src/common/editor/video-media.js';

test('native frame capture loads and mounts a noninteractive decoder before assigning its source', async () => {
	const fixture = decoderFixture();
	const extractor = await fixture.open();
	try {
		assert.equal(fixture.video.preload, 'auto');
		assert.deepEqual(fixture.events.slice(0, 2), ['mount', 'source']);
		assert.equal(fixture.video.isConnected, true);
		assert.equal(fixture.video.getAttribute('aria-hidden'), 'true');
		assert.equal(fixture.video.tabIndex, -1);
		assert.equal(fixture.video.style.position, 'fixed');
		assert.equal(fixture.video.style.width, '1px');
		assert.equal(fixture.video.style.height, '1px');
		assert.equal(fixture.video.style.opacity, '0');
		assert.equal(fixture.video.style.pointerEvents, 'none');
		assert.equal(extractor.metadata.durationSeconds, 1.25);
	} finally { extractor.dispose(); }
	assertReleased(fixture);
});

test('metadata failure removes the mounted decoder and every event listener', async () => {
	const fixture = decoderFixture({ metadata: 'error' });
	await assert.rejects(fixture.open(), /browser could not read this video/u);
	assertReleased(fixture);
});

test('a native load teardown failure preserves the metadata error and releases remaining resources', async () => {
	const fixture = decoderFixture({ metadata: 'error', throwLoad: true });
	await assert.rejects(fixture.open(), /browser could not read this video/u);
	assertReleased(fixture);
});

test('a native pause teardown failure cannot strand the decoder or its owned URL', async () => {
	const fixture = decoderFixture({ throwPause: true });
	const extractor = await fixture.open();
	extractor.dispose(); extractor.dispose();
	assertReleased(fixture);
	assert.equal(fixture.video.pauseCount, 1);
});

test('metadata cancellation removes the mounted decoder and revokes only its owned URL', async () => {
	const fixture = decoderFixture({ metadata: 'pending' });
	const controller = new AbortController();
	const opening = fixture.open({ signal: controller.signal });
	const rejected = assert.rejects(opening, { name: 'AbortError' });
	await fixture.sourceAssigned;
	controller.abort();
	await rejected;
	assertReleased(fixture);
});

test('metadata timeout releases the mounted decoder instead of leaving a hidden media resource', async () => {
	const fixture = decoderFixture({ metadata: 'pending' });
	await assert.rejects(fixture.open({ timeoutMs: 5 }), /browser could not read this video/u);
	assertReleased(fixture);
});

test('a synchronous source assignment failure retires metadata listeners and the mounted decoder', async () => {
	const fixture = decoderFixture({ throwSource: true });
	await assert.rejects(fixture.open(), /Native source assignment failed/u);
	assertReleased(fixture);
});

test('a synchronous seek assignment failure leaves no capture listeners or canvas work', async () => {
	const fixture = decoderFixture({ throwSeek: true });
	const extractor = await fixture.open();
	try {
		await assert.rejects(extractor.capture(.5), /Native seek assignment failed/u);
		assert.equal(fixture.video.listenerCount(), 0);
		assert.equal(fixture.canvasCount(), 0);
	} finally { extractor.dispose(); }
	assertReleased(fixture);
});

test('a stalled capture seek times out without retaining listeners or starting canvas work', async () => {
	const fixture = decoderFixture({ deferSeek: true });
	const extractor = await fixture.open();
	try {
		await assert.rejects(extractor.capture(.5, { timeoutMs: 5 }), /Timed out waiting for a presented video frame/u);
		assert.equal(fixture.video.listenerCount(), 0);
		assert.equal(fixture.canvasCount(), 0);
	} finally { extractor.dispose(); }
	assertReleased(fixture);
});

test('disposing during a stalled seek retires active and queued captures exactly once', async () => {
	const fixture = decoderFixture({ deferSeek: true });
	const extractor = await fixture.open();
	const active = extractor.capture(.5);
	const activeRejected = assert.rejects(active, { name: 'AbortError' });
	await fixture.seekStarted;
	const queued = extractor.capture(.7);
	const queuedRejected = assert.rejects(queued, { name: 'AbortError' });
	extractor.dispose(); extractor.dispose();
	await Promise.all([activeRejected, queuedRejected]);
	assert.equal(fixture.canvasCount(), 0);
	assertReleased(fixture);
	await assert.rejects(extractor.capture(0), /closed/u);
});

test('dispose removes the decoder while late encoding cannot publish or start queued work', async () => {
	const fixture = decoderFixture({ deferEncoding: true });
	const extractor = await fixture.open();
	const active = extractor.capture(0);
	const activeRejected = assert.rejects(active, { name: 'AbortError' });
	await fixture.waitForEncoding(1);
	const queued = extractor.capture(.5);
	const queuedRejected = assert.rejects(queued, { name: 'AbortError' });
	extractor.dispose(); extractor.dispose();
	await queuedRejected;
	assertReleased(fixture);
	assert.equal(fixture.canvasCount(), 1);
	fixture.finishEncoding();
	await activeRejected;
	assert.equal(fixture.canvasCount(), 1);
});

test('aborting a queued capture preserves the active decoder turn and allows a later healthy capture', async () => {
	const fixture = decoderFixture({ deferEncoding: true });
	const extractor = await fixture.open();
	try {
		const active = extractor.capture(0);
		await fixture.waitForEncoding(1);
		const controller = new AbortController();
		const cancelled = extractor.capture(.5, { signal: controller.signal });
		const rejected = assert.rejects(cancelled, { name: 'AbortError' });
		controller.abort(); await rejected;
		const healthy = extractor.capture(.7);
		await new Promise<void>(resolve => { setImmediate(resolve); });
		assert.equal(fixture.video.seeks.length, 1);
		assert.equal(fixture.canvasCount(), 1);
		fixture.finishEncoding(); await active;
		await fixture.waitForEncoding(2);
		assert.equal(fixture.video.seeks.at(-1), .7);
		fixture.finishEncoding();
		assert.equal((await healthy).timestampSeconds, .7);
		assert.equal(fixture.video.listenerCount(), 0);
	} finally { extractor.dispose(); }
	assertReleased(fixture);
});

interface FixtureOptions {
	readonly metadata?: 'success' | 'pending' | 'error';
	readonly deferSeek?: boolean;
	readonly deferEncoding?: boolean;
	readonly throwSource?: boolean;
	readonly throwSeek?: boolean;
	readonly throwLoad?: boolean;
	readonly throwPause?: boolean;
}

type Listener = EventListenerOrEventListenerObject;
class NativeVideoPort extends EventTarget {
	readonly style: Record<string, string> = {};
	readonly attributes = new Map<string, string>();
	readonly seeks: number[] = [];
	readonly listeners = new Map<string, Set<Listener>>();
	preload = ''; muted = false; playsInline = false; tabIndex = 0; isConnected = false;
	duration = 1.25; videoWidth = 192; videoHeight = 108;
	removeCount = 0; loadCount = 0; pauseCount = 0;
	private source = ''; private time = 0;
	readonly options: FixtureOptions; readonly events: string[];
	readonly onSource: () => void; readonly onSeek: () => void;
	constructor(options: FixtureOptions, events: string[], onSource: () => void, onSeek: () => void) {
		super(); this.options = options; this.events = events; this.onSource = onSource; this.onSeek = onSeek;
	}
	get src(): string { return this.source; }
	set src(value: string) {
		this.source = value; this.attributes.set('src', value); this.events.push('source'); this.onSource();
		if (this.options.throwSource) throw new Error('Native source assignment failed.');
		if (this.options.metadata !== 'pending') queueMicrotask(() => {
			this.dispatchEvent(new Event(this.options.metadata === 'error' ? 'error' : 'loadedmetadata'));
		});
	}
	get currentTime(): number { return this.time; }
	set currentTime(value: number) {
		if (this.options.throwSeek) throw new Error('Native seek assignment failed.');
		this.time = value; this.seeks.push(value); this.onSeek();
		if (!this.options.deferSeek) queueMicrotask(() => { this.dispatchEvent(new Event('seeked')); });
	}
	override addEventListener(type: string, listener: Listener | null, options?: boolean | AddEventListenerOptions): void {
		if (listener) { const set = this.listeners.get(type) ?? new Set<Listener>(); set.add(listener); this.listeners.set(type, set); }
		super.addEventListener(type, listener, options);
	}
	override removeEventListener(type: string, listener: Listener | null, options?: boolean | EventListenerOptions): void {
		if (listener) { const set = this.listeners.get(type); set?.delete(listener); if (!set?.size) this.listeners.delete(type); }
		super.removeEventListener(type, listener, options);
	}
	setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
	getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
	removeAttribute(name: string): void { this.attributes.delete(name); if (name === 'src') this.source = ''; }
	remove(): void { this.removeCount++; this.isConnected = false; }
	load(): void { this.loadCount++; if (this.options.throwLoad) throw new Error('Native load teardown failed.'); }
	pause(): void { this.pauseCount++; if (this.options.throwPause) throw new Error('Native pause teardown failed.'); }
	listenerCount(): number { return [...this.listeners.values()].reduce((total, set) => total + set.size, 0); }
}

function decoderFixture(options: FixtureOptions = {}) {
	const events: string[] = [], revoked: string[] = [];
	const source = deferred(), seek = deferred();
	const video = new NativeVideoPort(options, events, () => source.resolve(), () => seek.resolve());
	const encodes: (() => void)[] = [], waiters: { count: number; resolve(): void }[] = [];
	let canvases = 0, encodeCount = 0;
	const document = {
		body: { append(element: NativeVideoPort) { events.push('mount'); element.isConnected = true; } },
		createElement(name: string) {
			if (name === 'video') return video;
			assert.equal(name, 'canvas'); canvases++;
			return { width: 0, height: 0, getContext: () => ({ drawImage() {} }),
				toBlob(callback: BlobCallback, mimeType: string) {
					const complete = () => callback(new Blob(['pixels'], { type: mimeType }));
					encodeCount++;
					for (const waiter of waiters) if (encodeCount >= waiter.count) waiter.resolve();
					if (options.deferEncoding) encodes.push(complete); else complete();
				} };
		},
	};
	return { video, events, revoked, sourceAssigned: source.promise, seekStarted: seek.promise,
		canvasCount: () => canvases, finishEncoding: () => encodes.shift()?.(),
		waitForEncoding: (count: number) => encodeCount >= count ? Promise.resolve()
			: new Promise<void>(resolve => { waiters.push({ count, resolve }); }),
		open: (overrides: Readonly<{ signal?: AbortSignal; timeoutMs?: number }> = {}) => createAudioEditorVideoFrameExtractor(
			new Blob(['native MP4'], { type: 'video/mp4' }), {
				document, timeoutMs: 100, ...overrides,
				urlApi: { createObjectURL: () => 'blob:owned-video', revokeObjectURL: (url: string) => { revoked.push(url); } },
			}),
	};
}

function deferred(): Readonly<{ promise: Promise<void>; resolve(): void }> {
	let resolve = () => {};
	const promise = new Promise<void>(complete => { resolve = () => { complete(); }; });
	return { promise, resolve };
}

function assertReleased(fixture: ReturnType<typeof decoderFixture>): void {
	assert.equal(fixture.video.isConnected, false);
	assert.equal(fixture.video.removeCount, 1);
	assert.equal(fixture.video.getAttribute('src'), null);
	assert.equal(fixture.video.loadCount, 1);
	assert.equal(fixture.video.listenerCount(), 0);
	assert.deepEqual(fixture.revoked, ['blob:owned-video']);
}
