/* SPDX-License-Identifier: AGPL-3.0-only */

import { createImportedAudioContentIdentityWriter, rollbackImportedAudioContentIdentityWriter } from '../imported-audio-content-identity.ts';
import type { ProjectImportRuntime } from './project-import-runtime.ts';
import type { AudioBufferLike } from '../../source/source-audio.ts';

/** The canonical PCM must be durable before its editable source is published. */
export async function persistDecodedAudioImport(
	runtime: Pick<ProjectImportRuntime, 'SOURCE_CHUNK_FRAMES' | 'store' | 'writeBuffer'>,
	sourceId: string,
	metadata: Readonly<{ name: string; mimeType: string }>,
	buffer: AudioBufferLike,
	assertCurrent: () => void,
) {
	const writer = createImportedAudioContentIdentityWriter(await runtime.store.beginSourceWrite(sourceId, {
		...metadata, sampleRate: buffer.sampleRate, channelCount: buffer.numberOfChannels,
		chunkFrames: runtime.SOURCE_CHUNK_FRAMES,
	}), runtime.SOURCE_CHUNK_FRAMES);
	try {
		assertCurrent();
		await runtime.writeBuffer(writer, buffer);
		assertCurrent();
		await writer.commit({ sampleRate: buffer.sampleRate, channelCount: buffer.numberOfChannels });
		assertCurrent();
		return writer.contentIdentity(buffer.length);
	} catch (error) {
		return rollbackImportedAudioContentIdentityWriter(writer, () => runtime.store.deleteSource(sourceId), error);
	}
}
