/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAdmProjectMetadata } from './adm-project-metadata.ts';
import type { AudioEditorCommand } from './commands/protocol.ts';

interface AdmTrackCopy {
	readonly sourceTrackId: string;
	readonly targetTrackId: string;
}

/** A copied terminal strip needs the same authored delivery as its source. */
export function duplicateTrackAdmCommands(
	project: Readonly<Record<string, unknown>>,
	copies: readonly AdmTrackCopy[],
	createId: (prefix: string) => string,
): readonly AudioEditorCommand[] {
	const metadata = project.metadata as Readonly<{ adm?: unknown }> | null | undefined;
	const value = metadata?.adm as Readonly<Record<string, unknown>> | null | undefined;
	if (value?.mode !== 'authored') return [];
	const adm = normalizeAdmProjectMetadata({ ...value, mode: 'authored' });
	if (adm.mode !== 'authored') return [];
	const assignments = copies.flatMap(({ sourceTrackId, targetTrackId }) => adm.bed.assignments
		.filter(({ stripKind, stripId }) => stripKind === 'track' && stripId === sourceTrackId)
		.map((assignment) => ({ ...assignment, stripId: targetTrackId })));
	const objects = copies.flatMap(({ sourceTrackId, targetTrackId }) => (adm.objects ?? [])
		.filter(({ stripKind, stripId }) => stripKind === 'track' && stripId === sourceTrackId)
		.map((object) => ({ ...object, id: createId('adm-object'), stripId: targetTrackId })));
	if (!assignments.length && !objects.length) return [];
	return [{ type: 'metadata/update', changes: { adm: normalizeAdmProjectMetadata({
		...adm,
		bed: { ...adm.bed, assignments: [...adm.bed.assignments, ...assignments] },
		...(objects.length ? { objects: [...(adm.objects ?? []), ...objects] } : {}),
	}) } }];
}
