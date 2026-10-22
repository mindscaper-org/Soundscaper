/* SPDX-License-Identifier: AGPL-3.0-only */

import type { SourcePcmChunk } from '../common/editor/storage/source-read-repository.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import type { ProjectRecoveryCandidate, ProjectRecoverySummary } from '../common/editor/storage/project-recovery-repository.ts';
import type { LinkedOriginalStoreService } from '../common/editor/storage/linked-original-store-service.ts';
import type { SoundscaperProject } from './editor-project-validation.ts';

export interface SoundscaperProjectRecoveryChange { readonly path: string; readonly reason: string }
export interface SoundscaperProjectRecoveryCandidate {
	readonly key: string;
	readonly revision: number | null;
	readonly kind: 'current' | 'revision';
	readonly status: 'usable' | 'repairable' | 'unrecoverable';
	readonly changes: readonly SoundscaperProjectRecoveryChange[];
	readonly error: string | null;
}
export interface SoundscaperProjectRecoveryInspection {
	readonly projectId: string;
	readonly title: string;
	readonly candidates: readonly SoundscaperProjectRecoveryCandidate[];
}
export interface SoundscaperProjectRecoveryResult {
	readonly project: SoundscaperProject;
	readonly sourceRevision: number | null;
	readonly changes: readonly SoundscaperProjectRecoveryChange[];
}
export interface SoundscaperProjectRecoveryStore {
	readProjectRecoveryCandidates(projectId: string): PromiseLike<readonly ProjectRecoveryCandidate[]>;
	listProjectRecoverySummaries(): PromiseLike<readonly ProjectRecoverySummary[]>;
	readSourceChunks(sourceId: string): AsyncIterable<SourcePcmChunk>;
	createProjectIfAbsent(project: ProjectDocument): PromiseLike<ProjectDocument | null>;
	readonly linkedOriginalStoreService: Pick<LinkedOriginalStoreService, 'duplicateProject'>;
}
export interface SoundscaperProjectRecoveryActions {
	list(): Promise<readonly ProjectRecoverySummary[]>;
	inspect(projectId: string): Promise<SoundscaperProjectRecoveryInspection>;
	recover(inspection: SoundscaperProjectRecoveryInspection, candidateIndex: number): Promise<SoundscaperProjectRecoveryResult>;
}
