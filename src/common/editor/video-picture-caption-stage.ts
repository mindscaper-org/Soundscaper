/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoBurnInStage } from './video-caption-burn-in.ts';

interface VideoPictureCaptionStage {
	readonly trackId: string;
	readonly stage: VideoBurnInStage;
}

// Keep the picture stage attached to the authenticated encoder plan without
// adding fields to the keyed or picture-only encoder schemas.
const stages = new WeakMap<object, VideoPictureCaptionStage>();

export function attachVideoPictureCaptionStage(plan: object, trackId: string, stage: VideoBurnInStage): void {
	stages.set(plan, Object.freeze({ trackId, stage }));
}

export function videoPictureCaptionStage(plan: object): VideoPictureCaptionStage | undefined {
	return stages.get(plan);
}
