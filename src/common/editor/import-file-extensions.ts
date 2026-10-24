/* SPDX-License-Identifier: AGPL-3.0-only */

/** Existing media/sidecar import identities shared by core admission and UI choosers. */
export const IMPORT_FILE_EXTENSIONS = Object.freeze([
	'.aac', '.ac3', '.aif', '.aifc', '.aiff', '.amr', '.au', '.bw64', '.bwf', '.dts', '.eac3', '.flac', '.iff',
	'.m4a', '.m4v', '.mka', '.mov', '.mp1', '.mp2', '.mp3', '.mp4', '.oga', '.ogg', '.opus', '.paf', '.rf64',
	'.sbc', '.sds', '.sf', '.snd', '.sph', '.spx', '.tta', '.voc', '.w64', '.wav', '.wave', '.wavpack', '.webm', '.wma', '.wv',
	'.cue', '.txt', '.srt', '.vtt',
] as const);

export const IMPORT_FILE_EXTENSION_LIST = IMPORT_FILE_EXTENSIONS.join(',');
const IMPORT_SUFFIXES: ReadonlySet<string> = new Set(IMPORT_FILE_EXTENSIONS);

/** A directory's suffix never supplies a file's format identity. */
export function isImportFileName(value: unknown): boolean {
	if (typeof value !== 'string') return false;
	const basename = value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1).toLowerCase();
	return IMPORT_SUFFIXES.has(basename.slice(basename.lastIndexOf('.')));
}
