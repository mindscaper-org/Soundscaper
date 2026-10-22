/* SPDX-License-Identifier: AGPL-3.0-only */

import { DESKTOP_AUDIO_CODEC_FORMATS, type DesktopAudioCodecFormat } from '../../../desktop/desktop-audio-codec-operation-contract.ts';
import type { DesktopAudioCodecCapabilityTuple } from '../../../desktop/desktop-audio-codec-capability-contract.ts';
import type { DesktopOriginalExportSettings } from './desktop-original-export-settings.ts';
import type { NormalizedMediaSettings } from './desktop-audio-codec-runtime.ts';
import { createMediaExportCapabilities, normalizeMediaExportSettings } from './media-export.js';
import { encodeDesktopAudioSettings } from './desktop-audio-encode-settings.ts';
import { queryDesktopAudioCodecCapability } from './desktop-audio-codec-capabilities.ts';
import { isDesktopMainAudioCodecRuntime } from './desktop-main-audio-codec-runtime-marker.ts';

const formats = new Set<string>(DESKTOP_AUDIO_CODEC_FORMATS);

/** Header compatibility alone cannot prove the desktop can encode the original tuple. */
export async function desktopOriginalAudioEncoderAvailable(
	runtime: unknown, settings: DesktopOriginalExportSettings, sources: readonly unknown[],
): Promise<boolean> {
	if (typeof settings.format !== 'string' || !formats.has(settings.format)) return true;
	if (!runtime || (typeof runtime !== 'object' && typeof runtime !== 'function')) return true;
	const query: unknown = Reflect.get(runtime, 'desktopAudioCodecCapabilities');
	if (typeof query !== 'function') return !isDesktopMainAudioCodecRuntime(runtime);
	const source = sources.find(candidate => candidate && typeof candidate === 'object'
		&& Reflect.get(candidate, 'kind') === 'audio');
	const channels: unknown = source && typeof source === 'object' ? Reflect.get(source, 'channelCount') : null;
	if (!Number.isSafeInteger(channels) || Number(channels) < 1) return false;
	const format = settings.format as DesktopAudioCodecFormat;
	const media = normalizeMediaExportSettings(format, { ...settings, inputChannelCount: Number(channels),
		capabilities: createMediaExportCapabilities() }) as NormalizedMediaSettings;
	const capability = await queryDesktopAudioCodecCapability(request => Reflect.apply(query, runtime, [request]) as unknown, {
		operation: 'audio-encode', format, sampleRate: media.sampleRate, channelCount: media.channelCount,
		settings: encodeDesktopAudioSettings(format, media) as DesktopAudioCodecCapabilityTuple['settings'],
	});
	return capability.available;
}
