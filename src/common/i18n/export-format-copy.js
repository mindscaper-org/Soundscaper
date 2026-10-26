/* SPDX-License-Identifier: AGPL-3.0-only */

/** Copy for the export dialog's format, sample and channel options, including its custom FFmpeg fields. */
export const EXPORT_FORMAT_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({
			format: 'Format',
			customFfmpeg: 'Custom FFmpeg',
			bitDepth: 'Bit depth',
			sampleFormat: 'Sample format',
			quality: 'Quality',
			sampleRate: 'Sample rate',
			channelMapping: 'Channel mapping',
			preserveChannels: 'Preserve channels',
			customChannelMapping: 'Custom channel mapping',
			customChannelMappingHint: 'JSON matrix, for example [[0.5, 0.5]] for stereo to mono.',
			mono: 'Mono',
			stereo: 'Stereo',
			dither: 'Dither',
			none: 'None',
			triangularDither: 'Triangular',
			highpassDither: 'Triangular high-pass',
			level: 'Level',
			customExtension: 'File extension',
			customMimeType: 'MIME type',
			customArguments: 'FFmpeg output arguments (one per line)',
			customMetadata: 'Additional metadata (JSON)',
			includeTails: 'Include effect tails up to 10 seconds',
			startExport: 'Export',
			cancelExport: 'Cancel export',
	}),
});
