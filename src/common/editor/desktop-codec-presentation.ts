/* SPDX-License-Identifier: AGPL-3.0-only */
import { DESKTOP_FFMPEG_COPY } from '../i18n/editor-desktop-ffmpeg-copy.ts';
import { formatPresentationMessage, type LocalizedPresentationMessage } from '../i18n/presentation-message.ts';
type CodecKey = Extract<keyof typeof DESKTOP_FFMPEG_COPY, `codec${string}`>;
export type DesktopCodecCopy = Readonly<Record<string, string | undefined>>;
export function desktopCodecMessage(key: CodecKey, copy: DesktopCodecCopy, extra: LocalizedPresentationMessage['parameters'] = {}): string {
	return formatPresentationMessage(copy, { key: `ui.desktopFfmpeg.${key}`, fallback: DESKTOP_FFMPEG_COPY[key], parameters: {
		edit: { key: 'editMenu', fallback: 'Edit' }, preferences: { key: 'preferences', fallback: 'Preferences' },
		general: { key: 'effectCardGeneral', fallback: 'General' }, ...extra,
	} });
}
