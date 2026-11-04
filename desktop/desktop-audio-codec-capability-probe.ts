/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	DesktopAudioCodecCapabilityEntry, DesktopAudioCodecCapabilityReason, DesktopAudioCodecCapabilityTuple,
} from './desktop-audio-codec-capability-contract.ts';
import { normalizeDesktopAudioCodecRequest, type DesktopAudioCodecRequest } from './desktop-audio-codec-operation-contract.ts';
import { deriveDesktopAudioFfmpegCapabilityTuple, type DesktopAudioFfmpegCapabilitySets } from './desktop-audio-ffmpeg-plan.ts';

export function capabilityRequest(tuple: DesktopAudioCodecCapabilityTuple): DesktopAudioCodecRequest {
	const input = tuple.operation === 'audio-encode'
		? new Uint8Array(tuple.channelCount * Float32Array.BYTES_PER_ELEMENT)
		: Uint8Array.of(0);
	return normalizeDesktopAudioCodecRequest({
		...tuple, input,
		...(tuple.operation === 'audio-decode' ? { sampleRate: null, channelCount: null } : {}),
		settings: tuple.settings, maximumOutputBytes: 1_024,
	});
}

export function unavailableCapability(
	tuple: DesktopAudioCodecCapabilityTuple,
	reason: DesktopAudioCodecCapabilityReason,
	request?: DesktopAudioCodecRequest,
	capabilities?: DesktopAudioFfmpegCapabilitySets,
): DesktopAudioCodecCapabilityEntry {
	const missing: string[] = [];
	if (request && capabilities) {
		const required = deriveDesktopAudioFfmpegCapabilityTuple(request);
		for (const [kind, candidates, available] of [
			['encoder', required.encoderAnyOf, capabilities.encoders],
			['decoder', required.decoderAnyOf, capabilities.decoders],
			['muxer', required.muxerAnyOf, capabilities.muxers],
			['demuxer', required.demuxerAnyOf, capabilities.demuxers],
		] as const) {
			if (!candidates.some(name => available.includes(name))) missing.push(`${kind}:${candidates.join('_or_')}`);
		}
		for (const name of required.filterAllOf) {
			if (!capabilities.filters.includes(name)) missing.push(`filter:${name}`);
		}
	}
	return Object.freeze({ ...tuple, available: false, provider: null, reason,
		...(missing.length ? { missingCapabilities: Object.freeze(missing) } : {}),
	});
}
