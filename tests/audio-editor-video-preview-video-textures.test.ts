/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	pruneVideoTextures,
	releaseVideoTexture,
	uploadVideoTexture,
} from '../src/common/editor/ui/video-preview-video-textures.js';
import { createVideoPreviewFrameIdentity, registerVideoPreviewDrawableRevision } from '../src/common/editor/controller/clip-video/video-preview-frame-identity.ts';

type FrameCallback = (now: number, metadata: { mediaTime: number; presentedFrames: number }) => void;

class Video extends EventTarget {
	videoWidth = 1_280;
	videoHeight = 720;
	currentTime = 0;
	paused = false;
	src = 'first.webm';
	currentSrc = 'first.webm';
	srcObject: object | null = null;
	readonly callbacks = new Map<number, FrameCallback>();
	readonly cancelled: number[] = [];
	#nextCallback = 0;
	requestVideoFrameCallback: ((callback: FrameCallback) => number) | undefined = (callback) => {
		const id = ++this.#nextCallback;
		this.callbacks.set(id, callback);
		return id;
	};
	cancelVideoFrameCallback = (id: number): void => {
		this.cancelled.push(id);
		this.callbacks.delete(id);
	};
	present(mediaTime: number, presentedFrames: number): void {
		const callbacks = [...this.callbacks.values()];
		this.callbacks.clear();
		for (const callback of callbacks) callback(0, { mediaTime, presentedFrames });
	}
}

function fixture(video = new Video()) {
	const counters = { images: 0, subImages: 0, deleted: 0, failed: false };
	const gl = {
		TEXTURE_2D: 0, TEXTURE_MIN_FILTER: 1, TEXTURE_MAG_FILTER: 2,
		LINEAR: 3, TEXTURE_WRAP_S: 4, TEXTURE_WRAP_T: 5, CLAMP_TO_EDGE: 6,
		UNPACK_FLIP_Y_WEBGL: 7, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 8,
		RGBA: 9, UNSIGNED_BYTE: 10,
		createTexture: () => ({}),
		bindTexture: () => undefined,
		texParameteri: () => undefined,
		pixelStorei: () => undefined,
		texImage2D: () => { counters.images += 1; },
		texSubImage2D: () => {
			if (counters.failed) throw new Error('Upload failed');
			counters.subImages += 1;
		},
		deleteTexture: () => { counters.deleted += 1; },
	};
	const textures = new Map();
	const upload = (generation = 1) => uploadVideoTexture(gl, textures, video, generation);
	return { video, gl, textures, counters, upload };
}

test('reuses the uploaded frame across display refreshes while the media clock advances', () => {
	const { video, counters, upload } = fixture();
	const texture = upload();
	for (let refresh = 1; refresh <= 120; refresh += 1) {
		video.currentTime = refresh / 60;
		if (refresh % 2 === 0 && refresh < 120) video.present(refresh / 60, refresh / 2);
		assert.equal(upload(refresh + 1), texture);
	}
	assert.equal(counters.images + counters.subImages, 60, 'one initial upload and 59 decoded frames');
});

test('uploads a paused first frame immediately and refreshes seeks before a frame callback', () => {
	const { video, counters, upload } = fixture();
	video.paused = true;
	upload();
	upload();
	assert.equal(counters.images + counters.subImages, 1);
	video.currentTime = 2;
	video.dispatchEvent(new Event('seeked'));
	upload();
	upload();
	assert.equal(counters.images + counters.subImages, 2);
	video.dispatchEvent(new Event('loadeddata'));
	upload();
	assert.equal(counters.images + counters.subImages, 3);
});

test('distinguishes repeated media timestamps by their presented frame count', () => {
	const { video, counters, upload } = fixture();
	upload();
	video.present(0, 1);
	upload();
	video.present(0, 1);
	upload();
	video.present(0, 2);
	upload();
	assert.equal(counters.images + counters.subImages, 3);
});

test('invalidates source URL, source object, and intrinsic dimensions', () => {
	const { video, counters, upload } = fixture();
	upload();
	video.src = 'second.webm';
	upload();
	video.currentSrc = 'second.webm';
	upload();
	video.srcObject = {};
	upload();
	video.videoWidth = 640;
	video.videoHeight = 360;
	upload();
	assert.equal(counters.images, 2);
	assert.equal(counters.subImages, 3);
});

test('fallback browsers reuse paused frames and conservatively refresh playing frames', () => {
	const { video, counters, upload } = fixture();
	video.requestVideoFrameCallback = undefined;
	video.paused = true;
	upload();
	upload();
	assert.equal(counters.images + counters.subImages, 1);
	video.currentTime = 1;
	upload();
	assert.equal(counters.images + counters.subImages, 2);
	video.paused = false;
	upload();
	upload();
	assert.equal(counters.images + counters.subImages, 4);
});

test('opaque exact-render drawable wrappers always upload their freshly presented pixels', () => {
	const { gl, textures, counters } = fixture();
	const exact = Object.freeze({ videoWidth: 640, videoHeight: 360, drawable: {} });
	uploadVideoTexture(gl, textures, exact, 1);
	uploadVideoTexture(gl, textures, exact, 2);
	assert.equal(counters.images + counters.subImages, 2);
});

