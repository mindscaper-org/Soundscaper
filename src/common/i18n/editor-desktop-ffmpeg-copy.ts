/* SPDX-License-Identifier: AGPL-3.0-only */

export const DESKTOP_FFMPEG_COPY = Object.freeze({
	codecConfigure: 'Configure FFmpeg in {edit} > {preferences} > {general} to enable this desktop format.',
	codecSettings: 'The selected sample rate or channel layout is unsupported. Configure FFmpeg in {edit} > {preferences} > {general} or choose other export settings.',
	codecConfiguredUnsupported: 'The configured FFmpeg does not support this exact operation. Choose another FFmpeg build in {edit} > {preferences} > {general}.',
	codecCustomUnsupported: 'Custom FFmpeg arguments are unavailable in the desktop codec broker.',
	codecBitrate: 'The selected bitrate would be changed by this codec at the current sample rate and channel count.',
	codecVideoUnavailable: 'Desktop {formats} export is unavailable. Manage or rescan external FFmpeg in {edit} > {preferences} > {general}.',

	externalFfmpeg: 'External FFmpeg',
	externalFfmpegDescription: 'Used only when bundled and system media codecs cannot complete an operation.',
	externalFfmpegLocation: 'FFmpeg location',
	externalFfmpegNoLocation: 'No location selected',
	externalFfmpegVersion: 'Detected version',
	externalFfmpegUnconfigured: 'No external FFmpeg is configured.',
	externalFfmpegProbing: 'Checking external FFmpeg',
	externalFfmpegReady: 'FFmpeg {version} is ready.',
	externalFfmpegUnsupported: 'The selected FFmpeg version is unsupported.',
	externalFfmpegQuarantined: 'The selected FFmpeg installation must be reviewed again.',
	externalFfmpegUnavailable: 'External FFmpeg is unavailable.',
	externalFfmpegInstalling: 'Installing external FFmpeg',
	externalFfmpegError: 'External FFmpeg could not be configured.',
	externalFfmpegControlsUnavailable: 'External FFmpeg controls are unavailable in this desktop build.',
	externalFfmpegBrowse: 'Browse',
	externalFfmpegClear: 'Clear',
	externalFfmpegRescan: 'Rescan',
	externalFfmpegInstall: 'Install',
});
