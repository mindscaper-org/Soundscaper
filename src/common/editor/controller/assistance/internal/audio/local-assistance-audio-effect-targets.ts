/* SPDX-License-Identifier: AGPL-3.0-only */

type DataRecord = Readonly<Record<string, unknown>>;

export interface LocalAssistanceAudioEffectTarget {
	readonly clipId: string;
	readonly trackId: string;
	readonly selection: Readonly<{
		startFrame: number; endFrame: number; trackIds: readonly string[];
		clipIds: readonly string[]; frequencyRange: null;
	}>;
}

/** Preserve occurrence identity while splitting an ordinary selection into exact audio intersections. */
export function localAssistanceAudioEffectTargets(
	value: unknown,
	focusedClipId: string | null,
): readonly LocalAssistanceAudioEffectTarget[] {
	const project = record(value);
	const clips = records(project.clips), tracks = records(project.tracks);
	const selection = project.selection == null ? {} : record(project.selection);
	const clipIds = ids(selection.clipIds), trackIds = ids(selection.trackIds);
	const startFrame = Number(selection.startFrame), endFrame = Number(selection.endFrame);
	const ranged = Number.isSafeInteger(startFrame) && startFrame >= 0
		&& Number.isSafeInteger(endFrame) && endFrame > startFrame;
	const explicitIds = new Set<string>();
	const requestedIds = ranged && trackIds.length ? [] : clipIds.length ? clipIds
		: focusedClipId ? [focusedClipId] : [];
	for (const id of requestedIds) {
		const clip = clips.find(candidate => candidate.id === id);
		if (clip?.kind === 'audio') explicitIds.add(id);
		else if (clip?.kind === 'video' && typeof clip.avLinkId === 'string') {
			const peers = clips.filter(candidate => candidate.kind === 'audio' && candidate.avLinkId === clip.avLinkId);
			if (peers.length === 1 && typeof peers[0]!.id === 'string') explicitIds.add(peers[0]!.id);
		}
	}
	const selectedTracks = new Set(trackIds);
	const targets: LocalAssistanceAudioEffectTarget[] = [];
	for (const clip of clips) {
		if (clip.kind !== 'audio' || typeof clip.id !== 'string') continue;
		const owners = tracks.filter(track => track.type === 'audio' && ids(track.clipIds).includes(String(clip.id)));
		const selected = requestedIds.length ? explicitIds.has(clip.id)
			: ranged && owners.some(track => selectedTracks.has(String(track.id)));
		if (!selected) continue;
		if (owners.length !== 1 || typeof owners[0]!.id !== 'string') {
			throw new Error('Selected audio has ambiguous track ownership.');
		}
		const clipStart = Number(clip.timelineStartFrame), clipEnd = clipStart + Number(clip.durationFrames);
		if (!Number.isSafeInteger(clipStart) || clipStart < 0 || !Number.isSafeInteger(clipEnd) || clipEnd <= clipStart) {
			throw new RangeError('Selected audio has invalid timeline geometry.');
		}
		const start = ranged ? Math.max(startFrame, clipStart) : clipStart;
		const end = ranged ? Math.min(endFrame, clipEnd) : clipEnd;
		if (end <= start) continue;
		const trackId = owners[0]!.id;
		targets.push(Object.freeze({ clipId: clip.id, trackId, selection: Object.freeze({
			startFrame: start, endFrame: end, trackIds: Object.freeze([trackId]),
			clipIds: Object.freeze([clip.id]), frequencyRange: null,
		}) }));
	}
	return Object.freeze(targets);
}

function record(value: unknown): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Audio selection requires project records.');
	return value as DataRecord;
}
function records(value: unknown): readonly DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError('Audio selection requires project inventories.');
	return value.map(record);
}
function ids(value: unknown): readonly string[] {
	return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}
