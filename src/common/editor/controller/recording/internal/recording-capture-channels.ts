/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RecordingRoute } from '../recording-transaction-types.ts';

export function recordingCapturePeak(channels: readonly Float32Array[]): number {
	let peak = 0;
	for (const channel of channels) {
		for (const sample of channel) {
			const magnitude = Math.abs(sample);
			if (Number.isFinite(magnitude)) peak = Math.max(peak, magnitude);
		}
	}
	return peak;
}

export function recordingCapturePeakDb(channels: readonly Float32Array[]): number {
	const peak = recordingCapturePeak(channels);
	return peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
}

/** A shared physical-input gate listens only to channels assigned to surviving armed routes. */
export function routedRecordingDetectorChannels(routes: readonly RecordingRoute[], availableChannels: number): readonly number[] {
	const channels = new Set<number>();
	for (const route of routes) {
		for (let channel = route.channelStart; channel < Math.min(availableChannels, route.channelStart + route.channelCount); channel++) {
			channels.add(channel);
		}
	}
	return Object.freeze([...channels].sort((left, right) => left - right));
}

export function selectRoutedRecordingChannels(
	channels: readonly Float32Array[],
	route: RecordingRoute,
	kind: 'device' | 'display',
): readonly Float32Array[] {
	const frameCount = channels[0]?.length || 0;
	return Object.freeze(Array.from(
		{ length: route.channelCount },
		(_, channelIndex) => channels[route.channelStart + channelIndex]
			|| (kind === 'display' ? channels[0] : null)
			|| new Float32Array(frameCount),
	));
}
