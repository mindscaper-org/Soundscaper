/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ProjectDocument } from '../../../storage/project-repository.ts';
import type { RecordingRecoveryDestination, RecordingRecoveryJournal, RecordingRecoveryJournalRepository } from '../../../storage/recording-recovery-journal-repository.ts';
import type { RecordingSourceSegment } from '../recording-transaction-types.ts';
import { sameProjectSnapshot } from '../../../storage/project-snapshot-equality.ts';

export interface OrdinaryRecordingPendingRecovery {
	readonly kind: 'recording-pending-open-recovery';
	readonly projectId: string;
	readonly publicationGeneration: number;
	readonly recoveryToken: string;
	readonly draftCount: number;
	readonly checkpointCount: number;
	readonly requiresDecision: true;
}
interface Dependencies {
	readonly repository: RecordingRecoveryJournalRepository;
	getProjectId(): string | null;
	assertWritable(): void;
	loadProject(projectId: string): Promise<ProjectDocument | null>;
	prepareTarget(base: ProjectDocument, journal: RecordingRecoveryJournal): Promise<ProjectDocument>;
	getPreparedLoss?(): number;
	saveIfCurrent(base: ProjectDocument, target: ProjectDocument): Promise<ProjectDocument | null>;
	publish(base: ProjectDocument, target: ProjectDocument, journal: RecordingRecoveryJournal): Promise<void>;
	restoreProject(project: ProjectDocument): Promise<void>;
	isPublished(project: ProjectDocument, journal: RecordingRecoveryJournal): boolean;
	isComplete?(project: ProjectDocument, journal: RecordingRecoveryJournal): boolean;
	deleteSource(sourceId: string): Promise<unknown>;
}

