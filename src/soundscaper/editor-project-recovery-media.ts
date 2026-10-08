/* SPDX-License-Identifier: AGPL-3.0-only */

import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import { PcmStorageCorruptionError } from '../common/editor/wavpack/pcm.js';
import { isSoundscaperRecoveryBlockedFailure } from './editor-project-recovery-evidence.ts';
import type { SoundscaperProjectRecoveryStore } from './editor-project-recovery-types.ts';

type MediaReadStore = Pick<SoundscaperProjectRecoveryStore, 'readSourceChunks'>;

/** Read complete canonical PCM. Only confirmed missing/corrupt media may be omitted. */
export async function readSoundscaperRecoveryAvailableAudioSources(
	store: MediaReadStore, project: unknown, availability = new Map<string, boolean>(),
): Promise<ReadonlySet<string>> {
	serializeScapeProjectDocument(project);
	const available = new Set<string>();
	const sources = record(project)?.sources;
	if (!Array.isArray(sources)) return available;
	for (const value of sources) {
		const source = record(value);
		if (!source || typeof source.id !== 'string' || source.kind !== 'audio') continue;
		const storageKey = typeof source.storageKey === 'string' && source.storageKey ? source.storageKey : source.id;
		const cacheKey = JSON.stringify([storageKey, source.frameCount, source.channelCount]);
		if (availability.has(cacheKey)) { if (availability.get(cacheKey)) available.add(source.id); continue; }
		try {
			let frames = 0;
			let nextIndex = 0;
			for await (const chunk of store.readSourceChunks(storageKey)) {
				if (chunk.index !== nextIndex || chunk.frames < 1 || !Number.isSafeInteger(chunk.frames)
					|| chunk.channels.length !== source.channelCount
					|| chunk.channels.some((channel) => channel.length !== chunk.frames)) {
					throw new PcmStorageCorruptionError('Source PCM geometry is invalid.', 'PCM_RECORD_GEOMETRY');
				}
				frames += chunk.frames;
				if (frames > Number(source.frameCount)) throw new PcmStorageCorruptionError('Source PCM exceeds its saved extent.', 'PCM_RECORD_GEOMETRY');
				nextIndex += 1;
			}
			if (frames !== source.frameCount) throw new PcmStorageCorruptionError('Source PCM is incomplete.', 'PCM_RECORD_GEOMETRY');
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

function isConfirmedMediaDamage(error: unknown): boolean {
	if (isSoundscaperRecoveryBlockedFailure(error)) return false;
	if (error instanceof PcmStorageCorruptionError) return true;
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
