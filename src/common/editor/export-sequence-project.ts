/* SPDX-License-Identifier: AGPL-3.0-only */

type Data = Readonly<Record<string, unknown>>;

/** A delivered timeline belongs to its own track hierarchy, not the project-wide union. */
export function exportSequenceProject<Project extends object>(project: Project, sequenceId?: string): Project {
	const data = project as Data;
	const id = sequenceId ?? data.primarySequenceId;
	const sequence = records(data.sequences).find(item => item.id === id);
	const nodes = sequence?.trackNodes;
	const ids = sequence?.trackIds;
	if (!Array.isArray(nodes) && !Array.isArray(ids)) return project;
	const ownedIds = new Set(Array.isArray(nodes)
		? records(nodes).filter(node => node.kind === 'track').map(node => String(node.id))
		: Array.isArray(ids) ? ids.map(String) : []);
	const tracks = records(data.tracks).filter(track => ownedIds.has(String(track.id)));
	const clipIds = new Set(tracks.flatMap(track => Array.isArray(track.clipIds) ? track.clipIds.map(String) : []));
	return Object.freeze({
		...project,
		tracks,
		clips: records(data.clips).filter(clip => clipIds.has(String(clip.id))),
		...(Array.isArray(data.timelineAnnotations) ? {
			timelineAnnotations: records(data.timelineAnnotations).filter(annotation => annotation.sequenceId === id),
		} : {}),
	});
}

function records(value: unknown): readonly Data[] {
	return Array.isArray(value) ? value.filter((item): item is Data => item !== null && typeof item === 'object' && !Array.isArray(item)) : [];
}
