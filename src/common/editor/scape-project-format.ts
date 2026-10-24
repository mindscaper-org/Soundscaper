/* SPDX-License-Identifier: AGPL-3.0-only */

import { isProjectFileName } from '../project-file-extensions.ts';

export const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';

// Explicit project/media/sidecar suffixes keep their existing routing authority.
const CONFLICTING_SUFFIX = /\.(?:aup|aup3|aup4|dawproject|sesx|aac|aif|aifc|aiff|au|auf|bw64|bwf|flac|m4a|m4v|mka|mp2|mp3|mp4|oga|ogg|opus|rf64|snd|wav|wave|wavpack|webm|wma|wv|cue|txt|srt|vtt|zip)$/iu;

/** A MIME-only file still goes through the native manifest and digest validator. */
export function isScapeProjectFile(file: Readonly<{ name?: unknown; type?: unknown }> | null | undefined): boolean {
	const name = typeof file?.name === 'string' ? file.name : '';
	if (isProjectFileName(name)) return true;
	const basename = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
	return basename.length > 0 && !CONFLICTING_SUFFIX.test(basename) && typeof file?.type === 'string'
		&& file.type.split(';', 1)[0]!.trim().toLowerCase() === SCAPE_MIME_TYPE;
}
