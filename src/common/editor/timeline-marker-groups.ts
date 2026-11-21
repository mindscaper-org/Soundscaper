/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimelineAnnotationV11 } from './timeline-annotation.ts';

const GROUP_KEY = 'org.soundscaper.marker-group-v1';
type GroupableMarker = Pick<TimelineAnnotationV11, 'id' | 'sequenceId' | 'opaqueExtensions'>;
type Extensions = TimelineAnnotationV11['opaqueExtensions'];

export function timelineMarkerGroupId(marker: Pick<GroupableMarker, 'opaqueExtensions'>): string | null {
	const id = marker.opaqueExtensions?.[GROUP_KEY];
	return typeof id === 'string' && id.length > 0 ? id : null;
}

export function withTimelineMarkerGroup(extensions: Extensions, id: string | null): Extensions {
	const result = { ...extensions };
	if (id === null) delete result[GROUP_KEY];
	else result[GROUP_KEY] = id;
	return result;
}

/** Select all members of the requested groups, within each marker's own sequence. */
export function expandTimelineMarkerGroups(markers: readonly GroupableMarker[], ids: readonly string[]): readonly string[] {
	if (!ids.length) return ids;
	const selected = new Set(ids);
	const groups = new Set(markers.flatMap(marker => {
		const key = groupKey(marker);
		return key && selected.has(marker.id) ? [key] : [];
	}));
	if (!groups.size) return ids;
	for (const marker of markers) {
		const key = groupKey(marker);
		if (key && groups.has(key)) selected.add(marker.id);
	}
	return [...selected];
}

function groupKey(marker: GroupableMarker): string | null {
	const id = timelineMarkerGroupId(marker);
	return id === null ? null : JSON.stringify([marker.sequenceId, id]);
}

export function resolveTimelineMarkerGroupTargets(project: Readonly<{
	primarySequenceId?: string;
	timelineAnnotations?: readonly object[];
	selection?: Readonly<{ annotationIds?: readonly string[] }> | null;
}> | null | undefined) {
	const requested = project?.selection?.annotationIds ?? [];
	if (!requested.length) return { ids: [], group: false, ungroup: false };
	const markers = (project?.timelineAnnotations ?? []).filter(
		(marker): marker is GroupableMarker => 'id' in marker && typeof marker.id === 'string'
			&& 'sequenceId' in marker && marker.sequenceId === project?.primarySequenceId
			&& 'opaqueExtensions' in marker && marker.opaqueExtensions !== null && typeof marker.opaqueExtensions === 'object',
	);
	const selected = new Set(expandTimelineMarkerGroups(markers, requested));
	const targets = markers.filter(marker => selected.has(marker.id));
	return {
		ids: targets.map(marker => marker.id),
		group: targets.length > 1,
		ungroup: targets.some(marker => timelineMarkerGroupId(marker) !== null),
	};
}

export function selectTimelineMarker(
	markers: readonly GroupableMarker[], selected: readonly string[], id: string, mode: 'replace' | 'add' | 'toggle',
): readonly string[] {
	const members = expandTimelineMarkerGroups(markers, [id]);
	if (mode === 'replace') return members;
	if (mode === 'toggle' && selected.includes(id)) {
		const removing = new Set(members);
		return selected.filter(candidate => !removing.has(candidate));
	}
	return [...new Set([...selected, ...members])];
}
