/* SPDX-License-Identifier: AGPL-3.0-only */

import { ACCEPTED_PROJECT_FILE_EXTENSION_LIST, isProjectFileName } from '../../../project-file-extensions.ts';

// The workspace routes single files and dropped batches through the same
// classifier, so both reach it from this one module.
export { isProjectFileName };

export const WORKSPACE_PROJECT_FILE_ACCEPT = `${ACCEPTED_PROJECT_FILE_EXTENSION_LIST},.aup,.aup3,.aup4,.dawproject,application/vnd.soundscaper.scape+zip,application/x-audacity-project,application/vnd.audacity.aup4`;
export const WORKSPACE_IMPORT_FILE_ACCEPT = 'audio/*,video/mp4,video/webm,application/ogg,application/x-ogg,.aac,.aif,.aifc,.aiff,.bw64,.bwf,.flac,.m4a,.m4v,.mka,.mp2,.mp3,.mp4,.oga,.ogg,.opus,.rf64,.wav,.wave,.wavpack,.webm,.wma,.wv,.cue,.txt,.srt,.vtt,application/x-cue,text/plain,text/vtt,application/x-subrip';
export const WORKSPACE_OPEN_FILE_ACCEPT = `${WORKSPACE_PROJECT_FILE_ACCEPT},${WORKSPACE_IMPORT_FILE_ACCEPT}`;

const LEGACY_AUDACITY_PROJECT_PATTERN = /\.(?:aup|aup3|aup4|dawproject|sesx)$/iu;
const LABEL_PATTERN = /\.(?:srt|txt|vtt)$/iu;
const CUE_PATTERN = /\.cue$/iu;
const IMPORT_FILE_EXTENSIONS = new Set(WORKSPACE_IMPORT_FILE_ACCEPT.split(',').filter((token) => token.startsWith('.')));
const LABEL_MIME_TYPES = new Set(['text/plain', 'text/vtt', 'application/x-subrip']);

export function isWorkspaceImportFile(file) {
	const name = String(file?.name || '').toLowerCase();
	const type = String(file?.type || '').split(';', 1)[0].trim().toLowerCase();
	const extension = name.slice(name.lastIndexOf('.'));
	return IMPORT_FILE_EXTENSIONS.has(extension) || type.startsWith('audio/')
		|| type === 'application/ogg' || type === 'application/x-ogg'
		|| type === 'video/mp4' || type === 'video/webm'
		|| LABEL_MIME_TYPES.has(type) || type === 'application/x-cue';
}

export function partitionWorkspaceFiles(files) {
	const selectedFiles = [...(files || [])];
	const hasLegacyBlocks = selectedFiles.some((file) => /\.au[f]?$/iu.test(file?.name || ''));
	const projects = [];
	const media = [];
	const labels = [];
	const cues = [];
	for (const file of selectedFiles) {
		const name = file?.name || '';
		const type = String(file?.type || '').split(';', 1)[0].trim().toLowerCase();
		const mimeFallback = !IMPORT_FILE_EXTENSIONS.has(String(name).toLowerCase().slice(name.lastIndexOf('.')));
		if (hasLegacyBlocks && /\.aup$/iu.test(name)) media.push(file);
		else if (isProjectFileName(name) || LEGACY_AUDACITY_PROJECT_PATTERN.test(name)) projects.push(file);
		else if (LABEL_PATTERN.test(name) || (mimeFallback && LABEL_MIME_TYPES.has(type))) labels.push(file);
		else if (CUE_PATTERN.test(name) || (mimeFallback && type === 'application/x-cue')) cues.push(file);
		else media.push(file);
	}
	return { projects, media, labels, cues };
}
