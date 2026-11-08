/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createFullRasterKeyingVideoDecoder } from '../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-decoder.ts';
import type { LocalAssistanceVideoKeyingRun } from '../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-publication.ts';
import { createDesktopSelectedRangeBlob, retireDesktopSelectedRangeBlob } from '../src/common/editor/desktop-selected-range-blob.ts';
import { DESKTOP_READ_PROFILE_SELECTED_RANGE } from '../src/common/editor/desktop-read-profile.ts';
import { FRAMESCAPER_PROJECT_SCHEMA_FAMILY, PROJECT_SCHEMA_VERSION } from '../src/common/editor/project-schema-identity.ts';

const PIXELS = [13, 27, 39, 255, 180, 210, 5, 255];
const HASH = 'a'.repeat(64);
const RUN: LocalAssistanceVideoKeyingRun = {
	projectId: 'project', clipId: 'clip', source: { contentSha256: HASH }, width: 2, height: 1,
	sourceFrameCount: 1, frameRate: { num: 4, den: 1 }, timescale: 4, sourceEndTick: 1n, presentationTick: BigInt,
	selectionFence: { projectId: 'project', schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
		schemaVersion: PROJECT_SCHEMA_VERSION, revision: 0, sequenceId: 'main', occurrenceIds: ['clip'],
		sourceId: 'source', sourceSha256: HASH, sourceStartFrame: 0, sourceEndFrame: 1,
		linkMembershipSha256: HASH, timingAuthoritySha256: HASH },
};
const OWNED_URL = 'blob:private-keying-video';

interface FixtureOptions {
	readonly onSource?: () => void;
	readonly releaseFailures?: readonly string[];
	readonly videoWidth?: number;
}

