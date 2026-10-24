/* SPDX-License-Identifier: AGPL-3.0-only */

import { sequenceTrackMembers } from '../../sequence-track-members.ts';
import { isStandaloneMonoAudioTrack } from '../../mono-track-pair-admission.ts';

export interface TrackSelectionContextTrack {
	readonly id: string;
	readonly type?: string;
	readonly clipIds?: readonly string[];
	readonly locked?: boolean;
	readonly laneGroupId?: string | null;
}

interface TrackSelectionContextProject {
	readonly tracks: readonly TrackSelectionContextTrack[];
	readonly clips: readonly Readonly<{ id: string; sourceId?: string }>[];
	readonly sources?: readonly Readonly<{ id: string; channelCount?: number }>[];
}

export interface TrackSelectionContextActions {
	readonly update?: (id: string, changes: Readonly<{ locked?: boolean; color?: string; halfWave?: boolean; showRms?: boolean }>) => unknown;
	readonly makeStereo?: (id: string) => unknown;
	readonly swapChannels?: (id: string) => unknown;
	readonly splitStereoLR?: (id: string) => unknown;
	readonly splitStereoCenter?: (id: string) => unknown;
}

interface ContextMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	readonly onClick?: () => unknown;
	readonly items?: readonly ContextMenuItem[];
}

/** Structural commands affect every member of the existing linked media block. */
export function trackStructureMutationBlocked(
	project: Pick<TrackSelectionContextProject, 'tracks'> | null,
	track: TrackSelectionContextTrack | null,
): boolean {
	return track?.locked === true || Boolean(track?.laneGroupId
		&& project?.tracks.some(candidate => candidate.laneGroupId === track.laneGroupId && candidate.locked === true));
}

/** Shared lock/channel commands for track overflow and selected-track shortcuts. */
export function createTrackSelectionContextMenuItems(input: Readonly<{
	project: TrackSelectionContextProject | null;
	track: TrackSelectionContextTrack | null;
	copy: Readonly<Record<string, string>>;
	audioEffects: boolean;
	blocked: boolean;
	actions?: TrackSelectionContextActions;
}>) {
	const { project, track, copy, blocked, audioEffects, actions = {} } = input;
	const audioTrack = track?.type === 'audio' ? track : null;
	const { channelCount, compatibleMonoTrack } = trackChannelMenuFacts(project, audioTrack, audioEffects);
	const sourceBlocked = blocked || audioTrack?.locked === true;
	const structureBlocked = blocked || trackStructureMutationBlocked(project, audioTrack);
	const channelItem = (id: string, label: string, unavailable: boolean, operation?: (id: string) => unknown): ContextMenuItem => ({
		id, label, disabled: sourceBlocked || !audioTrack || unavailable || !operation,
		onClick: () => !sourceBlocked && !unavailable && audioTrack ? operation?.(audioTrack.id) : undefined,
	});
	return {
		shared: [{
			id: 'track-lock-toggle', label: track?.locked ? copy.unlockTrack : copy.lockTrack,
			disabled: blocked || !track || !actions.update,
			onClick: () => track ? actions.update?.(track.id, { locked: !track.locked }) : undefined,
		}],
		audio: audioEffects ? [{
			id: 'track-channels', label: copy.trackChannels, disabled: sourceBlocked || !audioTrack,
			items: [
				channelItem('track-make-stereo', copy.makeStereoTrack, !compatibleMonoTrack, actions.makeStereo),
				channelItem('track-swap-channels', copy.swapStereoChannels, channelCount !== 2, actions.swapChannels),
				channelItem('track-split-stereo-to-lr', copy.splitStereoLr, structureBlocked || channelCount !== 2, actions.splitStereoLR),
				channelItem('track-split-stereo-to-center', copy.splitStereoCenter, structureBlocked || channelCount !== 2, actions.splitStereoCenter),
			],
		}] : [],
	};
}

/** No returned menu closure retains the temporary media lookup. */
function trackChannelMenuFacts(project: TrackSelectionContextProject | null, audioTrack: TrackSelectionContextTrack | null, audioEffects: boolean) {
	// The menu owns one media lookup, discarded as soon as its items are built.
	let clips: ReadonlyMap<string, TrackSelectionContextProject['clips'][number]> | undefined;
	let sources: ReadonlyMap<string, NonNullable<TrackSelectionContextProject['sources']>[number]> | undefined;
	const channelCountFor = (candidate: TrackSelectionContextTrack | null): number => {
		let maximum = 0;
		if (candidate?.type !== 'audio') return maximum;
		if (!candidate.clipIds?.length) return maximum;
		clips ??= new Map(project?.clips.map(clip => [clip.id, clip]));
		sources ??= new Map(project?.sources?.map(source => [source.id, source]));
		for (const id of candidate.clipIds ?? []) {
			const sourceId = clips.get(id)?.sourceId;
			if (sourceId !== undefined) maximum = Math.max(maximum, Number(sources.get(sourceId)?.channelCount) || 0);
		}
		return maximum;
	};
	const channelCount = audioEffects ? channelCountFor(audioTrack) : 0;
	let partner: TrackSelectionContextTrack | undefined;
	if (audioEffects && isStandaloneMonoAudioTrack(audioTrack, channelCount)) {
		const primaryIndex = project?.tracks.findIndex(candidate => candidate.id === audioTrack?.id) ?? -1;
		const members = sequenceTrackMembers(project, audioTrack?.id);
		for (const [index, candidate] of (project?.tracks ?? []).entries()) {
			if (candidate.id === audioTrack?.id || (members && !members.has(candidate.id))
				|| !isStandaloneMonoAudioTrack(candidate, channelCountFor(candidate))) continue;
			partner ??= candidate;
			if (index > primaryIndex) { partner = candidate; break; }
		}
	}
	return { channelCount, compatibleMonoTrack: Boolean(isStandaloneMonoAudioTrack(audioTrack, channelCount) && partner && !partner.locked) };

}
