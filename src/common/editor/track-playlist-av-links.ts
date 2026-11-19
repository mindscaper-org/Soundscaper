/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveRuntimeClipProjection } from './runtime-clip-projection.ts';

type Data = Record<string, unknown>;

/** An audio arrangement may replace its half of a camera pair, without editing picture. */
export function reconcileTrackPlaylistAvLinks(project: Data, track: Data, outgoing: readonly Data[], others: readonly Data[], incoming: readonly Data[]): void {
	const outgoingLinks = new Set(outgoing.map(clip => clip.avLinkId).filter(Boolean));
	const retained = new Set<unknown>();
	const tracks = project.tracks as Data[];
	for (const clip of incoming) {
		if (!clip.avLinkId) continue;
		const partners = others.filter(other => other.avLinkId === clip.avLinkId);
		const picture = partners.length === 1 && partners[0]?.kind === 'video' ? partners[0] : null;
		const pictureTrack = picture && tracks.find(other => (other.clipIds as unknown[] | undefined)?.includes(picture.id));
		const audioRange = resolveRuntimeClipProjection(project, clip);
		const videoRange = picture && resolveRuntimeClipProjection(project, picture);
		if (clip.anchor === 'sample' && pictureTrack?.laneGroupId && pictureTrack.laneGroupId === track.laneGroupId
			&& audioRange.timelineStartFrame === videoRange?.timelineStartFrame && audioRange.timelineEndFrame === videoRange.timelineEndFrame) {
			retained.add(clip.avLinkId);
		} else clip.avLinkId = null;
	}
	for (const clip of others) {
		if (!clip.avLinkId || !outgoingLinks.has(clip.avLinkId) || retained.has(clip.avLinkId)) continue;
		const owner = tracks.find(other => (other.clipIds as unknown[] | undefined)?.includes(clip.id));
		if (owner?.locked) throw new RangeError('Unlock the linked picture track before changing this audio playlist.');
		clip.avLinkId = null;
	}
}
