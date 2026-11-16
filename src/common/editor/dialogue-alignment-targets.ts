/* SPDX-License-Identifier: AGPL-3.0-only */

export interface DialogueTargetProject {
	readonly sampleRate: number;
	readonly clips: readonly { readonly id: string; readonly sourceId?: unknown; readonly title?: unknown;
		readonly kind?: unknown; readonly anchor?: unknown; readonly timelineStartFrame?: unknown; readonly durationFrames?: unknown; readonly avLinkId?: unknown }[];
	readonly tracks: readonly { readonly id: string; readonly type?: unknown; readonly clipIds?: readonly string[];
		readonly locked?: unknown; readonly audioFreeze?: unknown }[];
	readonly sources: readonly { readonly id: string; readonly channelCount?: unknown; readonly missing?: unknown; readonly kind?: unknown }[];
}
export interface DialogueTarget {
	readonly clipId: string;
	readonly trackId: string;
	readonly sourceId: string;
	readonly title: string;
	readonly startFrame: number;
	readonly frameCount: number;
	readonly channelCount: number;
}

/** The same admission drives the menu, dialog choices and processing boundary. */
export function dialogueAlignmentTargets(project: DialogueTargetProject | null): readonly DialogueTarget[] {
	if (!project || !Number.isSafeInteger(project.sampleRate) || project.sampleRate < 8000 || project.sampleRate > 192000) return [];
	return project.clips.flatMap(clip => {
		const track = project.tracks.find(candidate => candidate.type === 'audio' && candidate.clipIds?.includes(clip.id));
		const source = project.sources.find(candidate => candidate.id === clip.sourceId);
		const start = Number(clip.timelineStartFrame), length = Number(clip.durationFrames), channels = Number(source?.channelCount);
		if (!track || track.locked || track.audioFreeze || !source || source.missing || source.kind && source.kind !== 'audio'
			|| clip.kind && clip.kind !== 'audio' || clip.avLinkId || clip.anchor === 'musical'
			|| !Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length)
			|| length < project.sampleRate * .25 || length > project.sampleRate * 30 || !Number.isSafeInteger(channels) || channels < 1 || channels > 2) return [];
		return [{ clipId: clip.id, trackId: track.id, sourceId: source.id, title: String(clip.title || clip.id),
			startFrame: start, frameCount: length, channelCount: channels }];
	});
}
