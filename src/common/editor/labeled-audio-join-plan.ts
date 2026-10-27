/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from './commands/protocol.ts';
import type { LabeledAudioRegion } from './labeled-audio-regions.ts';
import { createLabeledClipIntervalIndex } from './labeled-audio-clip-interval-index.ts';

export interface JoinableClip {
	readonly id: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
}

/** Plan each requested adjacent run once, even when labels share participating clips. */
export function planLabeledAudioJoinRuns(
	clipIds: readonly string[],
	regions: readonly LabeledAudioRegion[],
	findClip: (id: string) => JoinableClip | null | undefined,
): readonly Extract<AudioEditorCommand, { type: 'clip/join' }>[] {
	const clips = clipIds.map(findClip).filter((clip): clip is JoinableClip => Boolean(clip))
		.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame);
	const coveredClips = createLabeledClipIntervalIndex(clips);
	const parents = new Int32Array(clips.length).fill(-1);
	const ranks = new Uint8Array(clips.length);
	for (const region of regions) {
		const covered = coveredClips(region.startFrame - 1, region.endFrame + 1);
		for (const run of adjacentRuns(clips, covered)) {
			const first = run[0]!;
			if (parents[first]! < 0) parents[first] = first;
			for (const index of run.slice(1)) {
				if (parents[index]! < 0) parents[index] = index;
				let left = root(first), right = root(index);
				if (left === right) continue;
				if (ranks[left]! < ranks[right]!) [left, right] = [right, left];
				parents[right] = left;
				if (ranks[left] === ranks[right]) ranks[left] = ranks[left]! + 1;
			}
		}
	}
	const groups = new Map<number, string[]>();
	for (let index = 0; index < clips.length; index++) {
		if (parents[index]! < 0) continue;
		const owner = root(index), ids = groups.get(owner);
		if (ids) ids.push(clips[index]!.id);
		else groups.set(owner, [clips[index]!.id]);
	}
	return [...groups.values()].map(clipIds => ({ type: 'clip/join' as const, clipIds }));

	function root(index: number): number {
		if (parents[index] !== index) parents[index] = root(parents[index]!);
		return parents[index]!;
	}
}

function adjacentRuns(clips: readonly JoinableClip[], covered: readonly number[]): readonly (readonly number[])[] {
	const runs: number[][] = [];
	let current: number[] = [];
	let previousEndFrame: number | null = null;
	for (const index of covered) {
		const clip = clips[index]!;
		if (previousEndFrame !== null && clip.timelineStartFrame === previousEndFrame) current.push(index);
		else {
			if (current.length > 1) runs.push(current);
			current = [index];
		}
		previousEndFrame = clip.timelineStartFrame + clip.durationFrames;
	}
	if (current.length > 1) runs.push(current);
	return runs;
}
