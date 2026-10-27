/* SPDX-License-Identifier: MIT */

/** Keep labels at least 60 CSS pixels apart, including project-fit scales. */
export function measureLabelInterval(pixelsPerMeasure: number): number {
	return 2 ** Math.max(0, Math.ceil(Math.log2(60 / pixelsPerMeasure)));
}
