/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoColorGradeV1 } from './video-color-management-v27.ts';

/** Preserve ordered grade arithmetic while retaining only its final RGB array. */
export function applyVideoColorGradeChannels(linear: readonly number[], grade: VideoColorGradeV1): number[] {
	const exposure = 2 ** grade.exposureStops;
	const red = gradeChannel(linear[0]!, 0, exposure, grade);
	const green = gradeChannel(linear[1]!, 1, exposure, grade);
	const blue = gradeChannel(linear[2]!, 2, exposure, grade);
	const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
	return [luminance + (red - luminance) * grade.saturation,
		luminance + (green - luminance) * grade.saturation,
		luminance + (blue - luminance) * grade.saturation];
}
function gradeChannel(channel: number, index: number, exposure: number, grade: VideoColorGradeV1): number {
	const contrasted = (channel * exposure - grade.pivot) * grade.contrast + grade.pivot;
	const lifted = Math.max(0, contrasted + grade.lift[index]!);
	return Math.pow(lifted * grade.gain[index]!, 1 / grade.gamma[index]!);
}
