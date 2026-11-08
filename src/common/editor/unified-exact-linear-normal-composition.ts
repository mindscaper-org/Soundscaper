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

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
