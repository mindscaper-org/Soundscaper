/* SPDX-License-Identifier: AGPL-3.0-only */

import { seekVideoPreviewMedia, type VideoPreviewMediaSeekSource } from '../../controller/clip-video/video-preview-media-seek.ts';

import {
	createRegisteredVideoRetimeWebCorePreviewResolver,
	type VideoRetimeWebCorePreviewResolver,
} from '../../video-retime-web-core-preview.ts';

export interface VideoPreviewRetimeResolution {
	readonly resolver: VideoRetimeWebCorePreviewResolver | null;
	readonly failed: boolean;
}

/** Activate exact preview only on the selected controller and when a curve is present. */
export function resolveRegisteredVideoRetimePreview(
	project: unknown,
	selectedWebCore: boolean,
): Readonly<VideoPreviewRetimeResolution> {
	const clips = record(project)?.clips;
	const hasRetime = Array.isArray(clips)
		&& clips.some((clip) => record(clip)?.kind === 'video' && record(clip)?.retimeMap != null);
	if (!selectedWebCore || !hasRetime) return Object.freeze({ resolver: null, failed: false });
	try {
		return Object.freeze({
			resolver: createRegisteredVideoRetimeWebCorePreviewResolver(project),
			failed: false,
		});
	} catch {
		return Object.freeze({ resolver: null, failed: true });
	}
}

/** Keep exact retime preview frame-addressed while preserving legacy continuous playback. */
export function synchronizeVideoPreviewMedia(
	video: VideoPreviewMediaSeekSource & Pick<HTMLVideoElement, 'playbackRate' | 'pause' | 'play'>,
	entry: Readonly<{
		readonly sourceTimeSeconds?: unknown;
		readonly playbackRate?: unknown;
		readonly exactPresentation?: unknown;
	}>,
	transportPlaybackRate: number,
	transportState: string,
): void {
	const targetTime = Math.max(0, Number(entry.sourceTimeSeconds) || 0);
	const exact = entry.exactPresentation === true;
	// Drift tolerance keeps continuous playback from seeking on every update.
	// A stopped transport owns an explicit picture, even a single frame away.
	const tolerance = exact || transportState !== 'playing' ? 0.000001 : 0.08;
	try {
		seekVideoPreviewMedia(video, targetTime, tolerance);
	} catch {
		// Metadata can still be loading; media readiness callbacks retry the seek.
	}
	if (exact) {
		video.pause();
		return;
	}
	video.playbackRate = Math.max(
		0.0625,
		Math.min(16, (Number(entry.playbackRate) || 1) * transportPlaybackRate),
	);
	if (transportState === 'playing') void video.play().catch(() => undefined);
	else video.pause();
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>> : null;
}
