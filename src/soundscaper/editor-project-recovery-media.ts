/* SPDX-License-Identifier: AGPL-3.0-only */

import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import { PcmStorageCorruptionError } from '../common/editor/wavpack/pcm.js';
import { isSoundscaperRecoveryBlockedFailure } from './editor-project-recovery-evidence.ts';
import type { SoundscaperProjectRecoveryStore } from './editor-project-recovery-types.ts';
import { createScapeDigest, scapeHex } from '../common/editor/scape-archive-media.ts';
import type { SourcePcmChunk } from '../common/editor/storage/source-read-repository.ts';
import { LinkedOriginalContentUnavailableError } from '../common/editor/storage/linked-original-content-unavailable-error.ts';

import { soundscaperRecoveryVideoAvailable } from './editor-project-recovery-video.ts';
import type { SoundscaperRecoveryVideoStore } from './editor-project-recovery-video.ts';

type MediaReadStore = Pick<SoundscaperProjectRecoveryStore, 'readSourceChunks' | 'getSourceMetadata'> & SoundscaperRecoveryVideoStore;

/** Read canonical PCM and original video. Only confirmed missing/corrupt media may be omitted. */
export async function readSoundscaperRecoveryAvailableMediaSources(
	store: MediaReadStore, project: unknown, availability = new Map<string, boolean>(),
): Promise<ReadonlySet<string>> {
	serializeScapeProjectDocument(project);
	const available = new Set<string>();
	const sources = record(project)?.sources;
	if (!Array.isArray(sources)) return available;
	for (const value of sources) {
		const source = record(value);
		if (!source || typeof source.id !== 'string' || (source.kind !== 'audio' && source.kind !== 'video')) continue;
		const storageKey = typeof source.storageKey === 'string' && source.storageKey ? source.storageKey : source.id;
		const cacheKey = JSON.stringify([source.kind, storageKey, source.frameCount, source.channelCount, source.sampleRate, source.contentSha256, source.timingAsset]);
		if (availability.has(cacheKey)) { if (availability.get(cacheKey)) available.add(source.id); continue; }
		try {
			if (source.kind === 'video') {
				const readable = await soundscaperRecoveryVideoAvailable(store, record(project)!, source);
				availability.set(cacheKey, readable);
				if (readable) available.add(source.id);
				continue;
			}
			const metadata = record(await store.getSourceMetadata(storageKey));
			// The existing PCM reader interprets legacy metadata without a rate as 48 kHz.
			if (!metadata || (metadata.sampleRate ?? 48_000) !== source.sampleRate
				|| (metadata.frameCount ?? metadata.frameLength) !== source.frameCount
				|| metadata.channelCount !== source.channelCount) {
				throw new PcmStorageCorruptionError('Source PCM metadata differs from its saved geometry.', 'PCM_RECORD_GEOMETRY');
			}
			let frames = 0;
			let nextIndex = 0;
			const digest = typeof source.contentSha256 === 'string' ? createScapeDigest() : null;
			for await (const chunk of store.readSourceChunks(storageKey)) {
				if (chunk.index !== nextIndex || chunk.frames < 1 || !Number.isSafeInteger(chunk.frames)
					|| chunk.channels.length !== source.channelCount
					|| chunk.channels.some((channel) => channel.length !== chunk.frames)) {
					throw new PcmStorageCorruptionError('Source PCM geometry is invalid.', 'PCM_RECORD_GEOMETRY');
				}
				frames += chunk.frames;
				if (frames > Number(source.frameCount)) throw new PcmStorageCorruptionError('Source PCM exceeds its saved extent.', 'PCM_RECORD_GEOMETRY');
				if (digest) updateRecoveryPcmDigest(digest, chunk);
				nextIndex += 1;
			}
			if (frames !== source.frameCount) throw new PcmStorageCorruptionError('Source PCM is incomplete.', 'PCM_RECORD_GEOMETRY');
			if (digest && scapeHex(digest.digest()) !== source.contentSha256) {
				throw new PcmStorageCorruptionError('Source PCM does not match its saved digest.', 'PCM_RECORD_DIGEST');
			}
			available.add(source.id);
			availability.set(cacheKey, true);
		} catch (error) {
			const unavailable = unavailableReadFailure(error);
			if (unavailable) throw unavailable;
			if (!isConfirmedMediaDamage(error)) throw error;
			availability.set(cacheKey, false);
		}
	}
	return available;
}

/** The canonical source identity hashes each little-endian packet header and planar sample bits. */
function updateRecoveryPcmDigest(digest: ReturnType<typeof createScapeDigest>, chunk: SourcePcmChunk): void {
	const header = new Uint8Array(4);
	new DataView(header.buffer).setUint32(0, chunk.frames, true);
	digest.update(header);
	for (const channel of chunk.channels) {
		const bits = new Uint32Array(channel.buffer, channel.byteOffset, channel.length);
		const bytes = new Uint8Array(channel.byteLength);
		const view = new DataView(bytes.buffer);
		for (const [index, value] of bits.entries()) view.setUint32(index * 4, value, true);
		digest.update(bytes);
	}
}

function isConfirmedMediaDamage(error: unknown): boolean {
	if (isSoundscaperRecoveryBlockedFailure(error)) return false;
	if (error instanceof PcmStorageCorruptionError) return true;
	if (error instanceof LinkedOriginalContentUnavailableError) return true;
	if (!(error instanceof Error)) return false;
	return error.name === 'NotFoundError' || ('code' in error && error.code === 'ENOENT')
		|| /^(?:The requested (?:local )?audio source (?:could not be found|is missing)\.|Source storage chunk \d+ (?:is missing|does not exist)\.|The local audio source (?:is truncated|contains an invalid chunk)\.|The immutable source dependency graph contains a cycle\.|A derived source replacement points beyond its base source\.|The OPFS PCM packet is truncated\.)$/u.test(error.message);
}

function unavailableReadFailure(error: unknown): Error | null {
	const seen = new Set<unknown>();
	let current = error;
	while (current instanceof Error && !seen.has(current)) {
		seen.add(current);
		if (isSoundscaperRecoveryBlockedFailure(current) || current.name === 'TimeoutError'
			|| /(?:storage|database|worker|codec client|PCM generation|OPFS file|PCM read view).*?(?:unavailable|closed|changed|released|failed|not initialized)/iu.test(current.message)) return current;
		current = current.cause;
	}
	return null;
}
function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
