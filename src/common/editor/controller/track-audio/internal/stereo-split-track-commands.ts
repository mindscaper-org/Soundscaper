/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeAudioTrackFreezeV1 } from '../../../audio-track-freeze-v21.ts';
import { normalizeAutomationLaneV21 } from '../../../automation-lane-v21.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import type { ControllerClip, ControllerProject, ControllerTrack } from '../track-domain-types.ts';

/** Retain the detector's stable track identity while replacing only its active audio. */
export function stereoSplitTrackCommands(project: ControllerProject, track: ControllerTrack, clips: readonly ControllerClip[],
	name: string, pan: number): AudioEditorCommand[] {
	const grouped = clips.filter(clip => typeof clip.groupId === 'string' && clip.groupId).map(clip => clip.id);
	const panLanes = Array.isArray(project.automationLanes) ? (project.automationLanes as readonly unknown[]).map(value => normalizeAutomationLaneV21(value))
		.filter(lane => lane.address.kind === 'strip' && lane.address.strip.kind === 'track'
			&& lane.address.strip.id === track.id && lane.address.parameterId === 'pan') : [];
	return [
		...(track.audioFreeze ? [{ type: 'audio-freeze/remove' as const, trackId: track.id,
			expectedFreeze: normalizeAudioTrackFreezeV1(track.audioFreeze) }] : []),
		...(grouped.length ? [{ type: 'clip/ungroup' as const, clipIds: grouped }] : []),
		...(clips.length ? [{ type: 'clip/remove-many' as const, clipIds: clips.map(clip => clip.id), rippleMode: 'none' as const }] : []),
		{ type: 'track/update', trackId: track.id, changes: { name, pan } },
		...panLanes.map(lane => ({ type: 'automation-lane/set' as const, laneId: lane.id, expected: { ...lane }, lane: null })),
	];
}
