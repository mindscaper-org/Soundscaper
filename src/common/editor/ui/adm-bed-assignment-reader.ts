/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AdmAuthoredMetadata } from '../adm-project-metadata.ts';
import type { AdmEditorSourceChannel } from './adm-metadata-editor-model.ts';

type Assignment = AdmAuthoredMetadata['bed']['assignments'][number];
/** Invocation-local routing projection; tuple fields stay separate, preserving arbitrary strip IDs. */
export function createAdmBedAssignmentReader(assignments: AdmAuthoredMetadata['bed']['assignments']) {
	const kinds = new Map<string, Map<string, Map<number, Assignment>>>();
	for (const assignment of assignments) {
		const kind = assignment.stripKind, id = assignment.stripId, channel = assignment.sourceChannel;
		if (Number.isNaN(channel)) continue;
		let strips = kinds.get(kind);
		if (!strips) { strips = new Map(); kinds.set(kind, strips); }
		let channels = strips.get(id);
		if (!channels) { channels = new Map(); strips.set(id, channels); }
		if (!channels.has(channel)) channels.set(channel, assignment);
	}
	return (source: Pick<AdmEditorSourceChannel, 'stripKind' | 'stripId' | 'sourceChannel'>) => kinds.get(source.stripKind)?.get(source.stripId)?.get(source.sourceChannel);
}
