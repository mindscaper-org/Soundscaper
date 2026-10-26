/* SPDX-License-Identifier: AGPL-3.0-only */

import { createTakeCompDocumentGroupsV17 } from '../../../../take-comp-document-v17.ts';
import type { ControllerSourceInventory } from '../../track-domain-types.ts';

/** Media fields read by take authoring, audition, and flattening in either product. */
export interface TakeCompProject extends Readonly<Record<string, unknown>> {
	readonly sampleRate: number;
	readonly sources: readonly ControllerSourceInventory[];
	readonly tracks: readonly Readonly<{ readonly id: string; readonly locked?: boolean }>[];
}

/** Admit the take graph against its owning sources, tracks, and sequences. */
export function readTakeCompProjectGroups(project: TakeCompProject) {
	return createTakeCompDocumentGroupsV17(project.takeGroups, project);
}
