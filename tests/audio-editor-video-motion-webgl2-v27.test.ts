/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoMotionWebGl2AcceleratorAdmissionV1,
	createVideoMotionWebGl2AcceleratorV1,
	tryCreateVideoMotionWebGl2AcceleratorV1,
	VIDEO_MOTION_WEBGL2_FALLBACK_REASONS_V1,
} from '../src/common/editor/video-motion-webgl2-v27.ts';

test('the optional WebGL2 provider reports unavailable canvases without claiming acceleration', () => {
	const canvas = {
		getContext(kind: string) {
			assert.equal(kind, 'webgl2');
			return null;
		},
	};
	assert.equal(tryCreateVideoMotionWebGl2AcceleratorV1(canvas), null);
	assert.deepEqual(createVideoMotionWebGl2AcceleratorAdmissionV1(canvas), {
		accelerator: null,
		fallbackReason: VIDEO_MOTION_WEBGL2_FALLBACK_REASONS_V1.contextUnavailable,
	});
	assert.deepEqual(createVideoMotionWebGl2AcceleratorAdmissionV1(null), {
		accelerator: null,
		fallbackReason: VIDEO_MOTION_WEBGL2_FALLBACK_REASONS_V1.canvasUnavailable,
	});
	assert.throws(() => createVideoMotionWebGl2AcceleratorV1({}), /WebGL2 context/iu);
});

test('WebGL2 admission records stable missing-extension diagnostics', () => {
	const context = {
		texImage3D() {}, drawArrays() {},
		getExtension() { return null; },
	};
	assert.deepEqual(createVideoMotionWebGl2AcceleratorAdmissionV1({
		getContext() { return context; },
	}), {
		accelerator: null,
		fallbackReason: VIDEO_MOTION_WEBGL2_FALLBACK_REASONS_V1.extensionsUnavailable,
	});
});

test('failed motion admission releases its owned browser context slot', () => {
	let releases = 0;
	const context = { texImage3D() {}, drawArrays() {}, getExtension(name: string) {
		return name === 'WEBGL_lose_context' ? { loseContext() { releases += 1; } } : null;
	} };
	assert.equal(createVideoMotionWebGl2AcceleratorAdmissionV1({ getContext: () => context }).accelerator, null);
	assert.equal(releases, 1);
});

test('successful motion admission releases only contexts it owns and only once', () => {
	let releases = 0;
	const gl = new Proxy({}, { get(_target, key) {
		if (key === 'getExtension') return (name: string) => name === 'WEBGL_lose_context'
			? { loseContext() { releases += 1; } } : {};
		if (key === 'getParameter') return () => 32;
		return () => ({});
	} });
	createVideoMotionWebGl2AcceleratorV1(gl).dispose();
	assert.equal(releases, 0, 'a caller-owned context remains available');
	const { accelerator } = createVideoMotionWebGl2AcceleratorAdmissionV1({ getContext: () => gl });
	assert.ok(accelerator);
	accelerator.dispose(); accelerator.dispose();
	assert.equal(releases, 1);
});
