/* SPDX-License-Identifier: AGPL-3.0-only */

type Clip = Readonly<Record<string, unknown>>;
const EMPTY: readonly unknown[] = Object.freeze([]);
const record = (value: unknown): Clip => value && typeof value === 'object' && !Array.isArray(value) ? value as Clip : {};
const array = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : EMPTY;

/** One immutable document membership generation answers every visible bin card. */
export function createProjectBinInstanceCountReader(accept: (clip: Clip) => boolean = () => true) {
	let timeline: readonly unknown[] | null = null, bin: readonly unknown[] | null = null;
	let sourceCounts = new Map<unknown, number>();
	let clips = new Map<unknown, Clip>();
	let groups = new Map<unknown, Set<unknown>>();
	return (timelineValue: unknown, binValue: unknown, id: string, grouped = false): number | undefined => {
		const nextTimeline = array(timelineValue), nextBin = array(binValue);
		if (timeline !== nextTimeline) {
			timeline = nextTimeline;
			sourceCounts = new Map();
			for (const value of timeline) { const sourceId = record(value).sourceId; sourceCounts.set(sourceId, (sourceCounts.get(sourceId) ?? 0) + 1); }
		}
		if (bin !== nextBin) {
			bin = nextBin;
			clips = new Map(); groups = new Map();
			for (const value of bin) {
				const clip = record(value);
				if (!clips.has(clip.id)) clips.set(clip.id, clip);
				const sources = groups.get(clip.binItemId) ?? new Set<unknown>();
				sources.add(clip.sourceId); groups.set(clip.binItemId, sources);
			}
		}
		const clip = clips.get(id);
		if (!clip || !accept(clip)) return undefined;
		if (!grouped) return sourceCounts.get(clip.sourceId) ?? 0;
		let count = 0;
		for (const sourceId of groups.get(clip.binItemId) ?? []) count += sourceCounts.get(sourceId) ?? 0;
		return count;
	};
}
