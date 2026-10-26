/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopAudioCodecFormat } from '../../../desktop/desktop-audio-codec-operation-contract.ts';
import type { NormalizedMediaSettings } from './desktop-audio-codec-runtime.ts';
import { mp3CodecRateSettings, opusCodecRateSettings } from './media-export.js';

export function encodeDesktopAudioSettings(format: DesktopAudioCodecFormat, media: NormalizedMediaSettings,
): Readonly<Record<string, number>> {
	if (format === 'flac') {
		return Object.freeze({
			compressionLevel: requiredInteger(media.compressionLevel, 'flac compression level'),
			bitDepth: requiredInteger(media.bitDepth, 'flac bit depth'),
		});
	}
	if (format === 'wavpack') {
		return Object.freeze({ compressionLevel: requiredInteger(media.compressionLevel, `${format} compression level`) });
	}
	if (format === 'ogg-vorbis') {
		return Object.freeze({ quality: requiredInteger(media.quality, 'Vorbis quality') });
	}
	if (format === 'mp3') return mp3CodecRateSettings(media);
	if (format === 'opus') return opusCodecRateSettings(media);
	return Object.freeze({ bitrateKbps: requiredInteger(media.bitRate, `${format} bitrate`) });
}

function requiredInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value)) throw new TypeError(`Invalid ${label}.`);
	return Number(value);
}
