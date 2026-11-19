/* SPDX-License-Identifier: AGPL-3.0-only */
import { rackTailFrames } from '../common/editor/effects.js';
import { dataArray } from './editor-audio-track-freeze-values.ts';

/** Capture clip and track inserts in series, within the existing ten-second freeze tail budget. */
export function soundscaperFreezeTailFrames(track: Readonly<Record<string, unknown>>, clips: readonly Readonly<Record<string, unknown>>[],
	sampleRate: number, automationLanes: unknown): number {
	const lanes = dataArray(automationLanes, 'freeze automation lanes');
	const tail = (owner: Readonly<Record<string, unknown>>): number => owner.effectsActive === false ? 0
		: rackTailFrames(owner.effects ?? [], sampleRate, 10, lanes);
	let clipTail = 0;
	for (const clip of clips) clipTail = Math.max(clipTail, tail(clip));
	return Math.min(sampleRate * 10, clipTail + tail(track));
}
