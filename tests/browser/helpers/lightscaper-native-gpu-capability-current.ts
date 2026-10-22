/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, type Page, type TestInfo } from '@playwright/test';

/** Capability qualification is an actual native observation, never an engine
 * name. The pinned software target must provide it; ordinary hosts may lack it. */
export async function requireNativeGpuCapabilityCurrentV1(page: Page, info: TestInfo, level: 'webgl2' | 'float32' = 'float32') {
	const capability = await page.evaluate(level => {
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
		if (!gl) return { supported: false, reason: 'context-unavailable', renderer: null };
		const debug = gl.getExtension('WEBGL_debug_renderer_info');
		const renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
		let texture: WebGLTexture | null = null, framebuffer: WebGLFramebuffer | null = null;
		const expected = new Float32Array([-.25, 2, .125, .375]), actual = new Float32Array(4);
		try {
			if (level === 'webgl2') return { supported: true, reason: null, renderer };
			if (!gl.getExtension('EXT_color_buffer_float')) return { supported: false, reason: 'float-target-unavailable', renderer };
			texture = gl.createTexture(); framebuffer = gl.createFramebuffer();
			if (!texture || !framebuffer) throw new Error('Actual capability probe allocation failed.');
			gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
			if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return { supported: false, reason: 'float-target-unavailable', renderer };
			gl.clearBufferfv(gl.COLOR, 0, expected); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, actual);
			const supported = gl.getError() === gl.NO_ERROR && expected.every((value, at) => Object.is(value, actual[at]));
			return { supported, reason: supported ? null : 'float-readback-unavailable', renderer };
		} finally {
			if (texture && framebuffer && !gl.isContextLost()) { gl.clearBufferfv(gl.COLOR, 0, new Float32Array(4)); gl.finish(); }
			gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null);
			if (framebuffer) gl.deleteFramebuffer(framebuffer); if (texture) gl.deleteTexture(texture);
			expected.fill(0); actual.fill(0); gl.getExtension('WEBGL_lose_context')?.loseContext(); canvas.width = 0; canvas.height = 0;
		}
	}, level);
	info.annotations.push({ type: 'actual-native-gpu-capability', description: JSON.stringify({ level, ...capability }) });
	if (info.project.name === 'lightscaper-software-gpu') {
		expect(capability.supported, `Mandatory pinned native capability: ${capability.reason}`).toBe(true);
		expect(capability.renderer).toContain('SwiftShader');
	} else test.skip(!capability.supported, `Actual native ${level} proof unavailable: ${capability.reason}; CPU broker coverage runs separately.`);
	return capability;
}
