/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	boundVideoSourceTimingAuthority,
	videoSourceFrameTime,
	type BoundVideoSourceTimingView,
} from '../video-source-timing-view.ts';
import type { VideoKeyframeOfflineHtmlVideoSourceResolverOptions } from './video-keyframe-offline-html-video-source-resolver.ts';

/** Use a picture-only decoder view without replacing the digest-bound input or the audio mix. */
export function createOfflineFragmentPlayback(
	timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>,
): NonNullable<VideoKeyframeOfflineHtmlVideoSourceResolverOptions['prepareDecoderSource']> {
	const prepared = new Map<string, Blob | null>();
	let retainedBytes = 0;
	return async ({ sourceId, blob, identity }, signal) => {
		const previous = prepared.get(sourceId);
		if (previous !== undefined) return previous;
		const timing = timingBySourceId.get(sourceId);
		if (!timing || timing.kind !== 'vfr' || !/^video\/(?:mp4|quicktime|x-m4v)(?:;|$)/iu.test(blob.type)) return null;
		const authority = boundVideoSourceTimingAuthority(timing);
		if (authority.kind !== 'vfr' || authority.reference.sourceSha256 !== identity) return null;
		const { timescale, frameCount, finalFrameDurationTicks } = authority.reference;
		const { MAXIMUM_FRAGMENT_PLAYBACK_VIEW_BYTES, prepareFragmentPlaybackView } = await import(
			'../video-source-monitor-fragment-view.ts'
		);
		signal.throwIfAborted();
		const view = await prepareFragmentPlaybackView(blob, {
			timescale, frameCount, finalFrameDurationTicks: BigInt(finalFrameDurationTicks),
			presentationTick(ordinal) {
				const time = videoSourceFrameTime(timing, { numerator: BigInt(ordinal), denominator: 1n });
				const ticks = time.numerator * BigInt(timescale);
				return ticks % time.denominator === 0n ? ticks / time.denominator : undefined;
			},
		}, signal, {
			maximumBytes: MAXIMUM_FRAGMENT_PLAYBACK_VIEW_BYTES - retainedBytes,
			standardSampleEntry: true,
		}).catch(() => null);
		signal.throwIfAborted();
		prepared.set(sourceId, view);
		retainedBytes += view?.size ?? 0;
		return view;
	};
}
