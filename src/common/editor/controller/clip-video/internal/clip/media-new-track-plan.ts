/* SPDX-License-Identifier: AGPL-3.0-only */

import { clipSelectionMembership } from './clip-selection-membership.ts';
import { createAddTrackCommand } from '../../../../commands/factories.ts';
import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import type { ClipTransformClip, ClipTransformProject, ClipTransformTrack } from './clip-domain-types.ts';
import { isFramescaperSequenceProjectSchema } from '../../../../project-schema-version.ts';

/** New destination lanes retain the owning programme of the material they copy. */
export function clipNewTrackSequencePlacement(project: ClipTransformProject, sourceTrackId: string): Readonly<{ sequenceId?: string }> {
	return prepareSequencePlacements(project)(sourceTrackId);
}

function prepareSequencePlacements(project: ClipTransformProject): (trackId: string) => Readonly<{ sequenceId?: string }> {
	const owners = new Map<string, string>();
	if (isFramescaperSequenceProjectSchema(project) && Array.isArray(project.sequences)) {
		for (const value of project.sequences as unknown[]) {
			if (value === null || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string'
				|| !('trackIds' in value) || !Array.isArray(value.trackIds)) continue;
			for (const trackId of value.trackIds as unknown[]) if (typeof trackId === 'string' && !owners.has(trackId)) owners.set(trackId, value.id);
		}
	}
	return trackId => { const sequenceId = owners.get(trackId); return sequenceId === undefined ? {} : { sequenceId }; };
}

/** Derive destinations for picture-bearing clip moves, including image-only rows. */
export function prepareMediaNewTrackPlan(project: ClipTransformProject, clips: readonly ClipTransformClip[],
	createId: (prefix: string) => string, trackName: string) {
	const tracks = project.tracks;
	const selected = clipSelectionMembership(tracks, clips);
	const videoIds = new Set(clips.filter(clip => clip.kind === 'video').map(clip => clip.id));
	const audioCompanions = new Map<string, ClipTransformTrack>();
	for (const track of tracks) if (track.type === 'audio' && track.laneGroupId && !audioCompanions.has(track.laneGroupId)) audioCompanions.set(track.laneGroupId, track);
	const sequencePlacement = prepareSequencePlacements(project);
	const movingTrackIds = new Set(tracks.filter(track => (
		track.clipIds?.some(id => selected ? selected.has(id) : clips.some(clip => clip.id === id))
	)).map(track => track.id));
	const destinationTrackIds = new Map<string, string>();
	const commands: AudioEditorCommand[] = [];
	for (const track of project.tracks) {
		if (!movingTrackIds.has(track.id) || destinationTrackIds.has(track.id)) continue;
		if (track.type === 'video') {
			const hasVideo = track.clipIds?.some(id => videoIds.has(id)) ?? false;
			const companion = hasVideo && track.laneGroupId ? audioCompanions.get(track.laneGroupId) : null;
			const laneGroupId = hasVideo ? createId('media-lane') : undefined;
			const videoTrackId = createId('video-track');
			commands.push({ ...createAddTrackCommand({ type: 'video', id: videoTrackId, name: track.name,
				...(track.height === undefined ? {} : { height: track.height }),
				...(track.color === undefined ? {} : { color: track.color }), ...(laneGroupId ? { laneGroupId } : {}) }),
				...sequencePlacement(track.id) });
			destinationTrackIds.set(track.id, videoTrackId);
			if (hasVideo) {
				const audioTrackId = createId('track');
				commands.push({ ...createAddTrackCommand({ type: 'audio', id: audioTrackId,
					name: companion?.name || `${track.name} Audio`, channelCount: companion?.channelCount || 2,
					color: companion?.color, armed: false, laneGroupId }, project.sampleRate),
					...sequencePlacement(track.id) });
				if (companion) destinationTrackIds.set(companion.id, audioTrackId);
			}
		} else if (track.type === 'audio') {
			const trackId = createId('track');
			commands.push({ ...createAddTrackCommand({ type: 'audio', id: trackId,
				name: `${trackName} ${project.tracks.length + commands.length + 1}`,
				...(track.channelCount === undefined ? {} : { channelCount: track.channelCount }),
				...(track.color === undefined ? {} : { color: track.color }), armed: false }, project.sampleRate),
				...sequencePlacement(track.id) });
			destinationTrackIds.set(track.id, trackId);
		}
	}
	return { commands, destinationTrackIds };
}
