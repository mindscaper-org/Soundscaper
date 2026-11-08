/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PianoRollMusicalClock } from '@soundscaper/design-system/PianoRoll/musical-clock';
import { midiProjectTiming } from '../../midi-project-timing.ts';
import { createIndexedTempoClock } from '../../indexed-tempo-projector.ts';
import { createMusicalRulerTicks } from '../timeline/musical-ruler-model.ts';

/** Preserve the piano roll's zero-origin source clock, independently of clip playback transforms. */
export function createMidiPanelMusicalClock(project: Parameters<typeof midiProjectTiming>[0]): PianoRollMusicalClock | undefined {
	const { tempoMap, signatureMap } = midiProjectTiming(project);
	if (tempoMap.events.length < 2 && signatureMap.events.length < 2 && signatureMap.events[0]?.denominator === 4) return undefined;
	const rate = project.sampleRate;
	const clock = createIndexedTempoClock(tempoMap, rate);
	return Object.freeze({
		beatAtTime: (seconds: number) => clock.beatAtTime(Math.max(0, seconds)),
		timeAtBeat: (beat: number) => clock.timeAtBeat(Math.max(0, beat)),
		ticks: (start: number, end: number, pixelsPerSecond: number) => createMusicalRulerTicks({
			tempoMap, signatureMap, sampleRate: rate, startFrame: Math.max(0, Math.floor(start * rate)),
			endFrame: Math.max(0, Math.ceil(end * rate)), pixelsPerFrame: pixelsPerSecond / rate,
		}).map(tick => ({ time: tick.frame / rate, bar: tick.beat === 0, label: tick.label })),
	});
}
