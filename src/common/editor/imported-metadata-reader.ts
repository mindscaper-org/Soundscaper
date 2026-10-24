/* SPDX-License-Identifier: AGPL-3.0-only */

import { riffMetadataReadView } from './riff-metadata-read-view.ts';

/** WavPack and native Monkey audio use APEv2 trailers outside Mediabunny's formats. */
export async function readImportedMetadataTags(file: Blob, signal?: AbortSignal): Promise<unknown> {
	signal?.throwIfAborted();
	const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
	const signature = new TextDecoder().decode(header.subarray(0, 4));
	if (signature === 'wvpk' || signature === 'MAC ') {
		return (await import('./ape-metadata-reader.ts')).readApeMetadataTags(file, signal);
	}
	file = await riffMetadataReadView(file, header, signal) ?? file;
	if (new TextDecoder().decode(header.subarray(0, 4)) === 'OggS') file = await (await import('./ogg-flac-metadata-read-view.ts')).oggFlacMetadataReadView(file, header, signal) ?? file;
	const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
	signal?.throwIfAborted();
	const input = new Input({
		source: new BlobSource(file, { maxCacheSize: 4 * 1024 * 1024, useStreamReader: false }),
		formats: ALL_FORMATS,
	});
	const retire = (): void => input.dispose();
	signal?.addEventListener('abort', retire, { once: true });
	try {
		const tags = await input.getMetadataTags(); signal?.throwIfAborted(); return tags;
	} catch (error) {
		signal?.throwIfAborted(); throw error;
	} finally {
		signal?.removeEventListener('abort', retire);
		input.dispose();
	}
}
