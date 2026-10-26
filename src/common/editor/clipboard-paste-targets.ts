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
	const sequenceIds = new Set<string>();
	for (const sequence of project.sequences ?? []) {
		sequenceIds.add(sequence.id);
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
			?? (sequenceIds.has(sourceSequence) ? sourceSequence : project.primarySequenceId);
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
	const firstTracks = new Map<string, Track>();
	const lanes = new Map<unknown, Track[]>();
	for (const track of mediaTracks) {
		if (!firstTracks.has(track.id)) firstTracks.set(track.id, track);
		if (track.laneGroupId) {
			const lane = lanes.get(track.laneGroupId);
			if (lane) lane.push(track);
			else lanes.set(track.laneGroupId, [track]);
		}
	}
	const findTrack = (id: string) => firstTracks.get(id) ?? null;
	const selected = selectedTrackId === null ? null : findTrack(selectedTrackId);
	const used = new Set<string>();
	const nextDestination = createPasteDestinationReader(mediaTracks, selected, used, sequences);
	const selectedPair = selected?.laneGroupId ? lanes.get(selected.laneGroupId) ?? [] : [];
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
		let target = nextDestination(clipboardTrack);
		if (!target) target = findTrack(clipboardTrack.sourceTrackId);
		if (!matches(target, clipboardTrack)) target = null;
		append([{ clipboardTrack, target }]);
	}
	return plan;
}

interface PasteDestinationQueue<Track> {
	readonly tracks: Track[];
	cursor: number;
}

/** Each queue advances over used destinations once, including IDs shared by lanes. */
function createPasteDestinationReader<Track extends PasteTargetTrack>(
	tracks: readonly Track[], selected: Track | null, used: ReadonlySet<string>, sequences?: ClipboardPasteSequencePlan,
): (source: ClipboardPasteTrack) => Track | null {
	type MediaType = ReturnType<typeof clipboardPasteTrackType>;
	const byType = new Map<MediaType, PasteDestinationQueue<Track>>();
	const bySequence = new Map<MediaType, Map<string | undefined, PasteDestinationQueue<Track>>>();
	const anchor = selected ? tracks.indexOf(selected) : -1;
	for (let index = anchor; index >= 0 && index < tracks.length; index++) {
		const track = tracks[index]!;
		const type = track.type === 'video' ? 'video' : 'audio';
		append(byType, type, track);
		if (sequences) {
			let typed = bySequence.get(type);
			if (!typed) { typed = new Map(); bySequence.set(type, typed); }
			append(typed, sequences.sequenceByTrackId.get(track.id), track);
		}
	}
	return source => {
		const type = clipboardPasteTrackType(source);
		const queue = sequences?.targetSequenceBySourceTrackId.has(source.sourceTrackId)
			? bySequence.get(type)?.get(sequences.targetSequenceBySourceTrackId.get(source.sourceTrackId))
			: byType.get(type);
		if (queue) while (queue.cursor < queue.tracks.length) {
			const track = queue.tracks[queue.cursor++]!;
			if (!used.has(track.id)) return track;
		}
		return null;
	};

	function append<Key>(index: Map<Key, PasteDestinationQueue<Track>>, key: Key, track: Track): void {
		const queue = index.get(key);
		if (queue) queue.tracks.push(track);
		else index.set(key, { tracks: [track], cursor: 0 });
	}
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
