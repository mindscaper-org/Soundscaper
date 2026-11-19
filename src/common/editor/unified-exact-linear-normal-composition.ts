/* SPDX-License-Identifier: AGPL-3.0-only */

/** Mutate equal-sized native working planes after their owning compositor's admission. */
export function compositeNormalLinearPixels(target: Float64Array, source: Float64Array): void {
	for (let offset = 0; offset < target.length; offset += 4) {
		const targetAlpha = clamp(target[offset + 3]!);
		const sourceAlpha = clamp(source[offset + 3]!);
		const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
		for (let channel = 0; channel < 3; channel += 1) {
			const foreground = sourceAlpha > 1e-12 ? source[offset + channel]! / sourceAlpha : 0;
			target[offset + channel] = clamp(
				(1 - sourceAlpha) * target[offset + channel]!
				+ sourceAlpha * ((1 - targetAlpha) * foreground + targetAlpha * foreground),
			);
		}
		target[offset + 3] = outputAlpha;
	}
}

/** Encode a normal layer over a constant premultiplied backdrop in one pass. */
export function encodeNormalLinearPixelsOverBackground(
	target: Uint8Array,
	source: Float64Array,
	background: readonly [number, number, number, number],
	encode: (channel: number) => number,
): void {
	const [red, green, blue, backgroundAlpha] = background;
	const backdrop = [red * backgroundAlpha, green * backgroundAlpha, blue * backgroundAlpha];
	const uncovered = 1 - backgroundAlpha;
	for (let offset = 0; offset < target.length; offset += 4) {
		const sourceAlpha = clamp(source[offset + 3]!);
		const remainder = 1 - sourceAlpha;
		const alpha = clamp(sourceAlpha + backgroundAlpha * remainder);
		for (let channel = 0; channel < 3; channel += 1) {
			const foreground = sourceAlpha > 1e-12 ? source[offset + channel]! / sourceAlpha : 0;
			const composited = clamp(remainder * backdrop[channel]!
				+ sourceAlpha * (uncovered * foreground + backgroundAlpha * foreground));
			target[offset + channel] = encode(alpha > 1e-12 ? composited / alpha : 0);
		}
		target[offset + 3] = Math.round(alpha * 255);
	}
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
