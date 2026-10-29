/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ExternalFfmpegPreferenceService, ExternalFfmpegRuntimeAdmission } from './external-ffmpeg-preference-service.ts';
import type { DesktopAudioFfmpegCapabilitySets } from './desktop-audio-ffmpeg-plan.ts';

type AdmissionSnapshot = Readonly<ExternalFfmpegRuntimeAdmission>;
const SHA256 = /^[0-9a-f]{64}$/u;
const CAPABILITY_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;

export function snapshotDesktopAudioCodecAdmission(
	preferences: Pick<ExternalFfmpegPreferenceService, 'admission'>,
): AdmissionSnapshot | null {
	let value: ExternalFfmpegRuntimeAdmission | null;
	try { value = preferences.admission(); }
	catch { return null; }
	if (!value || typeof value !== 'object' || typeof value.executablePath !== 'string'
		|| typeof value.version !== 'string' || typeof value.capabilityGeneration !== 'string'
		|| !value.identity || !SHA256.test(value.identity.ffmpegSha256)
		|| typeof value.identity.ffprobePath !== 'string'
		|| !SHA256.test(value.identity.ffprobeSha256)
		|| !SHA256.test(value.identity.executablePairClosureSha256)) return null;
	const capabilities = cloneCapabilities(value.capabilities);
	if (capabilities === null) return null;
	return Object.freeze({
		executablePath: value.executablePath, version: value.version,
		capabilityGeneration: value.capabilityGeneration,
		identity: Object.freeze({ ...value.identity }), capabilities,
	});
}

function cloneCapabilities(value: unknown): DesktopAudioFfmpegCapabilitySets | null {
	if (!value || typeof value !== 'object') return null;
	const source = value as DesktopAudioFfmpegCapabilitySets;
	const result = {} as Record<keyof DesktopAudioFfmpegCapabilitySets, readonly string[]>;
	for (const kind of ['encoders', 'decoders', 'muxers', 'demuxers', 'filters'] as const) {
		if (!Array.isArray(source[kind]) || source[kind].length > 16_384
			|| source[kind].some((entry) => typeof entry !== 'string' || !CAPABILITY_TOKEN.test(entry))) return null;
		result[kind] = Object.freeze([...new Set(source[kind])]);
	}
	return Object.freeze(result);
}
