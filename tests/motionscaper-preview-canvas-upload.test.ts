/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionPreviewCanvasUpload } from '../src/common/editor/controller/composition/motion-preview-canvas-upload.ts';

type Frame = Parameters<ReturnType<typeof createMotionPreviewCanvasUpload>['paint']>[2];

function fixture() {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'ImageData');
	const allocated: ImageData[] = [], paints: { image: ImageData; bytes: number[]; x: number; y: number }[] = [];
	class TestImageData implements ImageData {
		readonly colorSpace = 'srgb';
		readonly data: Uint8ClampedArray<ArrayBuffer>; readonly width: number; readonly height: number;
		constructor(data: Uint8ClampedArray<ArrayBuffer>, width: number, height: number) {
			this.data = data; this.width = width; this.height = height; allocated.push(this);
		}
	}
	Object.defineProperty(globalThis, 'ImageData', { configurable: true, writable: true, value: TestImageData });
	let width = 1, height = 1, widthWrites = 0, heightWrites = 0;
	const canvas = {
		get width() { return width; }, set width(value: number) { widthWrites++; width = value; },
		get height() { return height; }, set height(value: number) { heightWrites++; height = value; },
	};
	const context = { putImageData(image: ImageData, x: number, y: number) { paints.push({ image, bytes: Array.from(image.data), x, y }); } };
	const upload = createMotionPreviewCanvasUpload();
	return { canvas, context, upload, allocated, paints, writes: () => ({ width: widthWrites, height: heightWrites }),
		close() {
			upload.dispose();
			if (previous) Object.defineProperty(globalThis, 'ImageData', previous); else Reflect.deleteProperty(globalThis, 'ImageData');
		},
	};
}

test('consecutive same-size preview uploads retain geometry and private storage while painting distinct pixels', () => {
	const f = fixture();
	try {
		const backing = new Uint8ClampedArray([99, 255, 0, 0, 255, 0, 255, 0, 128, 99]);
		const first: Frame = { width: 2, height: 1, rgba: backing.subarray(1, 9) };
		const second: Frame = { width: 2, height: 1, rgba: new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 255, 255]) };
		const original = Array.from(backing), secondOriginal = Array.from(second.rgba);
		f.upload.paint(f.canvas, f.context, first);
		f.upload.paint(f.canvas, f.context, second);
		assert.deepEqual(f.paints.map(paint => paint.bytes), [original.slice(1, 9), secondOriginal]);
		assert.deepEqual(f.paints.map(({ x, y }) => [x, y]), [[0, 0], [0, 0]]);
		assert.equal(f.allocated.length, 1, 'One upload image suffices for consecutive same-size frames.');
		assert.deepEqual(f.writes(), { width: 1, height: 0 }, 'Only changed canvas dimensions may reset its backing store.');
		assert.equal(f.paints[0]!.image, f.paints[1]!.image);
		assert.notEqual(f.paints[1]!.image.data.buffer, first.rgba.buffer);
		assert.notEqual(f.paints[1]!.image.data.buffer, second.rgba.buffer);
		assert.deepEqual(Array.from(backing), original, 'Reusing upload storage must not overwrite an earlier frame or its backing array.');
		assert.deepEqual(Array.from(second.rgba), secondOriginal);
	} finally { f.close(); }
});

test('preview upload replaces storage for changed dimensions including equal-area geometry', () => {
	const f = fixture();
	try {
		for (const [width, height, byte] of [[2, 1, 12], [1, 2, 34], [3, 1, 56]] as const) {
			f.upload.paint(f.canvas, f.context, { width, height, rgba: new Uint8ClampedArray(width * height * 4).fill(byte) });
		}
		assert.deepEqual(f.allocated.map(image => [image.width, image.height, image.data.length]), [[2, 1, 8], [1, 2, 8], [3, 1, 12]]);
		assert.deepEqual(f.allocated.map(image => Array.from(image.data)), [Array(8).fill(12), Array(8).fill(34), Array(12).fill(56)]);
		assert.equal(new Set(f.allocated.map(image => image.data.buffer)).size, 3);
		assert.deepEqual(f.writes(), { width: 3, height: 2 });
		assert.equal(f.canvas.width, 3); assert.equal(f.canvas.height, 1);
	} finally { f.close(); }
});

test('invalid and late preview frames refuse before resetting the canvas or changing retained pixels', () => {
	const f = fixture();
	try {
		const frame: Frame = { width: 2, height: 1, rgba: new Uint8ClampedArray(8).fill(42) };
		f.upload.paint(f.canvas, f.context, frame);
		const writes = f.writes(), image = f.allocated[0]!, pixels = Array.from(image.data);
		const invalid: Frame[] = [
			{ ...frame, width: 0 }, { ...frame, height: -1 }, { ...frame, width: 1.5 },
			{ ...frame, height: Number.NaN }, { ...frame, width: Number.MAX_SAFE_INTEGER },
			{ ...frame, rgba: new Uint8ClampedArray(4) }, { ...frame, rgba: new Uint8ClampedArray(12) },
			{ ...frame, rgba: new Uint8Array(8) as unknown as Uint8ClampedArray },
		];
		for (const value of invalid) assert.throws(() => f.upload.paint(f.canvas, f.context, value), /frame|dimension|pixel/iu);
		assert.deepEqual(f.writes(), writes); assert.equal(f.allocated.length, 1); assert.equal(f.paints.length, 1);
		assert.deepEqual(Array.from(image.data), pixels);
		f.upload.dispose(); f.upload.dispose();
		assert.throws(() => f.upload.paint(f.canvas, f.context, frame), /disposed/iu);
		assert.deepEqual(f.writes(), writes); assert.equal(f.allocated.length, 1); assert.equal(f.paints.length, 1);
	} finally { f.close(); }
});
