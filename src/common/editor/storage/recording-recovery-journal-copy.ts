/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeRecordingRecoveryJournal, RECORDING_RECOVERY_KEY_PREFIX } from './recording-recovery-journal-repository.ts';
import type { ProjectDocument } from './project-repository.ts';
import { canonicalKeyValueComparison } from './key-value-canonical-comparison.ts';

export interface RecordingRecoveryJournalCopyPort {
	get(key: string): PromiseLike<unknown> | unknown;
	replaceIfCurrentAndPutIfAbsent(key: string, expected: unknown, replacement: unknown, intentKey: string, intent: unknown): PromiseLike<boolean> | boolean;
}

/** Reconnect checkpoints to a repaired copy while retaining the original journal and bytes. */
export async function copyOrdinaryRecordingRecoveryToProject(
	port: RecordingRecoveryJournalCopyPort,
	originProjectId: string,
	repairedProject: ProjectDocument,
): Promise<void> {
	if (originProjectId === repairedProject.id) throw new Error('Recording recovery requires a distinct repaired project copy.');
	const originKey = `${RECORDING_RECOVERY_KEY_PREFIX}${encodeURIComponent(originProjectId)}`;
	const targetKey = `${RECORDING_RECOVERY_KEY_PREFIX}${encodeURIComponent(repairedProject.id)}`;
	const raw = await port.get(originKey);
	if (raw == null) return;
	const origin = normalizeRecordingRecoveryJournal(raw);
	if (origin.projectId !== originProjectId) throw new Error('Recording recovery origin identity changed.');
	if (origin.decision === 'discard') return;
	const copied = normalizeRecordingRecoveryJournal({ ...origin, projectId: repairedProject.id, base: repairedProject,
		decision: null, targetBase: null, target: null });
	const existing = await port.get(targetKey);
	if (existing != null) {
		if (canonicalKeyValueComparison(existing) !== canonicalKeyValueComparison(copied)) throw new Error('The repaired project already has a different recording recovery.');
		return;
	}
	if (await port.replaceIfCurrentAndPutIfAbsent(originKey, raw, raw, targetKey, copied)) return;
	const racedCopy = await port.get(targetKey);
	if (racedCopy != null && canonicalKeyValueComparison(racedCopy) === canonicalKeyValueComparison(copied)) return;
	throw new Error('The original recording recovery changed before copying its checkpoints.');
}
