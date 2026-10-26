/* SPDX-License-Identifier: AGPL-3.0-only */

interface ClipInterval {
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
}

/** Query sorted clips in their original order, pruning even long overlapping beds. */
export function createLabeledClipIntervalIndex(clips: readonly ClipInterval[]) {
	const maximumEnds = new Float64Array(Math.max(1, clips.length * 4));
	if (clips.length) build(1, 0, clips.length - 1);
	return (startFrame: number, endFrame: number): readonly number[] => {
		const selected: number[] = [];
		if (clips.length) visit(1, 0, clips.length - 1);
		return selected;

		function visit(node: number, first: number, last: number): void {
			if (maximumEnds[node]! < startFrame || clips[first]!.timelineStartFrame > endFrame) return;
			if (first === last) { selected.push(first); return; }
			const middle = (first + last) >>> 1;
			visit(node * 2, first, middle);
			visit(node * 2 + 1, middle + 1, last);
		}
	};

	function build(node: number, first: number, last: number): number {
		const clip = clips[first]!;
		if (first === last) return maximumEnds[node] = clip.timelineStartFrame + clip.durationFrames;
		const middle = (first + last) >>> 1;
		return maximumEnds[node] = Math.max(build(node * 2, first, middle), build(node * 2 + 1, middle + 1, last));
	}
}
