/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../ffmpeg-output-stream.ts';
import type {
	VideoKeyframeOfflineVideoExportRequest,
} from './video-keyframe-offline-video-export.ts';

export type { VideoKeyframeOfflineVideoExportRequest } from './video-keyframe-offline-video-export.ts';

/** Delivery planning stays synchronous; decoder, canvas and encoding code loads on encode. */
export async function encodeVideoKeyframeOfflineVideo(request: VideoKeyframeOfflineVideoExportRequest) {
	const runtime = await import('./video-keyframe-offline-video-export.ts');
	request.assertCurrent();
	return runtime.encodeVideoKeyframeOfflineVideo(request);
}

export async function encodeVideoKeyframeOfflineVideoToSink<Output>(
	request: VideoKeyframeOfflineVideoExportRequest,
	sink: FfmpegOutputSink<Output>,
) {
	const runtime = await import('./video-keyframe-offline-video-export.ts');
	request.assertCurrent();
	return runtime.encodeVideoKeyframeOfflineVideoToSink(request, sink);
}
