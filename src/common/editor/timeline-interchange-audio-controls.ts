/* SPDX-License-Identifier: AGPL-3.0-only */

import { interchangeClipEnvelope } from './interchange-clip-envelope.ts';
import { multiplyRationals, roundRational } from './timeline-time.ts';
import { addDeliveryReportItem, type createDeliveryReport } from './delivery-report.ts';
import type { TimelineInterchangeClip, TimelineInterchangeTrack, TimelineInterchangeFormat } from './timeline-interchange-types.ts';

type Draft = ReturnType<typeof createDeliveryReport>;

export function interchangeTrackControls(track: TimelineInterchangeTrack, format: TimelineInterchangeFormat, draft: Draft) {
	return { mute: Boolean(track.mute), solo: Boolean(track.solo), pan: track.pan ?? 0, gain: boundedGain(track.gain ?? 1, 4, format, draft) };
}

export function interchangeClipControls(clip: TimelineInterchangeClip, sampleRate: number, duration: number,
	format: TimelineInterchangeFormat, draft: Draft, sourceSampleRate = sampleRate) {
	const fade = (value: TimelineInterchangeClip['fadeIn']) => {
		if (!value) return 0;
		const frames = multiplyRationals(value, sampleRate);
		return Math.min(duration, roundRational(frames.num, frames.den, 'point'));
	};
	const envelope = clip.envelope?.length ? interchangeClipEnvelope(clip.envelope.map(point => ({ frame: Math.round(point.frame * sampleRate / sourceSampleRate), value: point.value, interpolation: 'linear' as const })), duration) : undefined;
	return { ...(envelope ? { envelope: envelope.filter(point => point.frame <= duration) } : {}), gain: clip.muted ? 0 : boundedGain(clip.gain ?? 1, 16, format, draft), fadeInFrames: fade(clip.fadeIn), fadeOutFrames: fade(clip.fadeOut) };
}

function boundedGain(value: number, maximum: number, format: TimelineInterchangeFormat, draft: Draft): number {
	if (!Number.isFinite(value) || value < 0) throw new RangeError('Imported gain must be finite and non-negative.');
	if (value <= maximum) return value;
	addDeliveryReportItem(draft, { code: `${format}.gain-clamped`, disposition: 'converted', severity: 'warning',
		data: { authoredGain: value, importedGain: maximum }, message: 'Gain exceeds the editor range and is limited to its maximum.' });
	return maximum;
}
