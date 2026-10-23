/* SPDX-License-Identifier: AGPL-3.0-only */

interface Clip {
	readonly id: string;
	readonly sourceId: string;
	readonly avLinkId?: string | null;
}

/** Source removal owns its media instances and their paired picture/sound, not clip groups. */
export function binSourceTimelineRemovalIds(clips: readonly Clip[], sourceIds: ReadonlySet<string>): string[] {
	const avLinks = new Set(clips.flatMap(clip => sourceIds.has(clip.sourceId) && clip.avLinkId ? [clip.avLinkId] : []));
	return clips.filter(clip => sourceIds.has(clip.sourceId) || Boolean(clip.avLinkId && avLinks.has(clip.avLinkId)))
		.map(clip => clip.id);
}
