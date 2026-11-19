/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiExpressionTimeline } from './midi-expression.ts';
interface Voice {
	readonly index: number;
	readonly startFrame: number;
	readonly soundEnd: number;
	readonly timeline: MidiExpressionTimeline;
}
interface Winner { readonly frame: number; readonly index: number }

/** Latest held key wins in mono mode; retain a compiled clock instead of scanning voices per sample. */
export function createMidiMonoVoiceIndex(notes: readonly Voice[]) {
	const groups = new Map<MidiExpressionTimeline, Voice[]>();
	const modes = new Map<MidiExpressionTimeline, boolean>();
	for (const note of notes) {
		let enabled = modes.get(note.timeline);
		if (enabled === undefined) { enabled = note.timeline.states.some(state => state.mono); modes.set(note.timeline, enabled); }
		if (!enabled) continue;
		const group = groups.get(note.timeline);
		if (group) group.push(note); else groups.set(note.timeline, [note]);
	}
	const clocks = new Map<MidiExpressionTimeline, readonly Winner[]>();
	for (const [timeline, voices] of groups) {
		const events = voices.flatMap(voice => [{ frame: voice.startFrame, voice }, { frame: voice.soundEnd, voice: null }]);
		events.sort((left, right) => left.frame - right.frame);
		const heap: Voice[] = [], winners: Winner[] = [];
		const newer = (left: Voice, right: Voice) => left.startFrame > right.startFrame || left.startFrame === right.startFrame && left.index > right.index;
		for (let cursor = 0; cursor < events.length;) {
			const frame = events[cursor]!.frame;
			while (cursor < events.length && events[cursor]!.frame === frame) {
				const voice = events[cursor++]!.voice;
				if (!voice) continue;
				let child = heap.length; heap.push(voice);
				while (child > 0) {
					const parent = (child - 1) >>> 1;
					if (!newer(voice, heap[parent]!)) break;
					heap[child] = heap[parent]!; child = parent;
				}
				heap[child] = voice;
			}
			while (heap.length && heap[0]!.soundEnd <= frame) {
				const tail = heap.pop()!;
				if (!heap.length) break;
				let parent = 0;
				while (parent * 2 + 1 < heap.length) {
					let child = parent * 2 + 1;
					if (child + 1 < heap.length && newer(heap[child + 1]!, heap[child]!)) child++;
					if (!newer(heap[child]!, tail)) break;
					heap[parent] = heap[child]!; parent = child;
				}
				heap[parent] = tail;
			}
			const index = heap[0]?.index ?? -1;
			if (winners.at(-1)?.index !== index) winners.push({ frame, index });
		}
		clocks.set(timeline, winners);
	}
	return { winner(timeline: MidiExpressionTimeline, frame: number): Readonly<{ index: number; end: number }> {
		const clock = clocks.get(timeline) ?? [];
		let lower = 0, upper = clock.length;
		while (lower < upper) {
			const middle = (lower + upper) >>> 1;
			if (clock[middle]!.frame <= frame) lower = middle + 1; else upper = middle;
		}
		return { index: clock[lower - 1]?.index ?? -1, end: clock[lower]?.frame ?? Infinity };
	} };
}
