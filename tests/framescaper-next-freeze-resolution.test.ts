/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bindFramescaperPreviewFreezeCapture } from '../src/common/editor/ui/workspace/video-preview-freeze-capture.ts';
import { framescaperSelectedFreezeCaptureFinishingFor } from '../src/framescaper/editor-selected-finishing-freeze-capture.ts';
import { captureVideoPreviewProgramFreezeFrame } from '../src/common/editor/ui/workspace/video-preview-freeze-program.ts';
import { uploadVideoTexture } from '../src/common/editor/ui/video-preview-video-textures.js';

test('the real freeze capture binding renders programme dimensions and restores preview quality', async () => {
	const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
	const priorImageData = Object.getOwnPropertyDescriptor(globalThis, 'ImageData');
	const owner = {};
	let width = 1; let height = 1;
	const rendered: Readonly<Record<string, unknown>>[] = [];
	const canvas = { width: 0, height: 0, getContext: () => ({ putImageData: () => undefined }),
		toBlob: (callback: (value: Blob) => void) => callback(new Blob(['encoded'], { type: 'image/png' })) };
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } });
	Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: class {
		constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
	} });
	const input = { owner, projectRef: { current: { id: 'project', revision: 4 } },
		evaluatedRef: { current: { projectId: 'project', projectRevision: 4, timelineSample: 0 } },
		compositorRef: { current: {
			render(_layers: readonly unknown[], options: Readonly<Record<string, unknown>>) {
				rendered.push(options); width = Number(options.outputWidth ?? 1); height = Number(options.outputHeight ?? 1);
				return { status: 'ready' };
			},
			captureEvaluatedRgba() { return { width, height, rgba: new Uint8Array(width * height * 4) }; },
		} }, layersRef: { current: [] }, renderOptionsRef: { current: { referenceWidth: 4, referenceHeight: 2, previewResolution: 'quarter' } } };
	const release = await bindFramescaperPreviewFreezeCapture(input);
	try {
		const capture = framescaperSelectedFreezeCaptureFinishingFor(owner); assert.ok(capture);
		const result = await capture.capture({ projectId: 'project', projectRevision: 4, timelineSample: 0,
			clipId: 'clip', sourceId: 'source', sourceOrdinal: 0 });
		assert.equal(result.width, 4); assert.equal(result.height, 2); assert.equal(result.blob.type, 'image/png');
		assert.equal(rendered.length, 2);
		assert.deepEqual(rendered[0], { referenceWidth: 4, referenceHeight: 2, previewResolution: 'quarter',
			outputWidth: 4, outputHeight: 2, reusePresentedMedia: true });
		assert.deepEqual(rendered[1], { referenceWidth: 4, referenceHeight: 2, previewResolution: 'quarter', reusePresentedMedia: true });
	} finally {
		release();
		if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument); else Reflect.deleteProperty(globalThis, 'document');
		if (priorImageData) Object.defineProperty(globalThis, 'ImageData', priorImageData); else Reflect.deleteProperty(globalThis, 'ImageData');
	}
});

test('a programme freeze reuses its presented video texture rather than uploading a later media frame', () => {
	const video = {};
	const texture = {};
	const record = { texture, generation: 1 };
	const textures = new Map([[video, record]]);
	const actual: unknown = uploadVideoTexture({}, textures, video, 2, true);
	assert.equal(actual, texture); assert.equal(record.generation, 2);
	assert.throws(() => uploadVideoTexture({}, new Map(), video, 3, true), /presented/u);
});

for (const failure of ['readback', 'fallback'] as const) test(`programme ${failure} failure still restores the viewing targets`, () => {
	const rendered: Readonly<Record<string, unknown>>[] = [];
	const compositor = {
		render(_layers: readonly unknown[], options: Readonly<Record<string, unknown>>) {
			rendered.push(options); return { status: failure === 'fallback' && options.outputWidth ? 'fallback' : 'ready' };
		},
		captureEvaluatedRgba(): never { throw new Error('readback unavailable'); },
	};
	assert.throws(() => captureVideoPreviewProgramFreezeFrame({ compositor, layers: [],
		options: { referenceWidth: 8, referenceHeight: 4, previewResolution: 'half' } }), /readback|every presented layer/u);
	assert.equal(rendered.length, 2);
	assert.deepEqual(rendered[1], { referenceWidth: 8, referenceHeight: 4, previewResolution: 'half', reusePresentedMedia: true });
});

test('programme freeze preserves the existing compositor axis ceiling before allocating targets', () => {
	let renders = 0;
	const compositor = { render() { renders += 1; return { status: 'ready' }; }, captureEvaluatedRgba() { return null; } };
	assert.throws(() => captureVideoPreviewProgramFreezeFrame({ compositor, layers: [],
		options: { referenceWidth: 4_097, referenceHeight: 1 } }), /1 through 4096/u);
	assert.equal(renders, 0);
});
