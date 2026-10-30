/* SPDX-License-Identifier: AGPL-3.0-only */

interface Raster { readonly width: number; readonly height: number; readonly rgba: Uint8Array }
interface Settings { readonly keyColor: number; readonly similarity: number; readonly softness: number }

/** CPU counterpart of the normal preview/export Chroma Key matte, at native pixel scale. */
export function createChromaKeyMatte(frame: Raster, settings: Settings): Float32Array {
	const { width, height, rgba } = frame;
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
		|| width > 4096 || height > 4096 || !(rgba instanceof Uint8Array) || rgba.length !== width * height * 4) {
		throw new RangeError('Chroma Key requires an exact bounded native RGBA raster.');
	}
	if (!Number.isSafeInteger(settings.keyColor) || settings.keyColor < 0 || settings.keyColor > 0xffffff
		|| !Number.isFinite(settings.similarity) || settings.similarity < 0.01 || settings.similarity > 1
		|| !Number.isFinite(settings.softness) || settings.softness < 0 || settings.softness > 1) {
		throw new RangeError('Chroma Key controls exceed their supported ranges.');
	}
	const red = settings.keyColor >> 16; const green = settings.keyColor >> 8 & 255; const blue = settings.keyColor & 255;
	const keyU = Math.floor((-173 * red - 339 * green + 512 * blue + 511) / 1024) + 128;
	const keyV = Math.floor((512 * red - 429 * green - 83 * blue + 511) / 1024) + 128;
	const distances = new Float32Array(width * height);
	for (let pixel = 0; pixel < distances.length; pixel += 1) {
		const offset = pixel * 4; const r = rgba[offset]!; const g = rgba[offset + 1]!; const b = rgba[offset + 2]!;
		const u = Math.round(128 + (-37.797 * r - 74.203 * g + 112 * b) / 255);
		const v = Math.round(128 + (112 * r - 93.786 * g - 18.214 * b) / 255);
		distances[pixel] = Math.hypot(u - keyU, v - keyV) / (255 * Math.SQRT2);
	}
	const alpha = new Float32Array(width * height);
	for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
		const row = height - 1 - y; // The normal preview texture has a bottom-origin vertical axis.
		let distance = 0;
		for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
			let sx = x + dx; let sy = row + dy;
			if (sy >= height) continue;
			// Match the normal shader's FFmpeg boundary policy, including its retained row edge.
			if (sy < 0) { sx = dx < 0 ? Math.max(width - 2, 0) : width - 1; sy = 0; }
			else if (sx < 0) {
				if (row === height - 1) continue;
				sx = Math.max(width - 2, 0); sy = Math.max(0, Math.min(height - 1, row + 1 - dy));
			}
			distance += distances[(height - 1 - sy) * width + Math.min(sx, width - 1)]!;
		}
		distance /= 9;
		alpha[y * width + x] = settings.softness <= 0 ? Number(distance >= settings.similarity)
			: Math.max(0, Math.min(1, (distance - settings.similarity) / settings.softness));
	}
	return alpha;
}

/** Shared normal-keyer shader body; CPU hints follow the same matte and edge policy. */
export const VIDEO_CHROMA_KEY_SHADER_BODY = `
		vec3 key_rgb = packed_color(u_params0.x) * 255.0;
		vec2 key_chroma = vec2(
			floor((-173.0 * key_rgb.r - 339.0 * key_rgb.g + 512.0 * key_rgb.b + 511.0) / 1024.0) + 128.0,
			floor((512.0 * key_rgb.r - 429.0 * key_rgb.g - 83.0 * key_rgb.b + 511.0) / 1024.0) + 128.0
		) / 255.0;
		float similarity = max(0.00001, u_params0.y);
		float softness = u_params0.z;
		float distance_from_key = 0.0;
		// FFmpeg's chromakey neighborhood is expressed in export pixels. A
		// physical preview pixel may represent more or less than one of those.
		float sample_scale = max(u_params1.x, 0.0001);
		vec2 texel = vec2(sample_scale) / max(u_resolution, vec2(1.0));
		for (int sample_y = -1; sample_y <= 1; sample_y += 1) {
			for (int sample_x = -1; sample_x <= 1; sample_x += 1) {
				vec2 sample_uv = content_uv + vec2(float(sample_x), float(sample_y)) * texel;
				vec2 boundary_uv = sample_uv;
				bool missing_uses_key = sample_uv.y > 1.0;
				if (sample_uv.y < 0.0) {
					float stale_x = sample_x < 0
						? 1.0 - 1.5 * texel.x
						: 1.0 - 0.5 * texel.x;
					boundary_uv = vec2(max(stale_x, 0.5 * texel.x), 0.5 * texel.y);
				} else if (sample_uv.x < 0.0) {
					missing_uses_key = content_uv.y > 1.0 - texel.y;
					boundary_uv = vec2(
						max(1.0 - 1.5 * texel.x, 0.5 * texel.x),
						clamp(content_uv.y + (1.0 - float(sample_y)) * texel.y, 0.5 * texel.y, 1.0 - 0.5 * texel.y)
					);
				}
				vec2 sample_chroma = missing_uses_key
					? key_chroma
					: floor(rgb_to_limited_yuv(sample_content(boundary_uv).rgb).yz * 255.0 + 0.5) / 255.0;
				distance_from_key += distance(sample_chroma, key_chroma) / 1.41421356237;
			}
		}
		distance_from_key /= 9.0;
		float matte = softness <= 0.0
			? step(similarity, distance_from_key)
			: clamp((distance_from_key - similarity) / softness, 0.0, 1.0);
		vec3 encoded_yuv = floor(rgb_to_limited_yuv(color.rgb) * 255.0 + 0.5) / 255.0;
		color.rgb = limited_yuv_to_rgb(encoded_yuv);
		color.a *= matte;
`;
