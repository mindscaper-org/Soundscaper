/* SPDX-License-Identifier: AGPL-3.0-only */

export const VIDEO_EXPORT_FORMATS = Object.freeze({
	mp4: Object.freeze({
		id: 'mp4',
		label: 'MP4',
		extension: 'mp4',
		mimeType: 'video/mp4',
		container: 'mp4',
		videoCodec: 'h264',
		videoEncoder: 'libx264',
		audioCodec: 'aac',
		audioEncoder: 'aac',
		// 3GPP timed text is what an MP4 carries captions as; a container with no
		// caption codec states null here and delivers a sidecar instead.
		subtitleCodec: 'mov_text',
		pixelFormat: 'yuv420p',
		requiredEncoders: Object.freeze(['libx264', 'aac']),
		requiredMuxers: Object.freeze(['mp4']),
	}),
	mov: Object.freeze({
		id: 'mov',
		label: 'MOV',
		desktopOnly: true,
		productIds: Object.freeze(['soundscaper']),
		extension: 'mov',
		mimeType: 'video/quicktime',
		container: 'mov',
		videoCodec: 'h264',
		videoEncoder: 'libx264',
		audioCodec: 'aac',
		audioEncoder: 'aac',
		subtitleCodec: 'mov_text',
		pixelFormat: 'yuv420p',
		requiredEncoders: Object.freeze(['libx264', 'aac']),
		requiredMuxers: Object.freeze(['mov']),
	}),
	webm: Object.freeze({
		id: 'webm',
		label: 'WebM',
		extension: 'webm',
		mimeType: 'video/webm',
		container: 'webm',
		videoCodec: 'vp9',
		videoEncoder: 'libvpx-vp9',
		audioCodec: 'opus',
		audioEncoder: 'libopus',
		subtitleCodec: 'webvtt',
		pixelFormat: 'yuv420p',
		requiredEncoders: Object.freeze(['libvpx-vp9', 'libopus']),
		requiredMuxers: Object.freeze(['webm']),
	}),
});

export function canonicalVideoExportFormat(format: unknown) {
	const value = String(format || 'mp4').trim().toLowerCase();
	if (value === 'h264' || value === 'mpeg4') return 'mp4';
	if (value === 'vp9') return 'webm';
	return value;
}

export function getVideoExportFormat(format: unknown = 'mp4') {
	const id = canonicalVideoExportFormat(format);
	const descriptor = Object.hasOwn(VIDEO_EXPORT_FORMATS, id) ? VIDEO_EXPORT_FORMATS[id as keyof typeof VIDEO_EXPORT_FORMATS] : undefined;
	if (!descriptor) throw new RangeError(`Unsupported video export format: ${format}.`);
	return descriptor;
}
