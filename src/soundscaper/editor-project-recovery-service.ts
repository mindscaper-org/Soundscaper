/* SPDX-License-Identifier: AGPL-3.0-only */

import { createProjectStoreId } from '../common/editor/storage/project-store-defaults.ts';
import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import type { ProjectRecoveryCandidate } from '../common/editor/storage/project-recovery-repository.ts';
import { ProjectCommittedMaintenanceError } from '../common/editor/storage/project-committed-maintenance-error.ts';
import { ProjectDuplicationIndeterminateError } from '../common/editor/storage/project-duplication.ts';
import { SoundscaperDesktopProjectLibraryCommittedError, SoundscaperDesktopProjectLibraryIndeterminateError } from './desktop-project-library-renderer-catalog.ts';
import { cloneSoundscaperProject, validateSoundscaperProject } from './editor-project.ts';
import { repairSoundscaperProject, type SoundscaperProjectRepair } from './editor-project-recovery-repair.ts';
import { readSoundscaperRecoveryAvailableAudioSources } from './editor-project-recovery-media.ts';
import { isSoundscaperRecoveryBlockedFailure } from './editor-project-recovery-evidence.ts';
import type {
	SoundscaperProjectRecoveryActions, SoundscaperProjectRecoveryInspection,
	SoundscaperProjectRecoveryResult, SoundscaperProjectRecoveryStore,
} from './editor-project-recovery-types.ts';

export type { SoundscaperProjectRecoveryInspection, SoundscaperProjectRecoveryResult,
	SoundscaperProjectRecoveryStore, SoundscaperProjectRecoveryActions } from './editor-project-recovery-types.ts';

interface InspectionAuthority {
	readonly store: SoundscaperProjectRecoveryStore;
	readonly rows: readonly ProjectRecoveryCandidate[];
	readonly publications: Map<number, PendingPublication>;
}
interface PendingPublication {
	readonly expected: ProjectDocument;
	readonly sourceRevision: number | null;
	readonly changes: SoundscaperProjectRepair['changes'];
}
const INSPECTIONS = new WeakMap<SoundscaperProjectRecoveryInspection, InspectionAuthority>();

/** Inspect every retained revision independently, even when ordinary project loading rejects the current row. */
export async function inspectSoundscaperProjectRecovery(
	store: SoundscaperProjectRecoveryStore, projectId: string,
): Promise<SoundscaperProjectRecoveryInspection> {
	const rows = await store.readProjectRecoveryCandidates(projectId);
	if (rows.length === 0) throw new Error('No saved project or retained revision is available for recovery.');
	const candidates = [];
	const availability = new Map<string, boolean>();
	for (const row of rows) {
		try {
			if (record(row.project)?.id !== projectId) throw new Error('Saved project identity does not match its storage key.');
			const repair = await prepare(store, row, availability);
			candidates.push(Object.freeze({ key: row.key, kind: row.kind, revision: row.revision,
				status: repair.changes.length === 0 ? 'usable' as const : 'repairable' as const,
				changes: repair.changes, error: row.diagnostic ?? null }));
		} catch (error) {
			if (isSoundscaperRecoveryBlockedFailure(error)) throw error;
			candidates.push(Object.freeze({ key: row.key, kind: row.kind, revision: row.revision,
				status: 'unrecoverable' as const, changes: Object.freeze([]), error: message(error) }));
		}
	}
	const title = rows.map(({ project }) => record(project)?.title).find((title) => typeof title === 'string' && title.trim());
	const inspection: SoundscaperProjectRecoveryInspection = Object.freeze({
		projectId, title: typeof title === 'string' ? title : 'Damaged project', candidates: Object.freeze(candidates),
	});
	INSPECTIONS.set(inspection, { store, rows, publications: new Map() });
	return inspection;
}

