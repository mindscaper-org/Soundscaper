/* SPDX-License-Identifier: AGPL-3.0-only */

import { admBedChannelOrder, authoredAdmChannelCount, normalizeAdmProjectMetadata, type AdmAuthoredMetadata } from '../../../../adm-project-metadata.ts';
import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import { normalizeMixerGraphV21 } from '../../../../mixer-graph-v21.ts';
import { isSoundscaperProductionProject } from '../../../../project-schema-version.ts';
import type { NormalizedMixRenderOptions } from '../../mix-render-options.ts';
import type { ControllerProject, ControllerTrack } from '../../track-domain-types.ts';

export function authoredMixRenderAdm(project: ControllerProject): AdmAuthoredMetadata | null {
	if (!isSoundscaperProductionProject(project)) return null;
	const value = (project.metadata as Readonly<{ adm?: unknown }> | null | undefined)?.adm;
	if (!value || typeof value !== 'object' || !('mode' in value) || value.mode !== 'authored') return null;
	const adm = normalizeAdmProjectMetadata(value as AdmAuthoredMetadata);
	return adm.mode === 'authored' ? adm : null;
}

/** One ADM object has one source strip; a shared bus cannot be split into two object inputs. */
export function assertCombinedAdmMixRepresentable(
	project: ControllerProject,
	targetTracks: readonly ControllerTrack[],
	options: Readonly<NormalizedMixRenderOptions>,
): void {
	const adm = options.mixDown ? authoredMixRenderAdm(project) : null;
	if (!adm) return;
	if (options.mixDownChannelCount !== null && options.mixDownChannelCount !== authoredAdmChannelCount(adm)) {
		throw new RangeError('Mix and Render must retain the authored ADM delivery channel count.');
	}
	const tracks = new Set(targetTracks.map(({ id }) => id));
	const nodes = contributingMixerNodes(project, tracks);
	for (const object of adm.objects ?? []) {
		const affected = object.stripKind === 'track' ? tracks.has(object.stripId) : nodes.has(object.stripId);
		if (affected && (!options.replaceOriginals || object.stripKind !== 'track')) {
			throw new RangeError('Mix and Render cannot split an authored ADM object between retained strips. Render its track individually.');
		}
	}
}

/** A combined source already holds delivered channels, gains and object signals. */
export function combinedAdmMixCommands(
	project: ControllerProject,
	targetTracks: readonly ControllerTrack[],
	outputTrackId: string,
	options: Readonly<NormalizedMixRenderOptions>,
): readonly AudioEditorCommand[] {
	const adm = options.mixDown ? authoredMixRenderAdm(project) : null;
	if (!adm) return [];
	assertCombinedAdmMixRepresentable(project, targetTracks, options);
	const targets = new Set(targetTracks.map(({ id }) => id));
	const channels = admBedChannelOrder(adm.bed.layout);
	const assignments = adm.bed.assignments.filter(({ stripKind, stripId }) => !options.replaceOriginals
		|| stripKind !== 'track' || !targets.has(stripId));
	assignments.push(...channels.map((bedChannel, sourceChannel) => ({
		stripKind: 'track' as const, stripId: outputTrackId, sourceChannel, bedChannel, gain: 1,
	})));
	const objects = adm.objects?.map((object, index) => options.replaceOriginals
		&& object.stripKind === 'track' && targets.has(object.stripId)
		? { ...object, stripId: outputTrackId, sourceChannel: channels.length + index, gain: 1 }
		: object);
	return [{ type: 'metadata/update', changes: { adm: normalizeAdmProjectMetadata({
		...adm, bed: { ...adm.bed, assignments }, ...(objects ? { objects } : {}),
	}) } }];
}

function contributingMixerNodes(project: ControllerProject, trackIds: ReadonlySet<string>): ReadonlySet<string> {
	const nodes = new Set<string>();
	const graph = normalizeMixerGraphV21(project.mixer);
	let changed = true;
	while (changed) {
		changed = false;
		for (const edge of graph.edges) {
			if (!edge.enabled || edge.kind === 'sidechain' || edge.destination.kind !== 'mixer-node') continue;
			const source = edge.source;
			if ((source.kind === 'track' && trackIds.has(source.id)) || (source.kind === 'mixer-node' && nodes.has(source.id))) {
				if (!nodes.has(edge.destination.id)) { nodes.add(edge.destination.id); changed = true; }
			}
		}
	}
	return nodes;
}
