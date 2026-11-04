/* SPDX-License-Identifier: AGPL-3.0-only */

import { confirmFileSizeWarning, type FileSizeWarningOptions } from './controller/shared/file-size-warning.ts';
import type { EmbeddedExportChapter } from './export-embedded-chapters.ts';
import { LARGE_AUDIO_FILE_BYTES } from './large-audio-policy.ts';

interface ChapterSettings extends FileSizeWarningOptions {
	readonly embeddedChapters?: readonly EmbeddedExportChapter[];
	readonly metadata?: Readonly<Record<string, unknown>>;
	readonly maximumOutputBytes?: number;
}

/** Apply the shared chapter writers after native encoding, before publishing any bytes. */
export async function finalizeDesktopAudioBlob(blob: Blob, format: string, sampleRate: number,
	settings: ChapterSettings,
): Promise<Blob> {
	settings.signal?.throwIfAborted(); settings.assertCurrent?.();
	const output = settings.embeddedChapters?.length
		? await (await import('./audio-embedded-chapter-container.ts')).embedAudioChapters(
			blob, format, settings.embeddedChapters, sampleRate, settings.signal ?? undefined, settings.metadata,
		) : blob;
	await confirmFileSizeWarning(output.size, settings.maximumOutputBytes ?? LARGE_AUDIO_FILE_BYTES, 'Compressed audio export', settings);
	settings.signal?.throwIfAborted(); settings.assertCurrent?.();
	return output;
}
