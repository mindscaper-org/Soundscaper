/* SPDX-License-Identifier: AGPL-3.0-only */
import { createAddClipCommand } from '../../../commands/factories.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import { resampledClipSourceStretchFields } from '../../../clip-source-stretch-memory.ts';
import { isMidiClip } from '../../../midi-model.ts';
import type { ControllerClip, ControllerSource } from '../track-domain-types.ts';

/** Keep authored mono voices raw; their extracted channel level belongs to clip gain. */
function retainsMonoMidiSource(clip: ControllerClip, source: ControllerSource): boolean {
	return source.channelCount === 1 && isMidiClip(clip);
}

/** A source shared with ordinary audio still needs a derived channel pair for those clips. */
export function planSplitStereoSources(clips: readonly ControllerClip[], sources: readonly ControllerSource[]) {
	const sourceById = new Map(sources.map(source => [source.id, source]));
	const deriveIds = new Set<string>();
	for (const clip of clips) {
		const source = sourceById.get(clip.sourceId);
		if (source && !retainsMonoMidiSource(clip, source)) deriveIds.add(source.id);
	}
	return {
		sourceById,
		sourcesToSplit: sources.filter(source => deriveIds.has(source.id)),
		sourcePairs: new Map(sources.map(source => [source.id, { left: source, right: source }])),
	};
}

/** Channel extraction keeps all authored timing, including source anchors outside the audible trim. */
export function splitStereoClipCommands(
	trackId: string,
	rightTrackId: string,
	clip: ControllerClip,
	previous: ControllerSource,
	pair: Readonly<{ left: ControllerSource; right: ControllerSource }>,
	createId: (prefix: string) => string,
	rightChannel: string,
): readonly AudioEditorCommand[] {
	const retained = retainsMonoMidiSource(clip, previous);
	const left = retained ? previous : pair.left, right = retained ? previous : pair.right;
	const level = retained ? { gain: (typeof clip.gain === 'number' ? clip.gain : 1) * Math.SQRT1_2 } : {};
	return [
		createAddClipCommand(trackId, { ...clip, ...level,
			...(retained ? {} : resampledClipSourceStretchFields(clip, previous, left)),
			sourceId: left.id, avLinkId: null }),
		createAddClipCommand(rightTrackId, {
			...clip, ...level,
			...(retained ? {} : resampledClipSourceStretchFields(clip, previous, right)),
			id: createId('clip'), sourceId: right.id,
			title: `${clip.title} — ${rightChannel}`, avLinkId: null,
		}),
	];
}
