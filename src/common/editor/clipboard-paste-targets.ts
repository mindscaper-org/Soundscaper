/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ClipboardPasteTrack {
	readonly sourceTrackId: string;
	readonly sourceTrackType?: unknown;
	readonly sourceLaneGroupId?: unknown;
	readonly sourceSequenceId?: unknown;
	readonly clips: readonly Readonly<Record<string, unknown>>[];
}

export interface PasteTargetTrack {
	readonly id: string;
	readonly type?: unknown;
	readonly clipIds?: unknown;
	readonly laneGroupId?: unknown;
	readonly locked?: unknown;
}

export interface ClipboardPasteSequenceProject {
	readonly primarySequenceId?: string;
	readonly sequences?: readonly Readonly<{
		readonly id: string;
		readonly trackIds?: readonly string[];
		readonly trackNodes?: readonly Readonly<{ readonly id: string; readonly kind: string }>[];
	}>[];
}

export interface ClipboardPasteSequencePlan {
	readonly sequenceByTrackId: ReadonlyMap<string, string>;
	readonly targetSequenceBySourceTrackId: ReadonlyMap<string, string>;
}

/** One copied sequence stays in one destination sequence, including newly created tracks. */
export function createClipboardPasteSequencePlan(
	project: ClipboardPasteSequenceProject, selectedTrackId: string | null, clipboardTracks: readonly ClipboardPasteTrack[],
): ClipboardPasteSequencePlan {
	const sequenceByTrackId = new Map<string, string>();
	for (const sequence of project.sequences ?? []) {
		const trackIds = sequence.trackIds ?? sequence.trackNodes?.filter(node => node.kind === 'track').map(node => node.id) ?? [];
		for (const id of trackIds) sequenceByTrackId.set(id, sequence.id);
	}
	const selectedSequenceId = selectedTrackId ? sequenceByTrackId.get(selectedTrackId) : undefined;
	const destinationBySourceSequence = new Map<string, string>();
	for (const track of clipboardTracks) {
		const sourceSequence = typeof track.sourceSequenceId === 'string' ? track.sourceSequenceId : track.sourceTrackId;
		const original = sequenceByTrackId.get(track.sourceTrackId);
		if (original && !destinationBySourceSequence.has(sourceSequence)) destinationBySourceSequence.set(sourceSequence, original);
	}
	const targetSequenceBySourceTrackId = new Map<string, string>();
	for (const track of clipboardTracks) {
		const sourceSequence = typeof track.sourceSequenceId === 'string' ? track.sourceSequenceId : track.sourceTrackId;
		const destination = selectedSequenceId ?? destinationBySourceSequence.get(sourceSequence)
			?? project.sequences?.find(sequence => sequence.id === sourceSequence)?.id ?? project.primarySequenceId;
		if (destination) targetSequenceBySourceTrackId.set(track.sourceTrackId, destination);
	}
	return { sequenceByTrackId, targetSequenceBySourceTrackId };
}

export function clipboardPasteTrackType(track: ClipboardPasteTrack): 'audio' | 'video' {
	if (track.sourceTrackType === 'video') return 'video';
	if (track.sourceTrackType === 'audio') return 'audio';
	return track.clips[0]?.kind === 'video' ? 'video' : 'audio';
}

