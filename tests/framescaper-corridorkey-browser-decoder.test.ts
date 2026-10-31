/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createFullRasterKeyingVideoDecoder, KeyingBrowserVideoDecodeError } from '../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-decoder.ts';
import type { LocalAssistanceVideoKeyingRun } from '../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-publication.ts';

const run = { width: 2, height: 2, frameRate: { num: 25, den: 1 } } as LocalAssistanceVideoKeyingRun;
const body = new Blob(['source'], { type: 'video/webm' });

for (const parent of ['body', 'documentElement'] as const) test(`browser keying mounts an invisible decode surface in ${parent} and disposes it once`, async context => {
	const f = fixture(context, { parent });
	const signal = new AbortController().signal;
	const decoder = await createFullRasterKeyingVideoDecoder(body, run, signal);
	assert.equal(f.video.loadedWhileMounted, true);
	assert.equal(f.video.attributes.get('aria-hidden'), 'true');
	assert.equal(f.video.tabIndex, -1);
	assert.deepEqual(f.video.style, { position: 'fixed', left: '0px', top: '0px',
		width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
	assert.deepEqual(await decoder.capture(0, signal), Uint8Array.from(f.pixels));
	await decoder.dispose(); await decoder.dispose();
	assert.equal(f.video.mounted, false);
	assert.equal(f.video.removals, 1);
	assert.equal(f.canvas.width, 0);
	assert.equal(f.canvas.height, 0);
	assert.equal(f.revoked.length, 1);
	await assert.rejects(decoder.capture(0, signal), /closed/u);
});

for (const failure of ['codec', 'geometry', 'abort'] as const) test(`browser keying removes its mounted surface after ${failure} failure`, async context => {
	const controller = new AbortController();
	const f = fixture(context, { codecError: failure === 'codec',
		onSource: failure === 'abort' ? () => controller.abort(new DOMException('Cancelled', 'AbortError')) : undefined });
	if (failure === 'geometry') f.video.videoWidth = 3;
	await assert.rejects(createFullRasterKeyingVideoDecoder(body, run, controller.signal),
		failure === 'codec' ? KeyingBrowserVideoDecodeError : failure === 'geometry' ? /dimensions/u : { name: 'AbortError' });
	assert.equal(f.video.mounted, false);
	assert.equal(f.video.removals, 1);
	assert.equal(f.canvas.width, 0);
	assert.equal(f.revoked.length, 1);
});

function fixture(context: TestContext, options: { parent?: 'body' | 'documentElement'; codecError?: boolean; onSource?: () => void } = {}) {
	class Video extends EventTarget {
		readonly style: Record<string, string> = {};
		readonly attributes = new Map<string, string>();
		videoWidth = 2; videoHeight = 2; tabIndex = 0; currentTime = 0;
		preload = ''; muted = false; playsInline = false;
		mounted = false; loadedWhileMounted = false; removals = 0;
		set src(_value: string) {
			this.loadedWhileMounted = this.mounted;
			options.onSource?.();
			queueMicrotask(() => { this.dispatchEvent(new Event(options.codecError ? 'error' : 'loadeddata')); });
		}
		setAttribute(name: string, value: string) { this.attributes.set(name, value); }
		removeAttribute(name: string) { this.attributes.delete(name); }
		pause() {}
		load() {}
		remove() { this.mounted = false; this.removals += 1; }
	}
	const video = new Video();
	const pixels = new Uint8ClampedArray(16).fill(255);
	const canvas = { width: 0, height: 0, getContext: () => ({
		clearRect() {}, drawImage() { assert.equal(video.mounted, true); }, getImageData: () => ({ data: pixels }),
	}) };
	const owner = { append(node: Video) { assert.equal(node, video); node.mounted = true; } };
	const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
	Object.defineProperty(globalThis, 'document', { configurable: true, value: {
		body: options.parent === 'documentElement' ? null : owner, documentElement: owner,
		createElement: (name: string) => name === 'video' ? video : canvas,
	} });
	context.after(() => {
		if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument);
		else Reflect.deleteProperty(globalThis, 'document');
	});
	const revoked: string[] = [];
	const revoke = URL.revokeObjectURL;
	context.mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url); revoke(url); });
	return { video, canvas, pixels, revoked };
}
