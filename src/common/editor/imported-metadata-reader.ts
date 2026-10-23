/* SPDX-License-Identifier: AGPL-3.0-only */

import { riff64MetadataReadView } from './riff64-metadata-read-view.ts';

/** WavPack has an APEv2 trailer; the other import formats use Mediabunny. */
export async function readImportedMetadataTags(file: Blob, signal?: AbortSignal): Promise<unknown> {
	signal?.throwIfAborted();
	const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
	if (new TextDecoder().decode(header.subarray(0, 4)) === 'wvpk') {
		return (await import('./ape-metadata-reader.ts')).readApeMetadataTags(file, signal);
	}
	file = await riff64MetadataReadView(file, header, signal) ?? file;
	if (new TextDecoder().decode(header.subarray(0, 4)) === 'OggS') file = await (await import('./ogg-flac-metadata-read-view.ts')).oggFlacMetadataReadView(file, header, signal) ?? file;
	const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
	signal?.throwIfAborted();
	const input = new Input({
		source: new BlobSource(file, { maxCacheSize: 4 * 1024 * 1024, useStreamReader: false }),
		formats: ALL_FORMATS,
	});
	try {
		return await input.getMetadataTags();
	} finally {
		input.dispose();
	}
}
