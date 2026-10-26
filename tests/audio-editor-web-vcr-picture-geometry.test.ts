/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { webVcrContainedPicture } from '../src/common/editor/ui/workspace/web-vcr-picture-geometry.ts';
import { normalizeWebVcrPreviewPoint } from '../src/common/editor/ui/workspace/WebVcrPreview.tsx';

test('a narrow floating VCR targets its visible picture rather than its letterbox bars', () => {
	const picture = webVcrContainedPicture({ width: 258, height: 188 }, { width: 640, height: 360 });
	assert.deepEqual(picture, { left: 0, top: 21.4375, width: 258, height: 145.125 });
	const point = normalizeWebVcrPreviewPoint(picture, { x: 129, y: picture.top + picture.height * 0.1 });
	assert.equal(point.x, 0.5);
	assert.ok(Math.abs(point.y - 0.1) < 1e-12);
	assert.deepEqual(webVcrContainedPicture({ width: 640, height: 360 }, { width: 360, height: 640 }), { left: 218.75, top: 0, width: 202.5, height: 360 });
});