/** Create a fresh library copy. The original document, revisions, and source bodies are never deleted or overwritten. */
export async function createSoundscaperProjectRecoveryCopy(
	store: SoundscaperProjectRecoveryStore, inspection: SoundscaperProjectRecoveryInspection, candidateIndex: number,
): Promise<SoundscaperProjectRecoveryResult> {
	const authority = INSPECTIONS.get(inspection);
	if (!authority || authority.store !== store) throw new Error('A current recovery inspection is required.');
	if (!Number.isSafeInteger(candidateIndex) || candidateIndex < 0) throw new Error('A recovery candidate is required.');
	const row = authority.rows[candidateIndex];
	if (!row || inspection.candidates[candidateIndex]?.status === 'unrecoverable') throw new Error('This recovery candidate cannot be restored.');
	const pending = authority.publications.get(candidateIndex);
	if (pending) return complete(inspection, await verifyPublication(store, pending.expected), pending.sourceRevision, pending.changes);
	const current = (await store.readProjectRecoveryCandidates(inspection.projectId)).find(({ key }) => key === row.key);
	if (!current || !sameProjectSnapshot(row, current)) throw new Error('The saved recovery candidate changed; inspect the project again.');
	const repaired = await prepare(store, current);
	const timestamp = new Date().toISOString();
	const source = cloneSoundscaperProject(repaired.project) as unknown as Record<string, unknown>;
	source.revision = 0;
	const copyProjectId = createProjectStoreId('project');
	const title = `${inspection.title} (recovered)`;
	// The existing duplication lifecycle owns exact linked-original aliases and their rollback.
	const created = await store.linkedOriginalStoreService.duplicateProject({
		loadProject: (projectId) => Promise.resolve(projectId === inspection.projectId ? source as ProjectDocument : null),
		listProjects: async () => {
			const summaries = await store.listProjectRecoverySummaries();
			return [{ id: inspection.projectId }, ...summaries.filter(({ id }) => id !== inspection.projectId).map(({ id }) => ({ id }))];
		},
		createProjectIfAbsent: async (copy) => {
			try { return await store.createProjectIfAbsent(copy); }
			catch (error) {
				if (error instanceof ProjectCommittedMaintenanceError && error.committedProject.id === copy.id) {
					validateSoundscaperProject(error.committedProject);
					return error.committedProject;
				}
				if (!(error instanceof SoundscaperDesktopProjectLibraryCommittedError
					|| error instanceof SoundscaperDesktopProjectLibraryIndeterminateError)
					|| error.operation !== 'publication' || error.projectId !== copy.id) throw error;
				authority.publications.set(candidateIndex, { expected: copy, sourceRevision: row.revision, changes: repaired.changes });
				// A main publication can outlive renderer reconciliation. Retain exact aliases
				// and the copy ID until its authoritative saved snapshot can be verified.
				try { return await verifyPublication(store, copy); }
				catch (verificationError) { throw new ProjectDuplicationIndeterminateError(copy.id, new AggregateError([error, verificationError])); }
			}
		},
	}, { sourceProjectId: inspection.projectId, copyProjectId, title, timestamp });
	return complete(inspection, created, row.revision, repaired.changes);
}

async function verifyPublication(store: SoundscaperProjectRecoveryStore, expected: ProjectDocument): Promise<ProjectDocument> {
	const latest = (await store.readProjectRecoveryCandidates(expected.id)).find(({ project }) => record(project)?.id === expected.id);
	if (!latest || latest.diagnostic || !sameProjectSnapshot(latest.project, expected)) {
		throw new Error('The recovered copy publication cannot yet be verified; retry the same recovery.');
	}
	validateSoundscaperProject(latest.project);
	return latest.project as ProjectDocument;
}
function complete(inspection: SoundscaperProjectRecoveryInspection, created: ProjectDocument, sourceRevision: number | null,
	changes: SoundscaperProjectRepair['changes']): SoundscaperProjectRecoveryResult {
	validateSoundscaperProject(created);
	INSPECTIONS.delete(inspection);
	return Object.freeze({ project: cloneSoundscaperProject(created), sourceRevision, changes });
}

export function createSoundscaperProjectRecoveryActions(store: SoundscaperProjectRecoveryStore): SoundscaperProjectRecoveryActions {
	return Object.freeze({
		list: async () => store.listProjectRecoverySummaries(),
		inspect: (projectId: string) => inspectSoundscaperProjectRecovery(store, projectId),
		recover: (inspection: SoundscaperProjectRecoveryInspection, index: number) => createSoundscaperProjectRecoveryCopy(store, inspection, index),
	});
}

async function prepare(store: SoundscaperProjectRecoveryStore, row: ProjectRecoveryCandidate, availability = new Map<string, boolean>()): Promise<SoundscaperProjectRepair> {
	const available = await readSoundscaperRecoveryAvailableAudioSources(store, row.project, availability);
	return repairSoundscaperProject(row.project, available);
}
function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
