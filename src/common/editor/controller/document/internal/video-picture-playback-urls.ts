/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoTimingIndex } from '../../../video-timing-asset.ts';
import type { ObjectUrlPort } from '../project-visual-types.ts';

/** Share bounded temporary Programme and Source Monitor pictures within one visual service. */
export function createVideoPicturePlaybackUrls(urls: ObjectUrlPort) {
	const retainedByUrl = new Map<string, number>();
	let reservedBytes = 0;
	return Object.freeze({ create, revoke });

	async function create(blob: Blob, timing: VideoTimingIndex, signal = new AbortController().signal): Promise<string | null> {
		if (!/^video\/(?:mp4|quicktime|x-m4v)(?:;|$)/iu.test(blob.type)) return null;
		let reservation = 0;
		try {
			const { MAXIMUM_FRAGMENT_PLAYBACK_VIEW_BYTES, prepareFragmentPlaybackView } = await import(
				'../../../video-source-monitor-fragment-view.ts'
			);
			signal.throwIfAborted();
			if (blob.size > MAXIMUM_FRAGMENT_PLAYBACK_VIEW_BYTES - reservedBytes) return null;
			reservation = blob.size;
			reservedBytes += reservation;
			const view = await prepareFragmentPlaybackView(blob, {
				...timing, presentationTick: ordinal => timing.presentationTicks[ordinal],
			}, signal, { maximumBytes: blob.size, standardSampleEntry: true, programmePicture: true });
			if (!view) return null;
			const url = urls.createObjectURL(view);
			if (url) {
				reservedBytes += view.size;
				retainedByUrl.set(url, view.size);
			}
			return url;
		} catch {
			signal.throwIfAborted();
			return null;
		} finally {
			reservedBytes -= reservation;
		}
	}

	function revoke(url: string): void {
		urls.revokeObjectURL(url);
		const retained = retainedByUrl.get(url);
		if (retained !== undefined) {
			reservedBytes -= retained;
			retainedByUrl.delete(url);
		}
	}
}
