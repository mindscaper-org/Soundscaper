/* SPDX-License-Identifier: AGPL-3.0-only */
import { createAddClipCommand } from '../../../commands/factories.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import { resampledClipSourceStretchFields } from '../../../clip-source-stretch-memory.ts';
import type { ControllerClip, ControllerSource } from '../track-domain-types.ts';

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
	return [
		createAddClipCommand(trackId, { ...clip, ...resampledClipSourceStretchFields(clip, previous, pair.left),
			sourceId: pair.left.id, avLinkId: null }),
		createAddClipCommand(rightTrackId, {
			...clip,
			...resampledClipSourceStretchFields(clip, previous, pair.right),
			id: createId('clip'), sourceId: pair.right.id,
			title: `${clip.title} — ${rightChannel}`, avLinkId: null,
		}),
	];
}
