/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from './code-unit-order.ts';
import { nonNegativeFrame, positiveFrame } from './aup4-export-values.js';

interface OverlapClip {
	readonly id: unknown;
	readonly timelineStartFrame: unknown;
	readonly durationFrames: unknown;
}

const HEAP_LANE_THRESHOLD = 64;
const LINEAR_PREFIX = 8;

/** Reuse the lowest available authored lane; keep sparse queries in the small linear kernel. */
export function assignAup4OverlapLanes<Clip extends OverlapClip>(clips: readonly Clip[]): Clip['id'][][] {
	const ordered = clips.slice().sort((left, right) => (
		Number(left.timelineStartFrame) - Number(right.timelineStartFrame)
		|| compareCodeUnits(String(left.id), String(right.id))
	));
	if (Object.getPrototypeOf(ordered) !== Array.prototype || Object.hasOwn(ordered, Symbol.iterator)
		|| !worthWideIndex(ordered)) return assignLegacySorted(ordered);
	const lanes: Clip['id'][][] = [], ends: number[] = [];
	let cursor = 0;
	while (cursor < ordered.length) {
		cursor = assignLinearPhase(ordered, cursor, lanes, ends);
		if (cursor < ordered.length) cursor = assignWidePhase(ordered, cursor, lanes, ends);
	}
	return lanes.length ? lanes : [[]];
}

function assignLinearPhase<Clip extends OverlapClip>(clips: readonly Clip[], cursor: number, lanes: Clip['id'][][], ends: number[]): number {
	for (; cursor < clips.length; cursor++) {
		const clip = clips[cursor]!;
		const start = nonNegativeFrame(clip.timelineStartFrame, `clip ${clip.id as string} timelineStartFrame`);
		const end = start + positiveFrame(clip.durationFrames, `clip ${clip.id as string} durationFrames`);
		let lane = ends.findIndex(previous => previous <= start);
		if (lane < 0) { lane = lanes.length; lanes.push([]); ends.push(0); }
		lanes[lane]!.push(clip.id);
		ends[lane] = end;
		if (lane >= 32 && ends.length >= HEAP_LANE_THRESHOLD) return cursor + 1;
	}
	return cursor;
}

function assignWidePhase<Clip extends OverlapClip>(clips: readonly Clip[], cursor: number, lanes: Clip['id'][][], ends: number[]): number {
	const available = new AvailableOverlapLanes(ends);
	for (; cursor < clips.length; cursor++) {
		const clip = clips[cursor]!;
		const start = nonNegativeFrame(clip.timelineStartFrame, `clip ${clip.id as string} timelineStartFrame`);
		const end = start + positiveFrame(clip.durationFrames, `clip ${clip.id as string} durationFrames`);
		let lane = available.take(start);
		if (lane < 0) { lane = lanes.length; lanes.push([]); ends.push(0); }
		lanes[lane]!.push(clip.id);
		ends[lane] = end;
		if (available.dormant) return cursor + 1;
		available.add(lane);
	}
	return cursor;
}

/** Exotic sorted collections retain their original iterator and validation order. */
function assignLegacySorted<Clip extends OverlapClip>(clips: readonly Clip[]): Clip['id'][][] {
	const lanes: Clip['id'][][] = [], ends: number[] = [];
	for (const clip of clips) {
		const start = nonNegativeFrame(clip.timelineStartFrame, `clip ${clip.id as string} timelineStartFrame`);
		const end = start + positiveFrame(clip.durationFrames, `clip ${clip.id as string} durationFrames`);
		let lane = ends.findIndex(previous => previous <= start);
		if (lane < 0) { lane = lanes.length; lanes.push([]); ends.push(0); }
		lanes[lane]!.push(clip.id); ends[lane] = end;
	}
	return lanes.length ? lanes : [[]];
}

/** Sample at most eight 64-clip intersections without invoking project getters.
 * A short dense prelude cannot justify adding bookkeeping to a long sparse tail.
 */
