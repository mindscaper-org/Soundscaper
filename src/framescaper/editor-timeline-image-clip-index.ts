/* SPDX-License-Identifier: AGPL-3.0-only */

type ImageInterval = Readonly<{
	clip: Readonly<{ sequenceStartFrame: number; sequenceFrameCount: number }>;
}>;

/** Find the clips active at an exact sequence frame, in composition order. */
export function createFramescaperImageClipIndex<Context extends ImageInterval>(contexts: readonly Context[]) {
	const byStart = contexts.map(({ clip }, ordinal) => ({
		start: clip.sequenceStartFrame, end: clip.sequenceStartFrame + clip.sequenceFrameCount, ordinal,
	})).sort((left, right) => left.start - right.start);
	const maximumEnds = new Float64Array(byStart.length * 4);
	if (byStart.length > 0) build(1, 0, byStart.length - 1);
	return (frame: number): readonly Context[] => {
		const active: number[] = [];
		if (byStart.length > 0) visit(1, 0, byStart.length - 1);
		return active.sort((left, right) => left - right).map((ordinal) => contexts[ordinal]!);

		function visit(node: number, first: number, last: number): void {
			if (maximumEnds[node]! <= frame || byStart[first]!.start > frame) return;
			if (first === last) { active.push(byStart[first]!.ordinal); return; }
			const middle = (first + last) >>> 1;
			visit(node * 2, first, middle);
			visit(node * 2 + 1, middle + 1, last);
		}
	};

	function build(node: number, first: number, last: number): number {
		if (first === last) return maximumEnds[node] = byStart[first]!.end;
		const middle = (first + last) >>> 1;
		return maximumEnds[node] = Math.max(build(node * 2, first, middle), build(node * 2 + 1, middle + 1, last));
	}
}
