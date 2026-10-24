/* SPDX-License-Identifier: AGPL-3.0-only */

import { isProjectFileName } from '../project-file-extensions.ts';

export const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';

/** A MIME-only file still goes through the native manifest and digest validator. */
export function isScapeProjectFile(file: Readonly<{ name?: unknown; type?: unknown }> | null | undefined): boolean {
	const name = typeof file?.name === 'string' ? file.name : '';
	if (isProjectFileName(name)) return true;
	const basename = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
	return basename.length > 0 && !basename.includes('.') && typeof file?.type === 'string'
		&& file.type.split(';', 1)[0]!.trim().toLowerCase() === SCAPE_MIME_TYPE;
}
