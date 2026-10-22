/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand, CommandObject } from '../../../commands/protocol.ts';
import type { TakeCompDocumentGroup } from '../../../take-comp-document-v17.ts';

/** A recorded comp can own all of a track's audio without any ordinary clips. */
export function duplicateTrackTakeGroupCommands(
	project: Readonly<Record<string, unknown>>,
	sourceTrackId: string,
	targetTrackId: string,
	createId: (prefix: string) => string,
): readonly AudioEditorCommand[] {
	if (!Array.isArray(project.takeGroups)) return [];
	const groups = project.takeGroups as readonly TakeCompDocumentGroup[];
	return groups.filter(group => group.trackId === sourceTrackId).map(group => {
		const lanes = new Map(group.lanes.map(lane => [lane.id, createId('take-lane')]));
		const takes = new Map(group.takes.map(take => [take.id, createId('take')]));
		const copy = {
			...structuredClone(group), id: createId('take-group'), trackId: targetTrackId,
			laneOrder: group.laneOrder.map(id => lanes.get(id)!),
			lanes: group.lanes.map(lane => ({ ...lane, id: lanes.get(lane.id)! })),
			takes: group.takes.map(take => ({ ...take, id: takes.get(take.id)!, laneId: lanes.get(take.laneId)! })),
			compRegions: group.compRegions.map(region => ({ ...region, id: createId('comp-region'), takeId: takes.get(region.takeId)! })),
		};
		return { type: 'take-comp/group-add', group: copy as unknown as CommandObject };
	});
}