function fixture(context: TestContext, options: FixtureOptions = {}) {
	const events: string[] = [];
	const attributes = new Map<string, string>();
	const failures = new Set(options.releaseFailures);
	class Video extends EventTarget {
		readonly style: Record<string, string> = {};
		tabIndex = 0;
		preload = '';
		muted = false;
		playsInline = false;
		currentTime = 0;
		readonly videoWidth = options.videoWidth ?? 2;
		readonly videoHeight = 1;
		mounted = false;
		drawable = false;
		#src = '';
		get src(): string { return this.#src; }
		set src(value: string) {
			events.push('src'); this.#src = value;
			// Model the native surface contract: a detached decoder can report
			// loaded data while its canvas capture has no drawable pixels.
			this.drawable = this.mounted;
			if (options.onSource) options.onSource();
			else queueMicrotask(() => { this.dispatchEvent(new Event('loadeddata')); });
		}
		setAttribute(name: string, value: string): void { attributes.set(name, value); }
		pause(): void { this.release('pause'); }
		removeAttribute(name: string): void { attributes.delete(name); this.release('clear-src'); }
		load(): void { this.release('load'); }
		remove(): void { this.mounted = false; this.release('remove'); }
		private release(name: string): void {
			events.push(name);
			if (failures.has(name)) throw new Error(`Native ${name} failed`);
		}
	}
	const video = new Video();
	let raster = new Uint8ClampedArray(PIXELS.length);
	const canvas = {
		width: 0, height: 0,
		getContext: () => ({
			clearRect: () => { raster.fill(0); },
			drawImage: () => { if (video.drawable) raster = Uint8ClampedArray.from(PIXELS); },
			getImageData: () => ({ data: raster.slice() }),
		}),
	};
	const document = {
		createElement: (name: string) => {
			assert.ok(name === 'video' || name === 'canvas');
			return name === 'video' ? video : canvas;
		},
		body: { append: (element: unknown) => {
			assert.equal(element, video); video.mounted = true; events.push('mount');
		} },
	};
	const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
	Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
	context.after(() => {
		if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
		else Reflect.deleteProperty(globalThis, 'document');
	});
	context.mock.method(URL, 'createObjectURL', () => { events.push('create-url'); return OWNED_URL; });
	context.mock.method(URL, 'revokeObjectURL', (url: string) => { events.push(`revoke:${url}`); });
	return { events, video, canvas, attributes };
}

void test('keying browser decoder mounts a private drawable surface before loading and retains exact RGBA', async (context) => {
	const held = fixture(context);
	const signal = new AbortController().signal;
	const decoder = await createFullRasterKeyingVideoDecoder(new Blob(['video']), RUN, signal);
	try {
		assert.deepEqual(held.events, ['create-url', 'mount', 'src']);
		assert.equal(held.video.src, OWNED_URL);
		assert.deepEqual(held.video.style, { position: 'fixed', left: '0px', top: '0px',
			width: '1px', height: '1px', pointerEvents: 'none', opacity: '0' });
		assert.equal(held.attributes.get('aria-hidden'), 'true');
		assert.equal(held.video.tabIndex, -1);
		assert.deepEqual([...await decoder.capture(0, signal)], PIXELS);
	} finally { await decoder.dispose(); }
	await decoder.dispose();
	assert.equal(held.video.mounted, false);
	assert.deepEqual([held.canvas.width, held.canvas.height], [0, 0]);
	assert.deepEqual(held.events.slice(3), ['pause', 'clear-src', 'load', 'remove', `revoke:${OWNED_URL}`]);
	await assert.rejects(decoder.capture(0, signal), /decoder is closed/u);
});

void test('keying decoder removes its surface without revoking a selected-range capability URL', async (context) => {
	const held = fixture(context);
	const id = 'a'.repeat(64);
	const url = `framescaper-app://bundle/_desktop/read/${DESKTOP_READ_PROFILE_SELECTED_RANGE}/${id}/input.webm`;
	const body = createDesktopSelectedRangeBlob({ id, url, name: 'input.webm', size: 3,
		mimeType: 'video/webm', readProfile: DESKTOP_READ_PROFILE_SELECTED_RANGE, lastModified: 0 },
	{ fetch: async () => { throw new Error('Native selected video loading must not materialize bytes.'); } });
	context.after(() => { retireDesktopSelectedRangeBlob(body); });
	const decoder = await createFullRasterKeyingVideoDecoder(body, RUN, new AbortController().signal);
	assert.equal(held.video.src, url);
	await decoder.dispose();
	assert.deepEqual(held.events, ['mount', 'src', 'pause', 'clear-src', 'load', 'remove']);
	assert.equal(held.video.mounted, false);
	assert.deepEqual([held.canvas.width, held.canvas.height], [0, 0]);
});

void test('keying decoder joins independent cleanup after native teardown methods throw', async (context) => {
	const held = fixture(context, { releaseFailures: ['pause', 'clear-src', 'load'] });
	const decoder = await createFullRasterKeyingVideoDecoder(new Blob(['video']), RUN, new AbortController().signal);
	await decoder.dispose();
	await decoder.dispose();
	assert.equal(held.video.mounted, false);
	assert.deepEqual([held.canvas.width, held.canvas.height], [0, 0]);
	assert.deepEqual(held.events.slice(3), ['pause', 'clear-src', 'load', 'remove', `revoke:${OWNED_URL}`]);
});

void test('aborting keying video load preserves its reason and retires the mounted surface', async (context) => {
	const control = new AbortController(), reason = new Error('Cancel keying video load');
	const held = fixture(context, { onSource: () => { control.abort(reason); }, releaseFailures: ['pause'] });
	await assert.rejects(createFullRasterKeyingVideoDecoder(new Blob(['video']), RUN, control.signal),
		(error: unknown) => error === reason);
	assert.deepEqual(held.events, ['create-url', 'mount', 'src', 'pause', 'clear-src', 'load', 'remove', `revoke:${OWNED_URL}`]);
	assert.equal(held.video.mounted, false);
	assert.deepEqual([held.canvas.width, held.canvas.height], [0, 0]);
});

void test('keying geometry refusal retires its mounted decoder without publishing pixels', async (context) => {
	const held = fixture(context, { videoWidth: 3 });
	await assert.rejects(createFullRasterKeyingVideoDecoder(new Blob(['video']), RUN, new AbortController().signal),
		/changed source dimensions/u);
	assert.equal(held.video.mounted, false);
	assert.deepEqual([held.canvas.width, held.canvas.height], [0, 0]);
	assert.deepEqual(held.events.slice(3), ['pause', 'clear-src', 'load', 'remove', `revoke:${OWNED_URL}`]);
});