/** Serializes routed journal updates and makes explicit restart settlement repeatable. */
export function createOrdinaryRecordingRecoveryService(dependencies: Dependencies) {
	let active: RecordingRecoveryJournal | null = null;
	let tail: Promise<unknown> = Promise.resolve();
	const serial = <T>(operation: () => Promise<T>): Promise<T> => {
		const result = tail.then(operation);
		tail = result.then(() => undefined, () => undefined);
		return result;
	};
	return Object.freeze({
		begin: (id: string) => serial(async () => {
			dependencies.assertWritable();
			const projectId = dependencies.getProjectId();
			if (!projectId) throw new Error('Recording requires an active project.');
			const base = await dependencies.loadProject(projectId);
			assertCurrent(projectId);
			if (!base) throw new Error('Recording requires a durably saved project.');
			active = await dependencies.repository.create(projectId, id, base);
		}),
		addLane: (id: string, destination: RecordingRecoveryDestination) => serial(async () => {
			const journal = requireActive(); assertCurrent(journal.projectId);
			active = await dependencies.repository.addLane(journal, id, destination);
		}),
		checkpoint: (laneId: string, segment: RecordingSourceSegment) => serial(async () => {
			const journal = requireActive(); assertCurrent(journal.projectId);
			active = await dependencies.repository.append(journal, laneId, segment);
		}),
		complete: () => serial(async () => {
			if (!active) return;
			const current = await dependencies.loadProject(active.projectId);
			if (!current || !(dependencies.isComplete ?? dependencies.isPublished)(current, active)) throw new Error('Recorded checkpoints are not yet durably attached to the project.');
			await dependencies.repository.remove(active); active = null;
		}),
		deleteCapturedSource: (sourceId: string) => serial(async () => {
			if (active?.decision === null && active.lanes.some(({ segments }) => segments.some((segment) => segment.sourceId === sourceId))) return;
			await dependencies.deleteSource(sourceId);
		}),
		prepareDiscard: () => serial(async () => {
			if (active) active = await dependencies.repository.decide(active, 'discard');
		}),
		abandon: () => serial(async () => {
			if (!active) return;
			const journal = active;
			const decided = await dependencies.repository.decide(journal, 'discard');
			await discard(decided); active = null;
		}),
		inspect,
		resolve: (pending: OrdinaryRecordingPendingRecovery, decision: 'recover' | 'discard') => serial(async () => {
			assertCurrent(pending.projectId);
			let journal = await dependencies.repository.load(pending.projectId);
			if (!journal || token(journal) !== pending.recoveryToken) throw new Error('Interrupted recording recovery authority is stale.');
			if (decision !== 'recover' && decision !== 'discard') throw new Error('Interrupted recording recovery decision is invalid.');
			if (journal.decision && journal.decision !== decision) throw new Error('Interrupted recording already has a different recovery decision.');
			if (decision === 'discard') {
				journal = await dependencies.repository.decide(journal, decision);
				await discard(journal); return;
			}
			if (!journal.target) {
				const base = await dependencies.loadProject(journal.projectId);
				assertCurrent(journal.projectId);
				if (!base) throw new Error('The interrupted recording origin project is unavailable.');
				const target = await dependencies.prepareTarget(base, journal);
				assertCurrent(journal.projectId);
				journal = await dependencies.repository.decide(journal, decision, base, target, dependencies.getPreparedLoss?.() ?? 0);
			}
			const base = journal.targetBase!; const target = journal.target!;
			const observed = await dependencies.loadProject(journal.projectId);
			assertCurrent(journal.projectId);
			if (!sameProjectSnapshot(observed, target)) {
				if (!sameProjectSnapshot(observed, base)) throw new Error('The recording project changed after recovery was prepared.');
				const saved = await dependencies.saveIfCurrent(base, target);
				if (!saved) throw new Error('The interrupted recording lost project write ownership.');
				if (!sameProjectSnapshot(saved, target)) throw new Error('Recording recovery publication changed its journaled target.');
			}
			assertCurrent(journal.projectId);
			await dependencies.publish(base, target, journal);
			assertCurrent(journal.projectId);
			await dependencies.repository.remove(journal);
		}),
	});
	async function inspect(projectId: string): Promise<OrdinaryRecordingPendingRecovery | null> {
		const journal = await dependencies.repository.load(projectId);
		if (!journal) return null;
		const checkpointCount = journal.lanes.reduce((count, lane) => count + lane.segments.length, 0);
		return Object.freeze({ kind: 'recording-pending-open-recovery', projectId, publicationGeneration: 1,
			recoveryToken: token(journal), draftCount: journal.lanes.length, checkpointCount, requiresDecision: true });
	}
	function assertCurrent(projectId: string): void {
		dependencies.assertWritable();
		if (dependencies.getProjectId() !== projectId) throw new Error('Interrupted recording belongs to a different project.');
	}
	function requireActive(): RecordingRecoveryJournal {
		if (!active) throw new Error('Recording recovery intent was not registered before capture.');
		return active;
	}
	async function discard(journal: RecordingRecoveryJournal): Promise<void> {
		const current = await dependencies.loadProject(journal.projectId);
		assertCurrent(journal.projectId);
		if (!current) throw new Error('The interrupted recording origin project is unavailable.');
		await dependencies.restoreProject(current);
		assertCurrent(journal.projectId);
		// The durable discard decision releases journal roots; project/revision roots
		// remain authoritative throughout cleanup and any restart retry.
		for (const lane of journal.lanes) for (const segment of lane.segments) {
			assertCurrent(journal.projectId);
			if (!current || !dependencies.isPublished(current, { ...journal, lanes: [{ ...lane, segments: [segment] }] })) {
				try { await dependencies.deleteSource(segment.sourceId); }
				catch (error) { if (!retainedElsewhere(error, segment.sourceId)) throw error; }
			}
		}
		await dependencies.repository.remove(journal);
	}
}
function token(journal: RecordingRecoveryJournal): string {
	return `${journal.id}:${journal.decision ?? 'capturing'}:${journal.lanes.map(({ id, segments }) => `${id}:${segments.length}`).join(',')}`;
}
function retainedElsewhere(error: unknown, sourceId: string): boolean {
	if (!(error instanceof Error)) return false;
	return error.message === `Source ${sourceId} is retained by recording recovery.`
		|| error.message === `Source ${sourceId} is retained by a saved project or revision.`
		|| error.message.startsWith(`Source ${sourceId} is retained by derived source `);
}
