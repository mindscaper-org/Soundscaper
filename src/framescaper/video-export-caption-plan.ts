/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProductVideoExportPlan } from '../common/editor/controller/export/product-video-export-strategy.ts';
import { attachVideoPictureCaptionStage } from '../common/editor/video-picture-caption-stage.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';
import { resolveFramescaperCaptionBurnInStage, snapshotFramescaperCaptionDeliveryRequest } from './video-caption-delivery.ts';

export function planFramescaperVideoExportCaptions(
	project: FramescaperProjectFinishing, plan: ProductVideoExportPlan, value: unknown,
): void {
	if (value == null) return;
	const request = snapshotFramescaperCaptionDeliveryRequest(value);
	if (!request.burnIn || request.mux || request.sidecar !== null) {
		throw new RangeError('Framescaper video export accepts caption burn-in. Export caption files through Caption Tracks.');
	}
	const track = project.videoCaptionTracks.find(({ id, sequenceId }) => (
		id === request.trackId && sequenceId === project.primarySequenceId
	));
	if (!track) throw new ReferenceError('The selected caption track is missing from the exported Framescaper sequence.');
	const canvas = plan.canvas as Readonly<{ width: number; height: number }>;
	const stage = resolveFramescaperCaptionBurnInStage(track, plan.range, canvas, Number(plan.sampleRate));
	attachVideoPictureCaptionStage(plan, track.id, stage);
}
