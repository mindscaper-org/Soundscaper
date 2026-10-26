/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClipLoop } from '../../../audio-clip-loop.ts';
import { CLIP_SOURCE_STRETCH_EXTENSION } from '../../../clip-source-stretch-memory.ts';
import { createAddClipCommand } from '../../../commands/factories.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import type { ControllerClip, ControllerSource } from '../track-domain-types.ts';

/** Reinterpret changes the sound's clock; composite clocks must be rendered first. */
export function assertClipCanReinterpret(clip: ControllerClip): void {
	if (clip.avLinkId) throw new RangeError('Reinterpret requires unlinking the audio from its video first.');
	if (readClipLoop(clip)) throw new RangeError('Reinterpret requires removing the clip loop first.');
	if (clip.anchor === 'musical' || clip.stretchToTempo) throw new RangeError('Reinterpret requires a sample-anchored clip without musical tempo stretching.');
	const extensions = clip.opaqueExtensions as Readonly<Record<string, unknown>> | undefined;
	if (clip.warpMap || extensions?.[CLIP_SOURCE_STRETCH_EXTENSION]) throw new RangeError('Reinterpret requires rendering the clip’s source stretch or warp first.');
}

/** Preserve each byte boundary while the selected clip takes the new PCM clock. */
export function reinterpretedClipCommands(trackId: string, clip: ControllerClip, original: ControllerSource,
	replacement: ControllerSource): AudioEditorCommand[] {
	assertClipCanReinterpret(clip);
	const sourceRatio = replacement.frameCount / original.frameCount;
	const sourceFrame = (frame: number): number => {
		const output = frame * sourceRatio;
		if (!Number.isSafeInteger(output)) throw new RangeError('Reinterpret requires complete PCM frames at every clip trim boundary.');
		return output;
	};
	const durationFrames = Math.max(1, Math.round(clip.durationFrames * sourceRatio * original.sampleRate / replacement.sampleRate));
	if (!Number.isSafeInteger(durationFrames + clip.timelineStartFrame)) throw new RangeError('Reinterpreted clip duration exceeds the safe frame range.');
	const timelineFrame = (frame: number): number => Math.min(durationFrames, Math.max(0, Math.round(frame * durationFrames / clip.durationFrames)));
	const envelope = Array.isArray(clip.envelope) ? clip.envelope as readonly Readonly<{ frame: number; value: number }>[] : undefined;
	return [
		...(typeof clip.groupId === 'string' && clip.groupId ? [{ type: 'clip/ungroup' as const, clipIds: [clip.id] }] : []),
		{ type: 'clip/remove', clipId: clip.id },
		createAddClipCommand(trackId, { ...clip, sourceId: replacement.id,
			sourceStartFrame: sourceFrame(clip.sourceStartFrame), sourceDurationFrames: sourceFrame(clip.sourceDurationFrames),
			trimStartFrames: sourceFrame(clip.trimStartFrames ?? 0), trimEndFrames: sourceFrame(clip.trimEndFrames ?? 0), durationFrames,
			...(typeof clip.fadeInFrames === 'number' ? { fadeInFrames: timelineFrame(clip.fadeInFrames) } : {}),
			...(typeof clip.fadeOutFrames === 'number' ? { fadeOutFrames: timelineFrame(clip.fadeOutFrames) } : {}),
			...(envelope ? { envelope: envelope.map(point => ({ ...point, frame: timelineFrame(point.frame) })) } : {}),
		}),
	];
}
