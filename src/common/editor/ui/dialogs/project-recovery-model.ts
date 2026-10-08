/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectRecoverySummary } from '../../storage/project-recovery-repository.ts';

export interface ProjectRecoveryUiInspection {
	readonly projectId: string;
	readonly title: string;
	readonly candidates: readonly {
		readonly key: string;
		readonly revision: number | null;
		readonly kind: 'current' | 'revision';
		readonly status: 'usable' | 'repairable' | 'unrecoverable';
		readonly changes: readonly { readonly path: string; readonly reason: string }[];
		readonly error: string | null;
	}[];
}

export interface ProjectRecoveryUiActions {
	list(): Promise<readonly ProjectRecoverySummary[]>;
	inspect(projectId: string): Promise<ProjectRecoveryUiInspection>;
	recover(inspection: ProjectRecoveryUiInspection, candidateIndex: number): Promise<unknown>;
}
