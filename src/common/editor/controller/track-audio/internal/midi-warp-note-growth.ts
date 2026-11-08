/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeAudioWarpMap } from '../../../audio-warp-domain.ts';
import { midiProjectTiming } from '../../../midi-project-timing.ts';
import { resolveRuntimeClipProjection } from '../../../runtime-clip-projection.ts';
import { addRationals, divideRationals, multiplyRationals, roundRational, subtractRationals } from '../../../timeline-time.ts';
import type { MidiProject } from '../midi-service-types.ts';

/** Preserve the authored map while exposing new MIDI source material after its last anchor. */
export function midiWarpNoteGrowth(project: MidiProject, clip: Readonly<Record<string, unknown>>, sourceDurationFrames: number) {
	if (clip.warpMap == null || sourceDurationFrames <= Number(clip.sourceDurationFrames)) return undefined;
	const map = normalizeAudioWarpMap(clip.warpMap);
	const last = map.points.at(-1)!;
	const previous = map.points.at(-2)!;
	const sourceEnd = Number(clip.sourceStartFrame) + sourceDurationFrames;
	const extended = addRationals(last.outer, multiplyRationals(subtractRationals(sourceEnd, last.source),
		divideRationals(subtractRationals(last.outer, previous.outer), subtractRationals(last.source, previous.source))));
	const outer = clip.anchor === 'musical' ? extended
		: { num: roundRational(extended.num, extended.den, 'enclosingEnd'), den: 1 };
	const warpMap = normalizeAudioWarpMap({ feature: 'audio-warp', points: [...map.points,
		{ outer, source: { num: sourceEnd, den: 1 }, mode: 'forward' }] });
	const musical = clip.anchor === 'musical' ? { musicalDurationBeats: outer } : {};
	const next = { ...clip, ...musical, durationFrames: outer.num / outer.den, sourceDurationFrames };
	const durationFrames = resolveRuntimeClipProjection({ ...project, tempoMap: midiProjectTiming(project).tempoMap }, next).durationFrames;
	return { warpMap, ...musical, durationFrames };
}
