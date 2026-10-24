/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MixerEdgeV21 } from './mixer-graph-v21.ts';

type RoutingProject = Readonly<Record<string, unknown>>;
type TrackCopy = Readonly<{ sourceTrackId: string; targetTrackId: string }>;

export interface DerivedSidechainRoute {
	readonly original: MixerEdgeV21;
	readonly route: MixerEdgeV21;
}

/** A copied detector must address the copied rack, not the original effect identity. */
export function derivedTrackSidechainRoutes(
	originalProject: RoutingProject,
	project: RoutingProject,
	edges: readonly MixerEdgeV21[],
	copies: readonly TrackCopy[],
): readonly DerivedSidechainRoute[] {
	if (!copies.length) return [];
	const copiesBySource = new Map<string, TrackCopy[]>();
	for (const copy of copies) {
		const id = copy.sourceTrackId;
		const members = copiesBySource.get(id);
		if (members) members.push(copy);
		else copiesBySource.set(id, [copy]);
	}
	const originalRacks = trackRackReader(originalProject, true);
	const copiedRacks = trackRackReader(project);
	const results: DerivedSidechainRoute[] = [];
	for (const edge of edges) {
		if (edge.destination.kind !== 'effect-sidechain') continue;
		const originalDestination = edge.destination;
		const sourceCopies = edge.source.kind === 'track'
			? copiesBySource.get(edge.source.id) ?? [] : [];
		const destinationCopies = originalDestination.strip.kind === 'track'
			? copiesBySource.get(originalDestination.strip.id) ?? [] : [];
		if (destinationCopies.length) {
			for (const [index, copy] of destinationCopies.entries()) {
				const effectId = copiedEffectId(originalRacks, copiedRacks, copy, originalDestination.effectId);
				if (!effectId) continue;
				const sourceCopy = sourceCopies[index] ?? sourceCopies[0];
				// Combining a detector and its programme removes their separate signal
				// identities; do not turn that external input into a rack feedback loop.
				if (sourceCopy?.targetTrackId === copy.targetTrackId) continue;
				results.push({ original: edge, route: { ...edge,
					source: sourceCopy ? { kind: 'track', id: sourceCopy.targetTrackId } : edge.source,
					destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: copy.targetTrackId }, effectId },
				} });
			}
		} else {
			for (const copy of sourceCopies) results.push({ original: edge, route: {
				...edge, source: { kind: 'track', id: copy.targetTrackId },
			} });
		}
	}
	return results;
}

function copiedEffectId(
	originalRacks: ReturnType<typeof trackRackReader>,
	copiedRacks: ReturnType<typeof trackRackReader>,
	copy: TrackCopy,
	effectId: string,
): string | null {
	const original = originalRacks(copy.sourceTrackId);
	const index = original.indices.get(effectId);
	if (index === undefined) return null;
	const copied = copiedRacks(copy.targetTrackId).effects[index];
	return typeof copied?.id === 'string'
		&& copied.type === original.effects[index]?.type ? copied.id : null;
}

function trackRackReader(project: RoutingProject, indexEffects = false) {
	const tracks: readonly unknown[] = Array.isArray(project.tracks) ? project.tracks : [];
	const first = new Map<unknown, RoutingProject>();
	for (const track of tracks) if (isRecord(track)) {
		const id = track.id;
		if (!first.has(id)) first.set(id, track);
	}
	const racks = new Map<string, { effects: readonly RoutingProject[]; indices: ReadonlyMap<unknown, number> }>();
	return (trackId: string) => {
		const known = racks.get(trackId);
		if (known) return known;
		const track = first.get(trackId);
		const values: readonly unknown[] = Array.isArray(track?.effects) ? track.effects : [];
		const effects = values.filter(isRecord);
		const indices = new Map<unknown, number>();
		if (indexEffects) for (const [index, effect] of effects.entries()) if (!indices.has(effect.id)) indices.set(effect.id, index);
		const rack = { effects, indices };
		racks.set(trackId, rack);
		return rack;
	};
}

function isRecord(value: unknown): value is RoutingProject {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
