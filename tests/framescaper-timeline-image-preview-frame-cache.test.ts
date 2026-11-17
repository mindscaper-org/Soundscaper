/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openFramescaperStoredImageFramePackTimelineImage } from '../src/framescaper/editor-selected-timeline-image-image-frame-source.ts';
import {
	createFramescaperImagePreviewFramesTimelineImage,
	createFramescaperImagePreviewPrefetchTimelineImage,
} from '../src/framescaper/editor-selected-timeline-image-image-preview-frames.ts';
import { admitFramescaperImageTimelinePreviewResourcesTimelineImage } from '../src/framescaper/editor-selected-timeline-image-image-preview-resources.ts';
import { assetStore, imageFixture } from './helpers/framescaper-timeline-image-preview-fixture.ts';

test('the preview retains two pictures per source and replaces older prefetch after a seek', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const fixture = imageFixture('animation', 2, 1, 8);
	const reader = await openFramescaperStoredImageFramePackTimelineImage(assetStore([fixture]), fixture.source);
	const decoded: number[] = [];
	const frames = createFramescaperImagePreviewFramesTimelineImage({ source: fixture.source, width: 2, height: 1 }, {
		...reader,
		readFrameSync(index, signal) {
			decoded.push(index);
			return reader.readFrameSync(index, signal);
		},
	});
	const prefetch = createFramescaperImagePreviewPrefetchTimelineImage();
	try {
		assert.deepEqual(decoded, []);
		const first = frames.read(0);
		assert.equal(first[0], 37);
		prefetch(frames.prefetch(1));
		assert.equal(frames.read(3)[0], 148);
		// At a lower sequence rate the next timeline picture can skip a packed picture.
		prefetch(frames.prefetch(5));
		assert.deepEqual(decoded, [0, 3]);
		context.mock.timers.tick(1);
		assert.equal(frames.read(5)[0], 222);
		assert.deepEqual(decoded, [0, 3, 5]);
		assert.ok(first.every(value => value === 0), 'evicted pixels are zeroed');
		assert.equal(frames.read(0)[0], 37);
		prefetch(frames.prefetch(1));
	} finally {
		prefetch();
		frames.dispose();
	}
	context.mock.timers.tick(1);
	assert.deepEqual(decoded, [0, 3, 5, 0], 'disposal retires the pending prefetch');
});

test('timeline preview budgets per-source cache slots and independently backed drawables', () => {
	const { source } = imageFixture('animation', 2, 1, 8);
	const context = { source, width: 1_920, height: 1_080 };
	const imageBytes = 1_920n * 1_080n * 4n;
	const result = admitFramescaperImageTimelinePreviewResourcesTimelineImage([context, context]);
	assert.equal(result.retainedFrameBytes, imageBytes * 2n);
	assert.equal(result.drawableBackingBytes, imageBytes * 2n);
	assert.equal(result.transientScaledFrameBytes, imageBytes);
	assert.throws(() => admitFramescaperImageTimelinePreviewResourcesTimelineImage([
		{ source, width: 8_192, height: 8_192 },
	]), /at most 33554432 pixels/u);
});
