/* SPDX-License-Identifier: AGPL-3.0-only */

import { assert, readRegularFile } from './verified-manifest-helpers.mjs';

export const FFMPEG_NOTICE_SECTION = 'Retained legacy FFmpeg WebAssembly publication and audit tooling';
export const FFMPEG_RUNTIME_EVIDENCE_PATHS = Object.freeze({
	correspondingSource: 'desktop/ffmpeg-corresponding-source.json',
	notices: 'THIRD_PARTY_LICENSES.md',
});

export async function readFfmpegRuntimeEvidence(root, descriptor, label) {
	const bytes = await readRegularFile(root, descriptor.path, label);
	if (descriptor.section === undefined) return bytes;

	const text = String(bytes);
	const headings = [...text.matchAll(/^## ([^\r\n]+)\r?$/gmu)];
	const matches = headings.filter((heading) => heading[1] === descriptor.section);
	assert(matches.length === 1, `${label} must contain exactly one ${descriptor.section} section`);
	const heading = matches[0];
	const next = headings[headings.indexOf(heading) + 1];
	// Exclude blank separators belonging to the following, unrelated notice.
	return Buffer.from(`${text.slice(heading.index, next?.index).trimEnd()}\n`);
}
