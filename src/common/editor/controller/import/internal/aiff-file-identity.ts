/* SPDX-License-Identifier: AGPL-3.0-only */
import { isImportFileName } from '../../../import-file-extensions.ts';
import { isProjectFileName } from '../../../../project-file-extensions.ts';

const CANONICAL_AIFF_MIME_TYPE = 'audio/aiff';

/**
 * MIME spellings a platform file picker may report for a classic AIFF file.
 * Chromium derives `File.type` from the shared-mime-info database on Linux,
 * which names `audio/x-aiff`, from the UTI on macOS, and leaves it empty when
 * Windows has no registry content type.
 */
const PLATFORM_AIFF_MIME_TYPES: ReadonlySet<string> = new Set([
	'', 'application/octet-stream', 'audio/aiff', 'audio/x-aiff', 'audio/aif', 'audio/x-aif', 'audio/aifc', 'audio/x-aifc',
]);
const LEGACY_PROJECT_SUFFIX = /\.(?:aup|aup3|aup4|dawproject|sesx)$/iu;

interface NamedAudioFile {
	readonly name?: unknown;
	readonly type?: unknown;
}

/** The canonical MIME type of one maintained AIFF file identity, or null. */
export function maintainedAiffMimeType(value: unknown): 'audio/aiff' | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const file = value as NamedAudioFile;
	if (typeof file.name !== 'string') return null;
	const namedAiff = /\.(?:aif|aiff|aifc)$/iu.test(file.name);
	if (file.type === undefined) return namedAiff ? CANONICAL_AIFF_MIME_TYPE : null;
	if (typeof file.type !== 'string') return null;
	const type = file.type.split(';', 1)[0]?.trim().toLowerCase() ?? '';
	if (!PLATFORM_AIFF_MIME_TYPES.has(type)) return null;
	// A declared AIFF MIME is sufficient when the name does not specify another format.
	return namedAiff || type.startsWith('audio/') && !isImportFileName(file.name)
		&& !isProjectFileName(file.name) && !LEGACY_PROJECT_SUFFIX.test(file.name) ? CANONICAL_AIFF_MIME_TYPE : null;
}