test('rotated video uploads reuse one presentation canvas and release it after the last use', () => {
	const { video, gl, textures } = fixture();
	const uploads: unknown[] = [];
	const draws: unknown[] = [];
	let canvases = 0;
	const canvas = { width: 0, height: 0 };
	const context = { canvas, globalCompositeOperation: '', drawImage: (source: unknown) => { draws.push(source); } };
	const ownerDocument = { createElement: () => { canvases += 1; return { getContext: () => context }; } };
	const other = Object.assign(new Video(), { ownerDocument });
	Object.assign(video, { ownerDocument });
	gl.texImage2D = (...args: unknown[]) => { uploads.push(args.at(-1)); };
	gl.texSubImage2D = (...args: unknown[]) => { uploads.push(args.at(-1)); };

	uploadVideoTexture(gl, textures, video, 1);
	uploadVideoTexture(gl, textures, video, 1, false, true);
	uploadVideoTexture(gl, textures, video, 1, false, true);
	video.present(.04, 1);
	uploadVideoTexture(gl, textures, video, 2, false, true);
	uploadVideoTexture(gl, textures, other, 2, false, true);
	assert.deepEqual(uploads, [video, canvas, canvas, canvas]);
	assert.deepEqual(draws, [video, video, other]);
	assert.equal(canvases, 1);
	assert.equal(context.globalCompositeOperation, 'copy');
	assert.equal(canvas.width, video.videoWidth);
	releaseVideoTexture(gl, textures, video);
	assert.equal(canvas.width, other.videoWidth);
	releaseVideoTexture(gl, textures, other);
	assert.equal(canvas.width, 0);
});

test('an owned image drawable uploads only when its presented pixels change', () => {
	const { gl, textures, counters } = fixture();
	const image = Object.freeze({ videoWidth: 640, videoHeight: 360, drawable: {} });
	let revision = 1;
	registerVideoPreviewDrawableRevision(image, () => revision);
	uploadVideoTexture(gl, textures, image, 1);
	uploadVideoTexture(gl, textures, image, 2);
	assert.equal(counters.images + counters.subImages, 1);
	revision += 1;
	uploadVideoTexture(gl, textures, image, 3);
	uploadVideoTexture(gl, textures, image, 4);
	assert.equal(counters.images + counters.subImages, 2);
	pruneVideoTextures(gl, textures, 5);
	uploadVideoTexture(gl, textures, image, 6);
	assert.equal(counters.images + counters.subImages, 3, 'a new texture must receive pixels after eviction');
});

test('reused textures remain live in the current render generation and cleanup cancels callbacks', () => {
	const { video, gl, textures, counters, upload } = fixture();
	upload(1);
	upload(2);
	pruneVideoTextures(gl, textures, 2);
	assert.equal(textures.size, 1);
	pruneVideoTextures(gl, textures, 3);
	assert.equal(textures.size, 0);
	assert.equal(counters.deleted, 1);
	assert.equal(video.callbacks.size, 0);
	assert.equal(video.cancelled.length, 1);
	upload(4);
	releaseVideoTexture(gl, textures, video);
	releaseVideoTexture(gl, textures, video);
	assert.equal(counters.deleted, 2);
	assert.equal(video.callbacks.size, 0);
});

test('a failed upload is retried without losing its frame invalidation', () => {
	const { video, counters, upload } = fixture();
	upload();
	video.present(1, 1);
	counters.failed = true;
	assert.throws(upload, /Upload failed/u);
	counters.failed = false;
	upload();
	upload();
	assert.equal(counters.images + counters.subImages, 2);
});

test('a rejected frame callback implementation falls back to conservative uploads', () => {
	const { video, counters, upload } = fixture();
	video.requestVideoFrameCallback = () => { throw new Error('Callbacks unavailable'); };
	upload();
	upload();
	assert.equal(counters.images + counters.subImages, 2);
});

test('a late cancelled callback cannot keep a released element alive', () => {
	const { video, gl, textures, upload } = fixture();
	upload();
	const pending = [...video.callbacks.values()][0]!;
	releaseVideoTexture(gl, textures, video);
	pending(0, { mediaTime: 1, presentedFrames: 1 });
	video.dispatchEvent(new Event('seeked'));
	assert.equal(video.callbacks.size, 0);
	assert.equal(textures.size, 0);
});

test('effect-result eligibility excludes unknown drawables, disposed trackers, and playing fallbacks', () => {
	assert.equal(createVideoPreviewFrameIdentity({ drawable: {} }), null);
	const playing = new Video();
	const tracked = createVideoPreviewFrameIdentity(playing);
	assert.ok(tracked);
	assert.equal(tracked.canReuseFrame(), true);
	tracked.dispose();
	assert.equal(tracked.canReuseFrame(), false);
	const fallback = new Video();
	fallback.requestVideoFrameCallback = undefined;
	const conservative = createVideoPreviewFrameIdentity(fallback);
	assert.ok(conservative);
	assert.equal(conservative.canReuseFrame(), false);
	fallback.paused = true;
	assert.equal(conservative.canReuseFrame(), true);
	fallback.paused = false;
	assert.equal(conservative.canReuseFrame(), false);
	conservative.dispose();
});
