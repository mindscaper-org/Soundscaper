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
	const bedByTrack = trackEntries(adm.bed.assignments);
	const objectsByTrack = trackEntries(adm.objects ?? []);
	const assignments = copies.flatMap(({ sourceTrackId, targetTrackId }) => (bedByTrack.get(sourceTrackId) ?? [])
		.map((assignment) => ({ ...assignment, stripId: targetTrackId })));
	const objects = copies.flatMap(({ sourceTrackId, targetTrackId }) => (objectsByTrack.get(sourceTrackId) ?? [])
		.map((object) => ({ ...object, id: createId('adm-object'), stripId: targetTrackId })));
	if (!assignments.length && !objects.length) return [];
	return [{ type: 'metadata/update', changes: { adm: normalizeAdmProjectMetadata({
		...adm,
		bed: { ...adm.bed, assignments: [...adm.bed.assignments, ...assignments] },
		...(objects.length ? { objects: [...(adm.objects ?? []), ...objects] } : {}),
	}) } }];
}

function trackEntries<Entry extends { readonly stripKind: string; readonly stripId: string }>(entries: readonly Entry[]): ReadonlyMap<string, readonly Entry[]> {
	const tracks = new Map<string, Entry[]>();
	for (const entry of entries) {
		if (entry.stripKind !== 'track') continue;
		const members = tracks.get(entry.stripId);
		if (members) members.push(entry);
		else tracks.set(entry.stripId, [entry]);
	}
	return tracks;
}