/** Resolve existing destinations without allocating the fresh tracks a paste needs. */
export function planClipboardPasteTargets<Track extends PasteTargetTrack, ClipboardTrack extends ClipboardPasteTrack>(
	tracks: readonly Track[], selectedTrackId: string | null, clipboardTracks: readonly ClipboardTrack[],
	sequences?: ClipboardPasteSequencePlan,
): readonly (readonly Readonly<{ clipboardTrack: ClipboardTrack; target: Track | null }>[])[] {
	const mediaTracks = tracks.filter(isMediaTrack);
	const findTrack = (id: string) => mediaTracks.find(track => track.id === id) ?? null;
	const selected = selectedTrackId === null ? null : findTrack(selectedTrackId);
	const used = new Set<string>();
	const handled = new Set<string>();
	const groups = new Map<string, ClipboardTrack[]>();
	for (const track of clipboardTracks) if (typeof track.sourceLaneGroupId === 'string' && track.sourceLaneGroupId) {
		const grouped = groups.get(track.sourceLaneGroupId) ?? [];
		grouped.push(track);
		groups.set(track.sourceLaneGroupId, grouped);
	}
	const matches = (target: Track | null, source: ClipboardTrack): target is Track => Boolean(
		target && target.type === clipboardPasteTrackType(source) && !used.has(target.id)
		&& (!sequences?.targetSequenceBySourceTrackId.has(source.sourceTrackId)
			|| sequences.sequenceByTrackId.get(target.id) === sequences.targetSequenceBySourceTrackId.get(source.sourceTrackId)),
	);
	const plan: Array<readonly Readonly<{ clipboardTrack: ClipboardTrack; target: Track | null }>[]> = [];
	const append = (entries: readonly Readonly<{ clipboardTrack: ClipboardTrack; target: Track | null }>[]) => {
		plan.push(entries);
		for (const { clipboardTrack, target } of entries) {
			handled.add(clipboardTrack.sourceTrackId);
			if (target) used.add(target.id);
		}
	};
	for (const clipboardTrack of clipboardTracks) {
		if (handled.has(clipboardTrack.sourceTrackId)) continue;
		const grouped = typeof clipboardTrack.sourceLaneGroupId === 'string' ? groups.get(clipboardTrack.sourceLaneGroupId) : null;
		const video = grouped?.find(track => clipboardPasteTrackType(track) === 'video');
		const audio = grouped?.find(track => clipboardPasteTrackType(track) === 'audio');
		if (grouped?.length === 2 && video && audio) {
			const selectedPair = selected?.laneGroupId
				? mediaTracks.filter(track => track.laneGroupId === selected.laneGroupId) : [];
			let pair: readonly Track[] | null = selectedPair.length === 2 && selectedPair[0]?.type === 'video'
				&& selectedPair[1]?.type === 'audio' && matches(selectedPair[0], video) && matches(selectedPair[1], audio) ? selectedPair : null;
			const originalVideo = findTrack(video.sourceTrackId);
			const originalAudio = findTrack(audio.sourceTrackId);
			if (!pair && matches(originalVideo, video) && matches(originalAudio, audio)
				&& originalVideo.laneGroupId && originalVideo.laneGroupId === originalAudio.laneGroupId) {
				pair = [originalVideo, originalAudio];
			}
			append([{ clipboardTrack: video, target: pair?.[0] ?? null }, { clipboardTrack: audio, target: pair?.[1] ?? null }]);
			continue;
		}
		const anchor = selected ? tracks.indexOf(selected) : -1;
		let target = anchor < 0 ? null : tracks.slice(anchor).filter(isMediaTrack).find(track => matches(track, clipboardTrack)) ?? null;
		if (!target) target = findTrack(clipboardTrack.sourceTrackId);
		if (!matches(target, clipboardTrack)) target = null;
		append([{ clipboardTrack, target }]);
	}
	return plan;
}

/** The document owns a validated descriptor; publish only its destination lock state. */
export function hasLockedClipboardPasteTarget(
	project: (ClipboardPasteSequenceProject & Readonly<{ tracks?: readonly PasteTargetTrack[] }>) | null, clipboard: unknown, selectedTrackId: string | null,
): boolean {
	if (!project || !isRecord(clipboard) || !Array.isArray(clipboard.tracks)) return false;
	const tracks = clipboard.tracks.filter((track: unknown): track is ClipboardPasteTrack =>
		isRecord(track) && typeof track.sourceTrackId === 'string' && Array.isArray(track.clips));
	return planClipboardPasteTargets(project.tracks ?? [], selectedTrackId, tracks, createClipboardPasteSequencePlan(project, selectedTrackId, tracks))
		.some(group => group.some(({ target }) => target?.locked === true));
}

function isMediaTrack<Track extends PasteTargetTrack>(track: Track): boolean {
	return (track.type === 'audio' || track.type === 'video') && Array.isArray(track.clipIds);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
