/* SPDX-License-Identifier: AGPL-3.0-only */

type DataRecord = Record<string, unknown>;
type Admission = (path: string, update: (draft: DataRecord) => void, relationships?: boolean) => boolean;

/** Rebuild relationships that cannot pass document validation one member at a time. */
export function restoreSoundscaperRecoveryClipGroups(
	raw: DataRecord,
	acceptedTracks: ReadonlySet<string>,
	attempt: Admission,
	note: (path: string, reason: string) => void,
): void {
	const tracks = records(raw.tracks).filter(track => acceptedTracks.has(String(track.id)));
	const groups = new Map<string, DataRecord[]>();
	for (const track of tracks) {
		if (typeof track.laneGroupId !== 'string' || !track.laneGroupId) continue;
		const members = groups.get(track.laneGroupId) ?? [];
		members.push(track); groups.set(track.laneGroupId, members);
	}
	for (const [id, members] of groups) {
		const ids = new Set(members.map(track => track.id));
		attempt(`tracks.laneGroupId[${id}]`, draft => {
			draft.tracks = records(draft.tracks).map(track => ids.has(track.id) ? { ...track, laneGroupId: id } : track);
		}, true);
	}
	const ownerByClipId = new Map(tracks.flatMap(track => values(track.clipIds).map(id => [id, track.id] as const)));
	const clips = values(raw.clips);
	const consumed = new Set<number>();
	for (const [index, value] of clips.entries()) {
		if (consumed.has(index)) continue;
		const clip = record(value);
		if (!clip || !ownerByClipId.has(clip.id)) {
			note(`clips[${String(index)}]`, 'Removed a clip without a valid owning track.');
			continue;
		}
		const link = typeof clip.avLinkId === 'string' && clip.avLinkId ? clip.avLinkId : null;
		const block = link ? clips.flatMap((value, at) => {
			const candidate = record(value);
			return candidate?.avLinkId === link && ownerByClipId.has(candidate.id) ? [{ clip: candidate, index: at }] : [];
		}) : [{ clip, index }];
		for (const entry of block) consumed.add(entry.index);
		if (admit(block, false) || !link) continue;
		// If its other member is genuinely damaged, retain a valid independent
		// recording with an explicit reported link removal rather than losing both.
		for (const entry of block) admit([entry], true);
	}

	function admit(block: readonly Readonly<{ clip: DataRecord; index: number }>[], detach: boolean): boolean {
		return attempt(`clips[${String(block[0]!.index)}]`, draft => {
			const additions = block.map(({ clip }) => detach ? { ...clip, avLinkId: null } : clip);
			draft.clips = [...values(draft.clips), ...additions];
			draft.tracks = records(draft.tracks).map(track => ({ ...track, ...(Object.hasOwn(track, 'clipIds') ? {
				clipIds: [...values(track.clipIds), ...additions.filter(clip => ownerByClipId.get(clip.id) === track.id).map(clip => clip.id)],
			} : {}) }));
		}, true);
	}
}

function values(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function record(value: unknown): DataRecord | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null; }
function records(value: unknown): DataRecord[] { return values(value).map(record).filter((row): row is DataRecord => row !== null); }
