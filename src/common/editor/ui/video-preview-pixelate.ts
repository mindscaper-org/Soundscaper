/* SPDX-License-Identifier: AGPL-3.0-only */

interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
interface Target { readonly texture: WebGLTexture; readonly width: number; readonly height: number }
interface Pass { readonly code: number; readonly params0?: readonly number[]; readonly params1?: readonly number[] }
interface Compositor {
	readonly targets: { readonly ping: Target; readonly pong: Target };
	clearTarget(target: Target): void;
	draw(texture: WebGLTexture, target: Target, pass: Pass, opacity: number, viewport: null, contentViewport: Rect, sourceViewport: Rect, sourceTarget: Target): void;
}

/** Reduce each axis into block averages before expanding with nearest sampling.
 * Each reduction reads every input texel once; a large block does not multiply
 * the work by its area for every final display pixel.
 */
export function applyVideoPreviewPixelate(compositor: Compositor, source: Target, pass: Pass, content: Rect): Target {
	const blockSize = Math.max(1, Math.round(pass.params0?.[0] ?? 1));
	const columns = Math.ceil(content.width / blockSize), rows = Math.ceil(content.height / blockSize);
	const horizontal = { x: 0, y: 0, width: columns, height: content.height };
	const blocks = { x: 0, y: 0, width: columns, height: rows };
	const first = source === compositor.targets.ping ? compositor.targets.pong : compositor.targets.ping;
	const second = first === compositor.targets.ping ? compositor.targets.pong : compositor.targets.ping;
	compositor.clearTarget(first);
	compositor.draw(source.texture, first, { code: 2, params0: [blockSize, 0, 0, 0] }, 1, null, horizontal, content, source);
	compositor.clearTarget(second);
	compositor.draw(first.texture, second, { code: 18, params0: [blockSize, 0, 0, 0] }, 1, null, blocks, horizontal, first);
	compositor.clearTarget(first);
	compositor.draw(second.texture, first, { code: 19, params0: [blockSize, 0, 0, 0] }, 1, null, content, blocks, second);
	return first;
}

export const VIDEO_PREVIEW_PIXELATE_SHADER_BODY = `
		float block_size = max(1.0, u_params0.x);
		vec2 top_pixel = floor(vec2(content_uv.x, 1.0 - content_uv.y) * u_resolution);
		vec4 total = vec4(0.0);
		float count = 0.0;
		if (u_effect == 19) {
			vec2 block_pixel = floor(top_pixel / block_size);
			vec2 uv = (block_pixel + 0.5) / u_source_resolution;
			color = sample_content(vec2(uv.x, 1.0 - uv.y));
		} else {
			bool horizontal = u_effect == 2;
			float start = (horizontal ? top_pixel.x : top_pixel.y) * block_size;
			float extent = min(block_size, (horizontal ? u_source_resolution.x : u_source_resolution.y) - start);
			for (float offset = 0.0; offset < extent; offset += 1.0) {
				vec2 pixel = horizontal ? vec2(start + offset, top_pixel.y) : vec2(top_pixel.x, start + offset);
				vec2 uv = (pixel + 0.5) / u_source_resolution;
				total += sample_content(vec2(uv.x, 1.0 - uv.y));
				count += 1.0;
			}
			color = total / max(count, 1.0);
		}
`;
