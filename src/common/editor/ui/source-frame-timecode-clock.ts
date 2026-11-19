/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimeCodeFormat } from '@soundscaper/design-system/TimeCode';
import { normalizeSourceFrameRate } from '../sequence-timecode.ts';
import { videoBoundaryTime, videoSourceTimingView } from '../video-source-timing-view.ts';
import { resolveVideoSourceTimingViews } from '../video-source-timing-views.ts';

export function isNativeSourceFrameFormat(format: TimeCodeFormat): boolean {
	return format === 'film-frames' || format === 'hh:mm:ss+frames';
}

export function sourceFrameTimeCodeClock(sourceValue: unknown) {
	if (!sourceValue || typeof sourceValue !== 'object' || Array.isArray(sourceValue)) {
		throw new TypeError('Source timecode fields require their native video source.');
	}
	const source = sourceValue as Readonly<Record<string, unknown>>;
	const rate = normalizeSourceFrameRate(source.frameRate);
	const frameCount = Number(source.sourceFrameCount);
	const timing = videoSourceTimingView(resolveVideoSourceTimingViews({ sources: [source] }), source);
	const secondsAt = (ordinal: number): number => {
		const boundary = videoBoundaryTime(timing, ordinal);
		return Number(boundary.numerator) / Number(boundary.denominator);
	};
	return Object.freeze({
		rate: rate.num / rate.den, secondsAt,
		frameAt(seconds: number): number {
			if (!Number.isFinite(seconds)) throw new RangeError('A source time must be finite.');
			if (seconds <= 0) return 0;
			if (seconds >= secondsAt(frameCount)) return frameCount;
			let lower = 0;
			let upper = frameCount;
			while (lower + 1 < upper) {
				const middle = lower + Math.floor((upper - lower) / 2);
				if (secondsAt(middle) <= seconds) lower = middle;
				else upper = middle;
			}
			return seconds - secondsAt(lower) < secondsAt(upper) - seconds ? lower : upper;
		},
	});
}
