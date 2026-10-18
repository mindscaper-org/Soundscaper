/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSoundscaperProjectRecoveryActions } from './editor-project-recovery-service.ts';
import { copyOrdinaryRecordingRecoveryToProject, type RecordingRecoveryJournalCopyPort } from '../common/editor/storage/recording-recovery-journal-copy.ts';
import type { SoundscaperProjectRecoveryInspection, SoundscaperProjectRecoveryResult, SoundscaperProjectRecoveryStore } from './editor-project-recovery-types.ts';
import { hasSoundscaperProjectRecoveryEvidence, isSoundscaperRecoveryBlockedFailure } from './editor-project-recovery-evidence.ts';
import { readSoundscaperRecoveryAvailableAudioSources } from './editor-project-recovery-media.ts';
import { validateSoundscaperProject } from './editor-project-validation.ts';

/** Open the published copy through the ordinary activation fences; retries reuse a completed publication. */
export function bindSoundscaperProjectRecovery(
	store: SoundscaperProjectRecoveryStore & { readonly analysisRepository?: RecordingRecoveryJournalCopyPort },
	open: (project: SoundscaperProjectRecoveryResult['project']) => PromiseLike<unknown> | unknown,
) {
	const service = createSoundscaperProjectRecoveryActions(store);
	const published = new WeakMap<SoundscaperProjectRecoveryInspection, Map<number, SoundscaperProjectRecoveryResult>>();
	const inFlight = new WeakMap<SoundscaperProjectRecoveryInspection, { readonly index: number; readonly operation: Promise<SoundscaperProjectRecoveryResult> }>();
	return Object.freeze({
		list: service.list,
		inspect: service.inspect,
		recover(inspection: SoundscaperProjectRecoveryInspection, index: number): Promise<SoundscaperProjectRecoveryResult> {
			const pending = inFlight.get(inspection);
			if (pending) return pending.index === index ? pending.operation
				: Promise.reject(new Error('A different recovery candidate is already being restored.'));
			const operation = Promise.resolve().then(async () => {
				let candidates = published.get(inspection);
				if (!candidates) { candidates = new Map(); published.set(inspection, candidates); }
				let result = candidates.get(index);
				if (!result) { result = await service.recover(inspection, index); candidates.set(index, result); }
				if (store.analysisRepository) await copyOrdinaryRecordingRecoveryToProject(store.analysisRepository, inspection.projectId, result.project);
				await open(result.project);
				return result;
			}).finally(() => { inFlight.delete(inspection); });
			inFlight.set(inspection, { index, operation });
			return operation;
		},
	});
}

/** Saved document or media damage can enter repair; an unrelated startup failure stays fatal. */
export async function hasSoundscaperStartupRecovery(
	store: Pick<SoundscaperProjectRecoveryStore, 'readProjectRecoveryCandidates'> & Partial<Pick<SoundscaperProjectRecoveryStore, 'readSourceChunks'>>,
	projectId: string,
	error: unknown,
): Promise<boolean> {
	if (isSoundscaperRecoveryBlockedFailure(error)) return false;
	const rows = await store.readProjectRecoveryCandidates(projectId);
	if (hasSoundscaperProjectRecoveryEvidence(rows, error)) return true;
	const current = rows.find((row) => row.kind === 'current');
	if (!current || !store.readSourceChunks) return false;
	const project = current.project;
	if (!validateSoundscaperProject(project)) return false;
	const available = await readSoundscaperRecoveryAvailableAudioSources({ readSourceChunks: store.readSourceChunks.bind(store) }, project);
	return project.sources.some((source) => source.kind === 'audio' && !available.has(source.id));
}