function worthWideIndex(clips: readonly OverlapClip[]): boolean {
	if (clips.length < HEAP_LANE_THRESHOLD) return false;
	for (let sample = 0; sample < 8; sample++) {
		const first = Math.floor(sample * (clips.length - HEAP_LANE_THRESHOLD) / 7);
		const last = first + HEAP_LANE_THRESHOLD - 1;
		const lastStart = ownFrame(clips, last, 'timelineStartFrame');
		if (lastStart === undefined || lastStart < 0) return false;
		let end = Infinity, intersects = true;
		for (let index = first; index <= last; index++) {
			const start = ownFrame(clips, index, 'timelineStartFrame'), duration = ownFrame(clips, index, 'durationFrames');
			if (start === undefined || start < 0 || duration === undefined || duration <= 0) return false;
			if (start > lastStart || start + duration <= lastStart) { intersects = false; break; }
			end = Math.min(end, start + duration);
		}
		if (!intersects) continue;
		let low = last + 1, high = clips.length;
		while (low < high) {
			const middle = (low + high) >>> 1, start = ownFrame(clips, middle, 'timelineStartFrame');
			if (start === undefined || start < 0) return false;
			if (start < end) low = middle + 1; else high = middle;
		}
		const candidates = low - first;
		if (candidates * candidates >= clips.length * HEAP_LANE_THRESHOLD) return true;
	}
	return false;
}

function ownFrame(clips: readonly OverlapClip[], index: number, key: string): number | undefined {
	const entry = Object.getOwnPropertyDescriptor(clips, String(index));
	if (!entry || !Object.hasOwn(entry, 'value')) return undefined;
	const clip = entry.value as unknown;
	if (!clip || typeof clip !== 'object') return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(clip, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'number'
		|| !Number.isSafeInteger(descriptor.value)) return undefined;
	return descriptor.value;
}

/** Each non-prefix lane occupies exactly one numeric heap slot, active or free. */
class AvailableOverlapLanes {
	private readonly active: number[];
	private readonly free: number[] = [];
	private releaseStart = -Infinity;
	private prefixQueries = 0;
	dormant = false;
	constructor(private readonly ends: readonly number[]) {
		this.active = Array.from({ length: ends.length - LINEAR_PREFIX }, (_, offset) => offset + LINEAR_PREFIX);
		for (let index = (this.active.length >>> 1) - 1; index >= 0; index--) siftDown(this.active, index, this.ends);
	}

	take(start: number): number {
		for (let index = 0; index < LINEAR_PREFIX; index++) if (this.ends[index]! <= start) {
			// Retire the wide index after a sparse run; a later wide linear query
			// rebuilds it from current ends rather than retaining stale entries.
			this.dormant = ++this.prefixQueries >= 32;
			return index;
		}
		this.prefixQueries = 0;
		// Getters can change validated starts after sorting.
		if (start < this.releaseStart) { this.dormant = true; return this.ends.findIndex(end => end <= start); }
		this.releaseStart = start;
		while (this.active.length && this.ends[this.active[0]!]! <= start) {
			pushHeap(this.free, popHeap(this.active, this.ends), null);
		}
		return this.free.length ? popHeap(this.free, null) : -1;
	}

	add(lane: number): void { if (lane >= LINEAR_PREFIX) pushHeap(this.active, lane, this.ends); }
}

function heapValue(lane: number, ends: readonly number[] | null): number { return ends ? ends[lane]! : lane; }

function pushHeap(heap: number[], lane: number, ends: readonly number[] | null): void {
	let index = heap.length;
	heap.push(lane);
	const value = heapValue(lane, ends);
	while (index > 0) {
		const parent = (index - 1) >>> 1, parentLane = heap[parent]!;
		if (heapValue(parentLane, ends) <= value) break;
		heap[index] = parentLane;
		index = parent;
	}
	heap[index] = lane;
}

function popHeap(heap: number[], ends: readonly number[] | null): number {
	const first = heap[0]!, last = heap.pop()!;
	if (heap.length) { heap[0] = last; siftDown(heap, 0, ends); }
	return first;
}

function siftDown(heap: number[], index: number, ends: readonly number[] | null): void {
	const lane = heap[index]!, value = heapValue(lane, ends);
	while (index * 2 + 1 < heap.length) {
		let child = index * 2 + 1;
		if (child + 1 < heap.length && heapValue(heap[child + 1]!, ends) < heapValue(heap[child]!, ends)) child++;
		if (heapValue(heap[child]!, ends) >= value) break;
		heap[index] = heap[child]!;
		index = child;
	}
	heap[index] = lane;
}
