/* SPDX-License-Identifier: AGPL-3.0-only */

export interface WebVcrPictureSize { readonly width: number; readonly height: number }

/** Match the video element's object-fit: contain rectangle, excluding letterbox bars. */
export function webVcrContainedPicture(bounds: WebVcrPictureSize, picture: WebVcrPictureSize | null): Readonly<{
	left: number; top: number; width: number; height: number;
}> {
	const width = Math.max(1, bounds.width), height = Math.max(1, bounds.height);
	if (!picture || picture.width <= 0 || picture.height <= 0) return { left: 0, top: 0, width, height };
	const scale = Math.min(width / picture.width, height / picture.height);
	const renderedWidth = picture.width * scale, renderedHeight = picture.height * scale;
	return { left: (width - renderedWidth) / 2, top: (height - renderedHeight) / 2, width: renderedWidth, height: renderedHeight };
}
