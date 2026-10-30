/* SPDX-License-Identifier: AGPL-3.0-only */
export const TRACK_HEIGHT_COPY_BY_LOCALE = { en: {
	trackHeight: 'Track height', fitToHeight: 'Fit to height', fitTracksToHeight: 'Fit tracks to height',
} } as const;

export function trackHeightCopy(copy: Readonly<Record<string, string>>) {
	return Object.fromEntries(Object.entries(TRACK_HEIGHT_COPY_BY_LOCALE.en).map(([key, fallback]) =>
		[key, copy[`ui.trackHeight.${key}`] ?? fallback])) as Record<keyof typeof TRACK_HEIGHT_COPY_BY_LOCALE.en, string>;
}
