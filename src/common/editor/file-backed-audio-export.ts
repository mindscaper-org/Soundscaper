/* SPDX-License-Identifier: AGPL-3.0-only */

const fileBackedExports = new WeakSet<Blob>();
const rangeBackedExports = new WeakSet<Blob>();

/** Preserve storage provenance without loading export admission during startup. */
export function registerFileBackedExport(blob: Blob): Blob {
	if (!(blob instanceof Blob)) throw new TypeError('A file-backed export must be a Blob.');
	fileBackedExports.add(blob);
	return blob;
}

export function isFileBackedAudioExport(blob: Blob): boolean {
	return fileBackedExports.has(blob);
}

/** Virtual native ranges must retain their read methods when container bytes are added. */
export function registerRangeBackedAudioExport(blob: Blob): Blob {
	registerFileBackedExport(blob);
	rangeBackedExports.add(blob);
	return blob;
}

export function isRangeBackedAudioExport(blob: Blob): boolean {
	return rangeBackedExports.has(blob);
}
