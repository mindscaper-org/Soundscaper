/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAutomationLaneFrameEvaluatorV21,
	normalizeAutomationLaneV21,
	resolveAutomationLanePointFramesV21,
} from './automation-lane-v21.ts';
import type { HoldTempoMap, Rational } from './timeline-time.ts';
import { createMixerSignalTopologyV21 } from './mixer-signal-topology-v21.ts';
import { isMixerGraphV21Surface } from './mixer-graph-surface-v21.ts';

type Data = Readonly<Record<string, unknown>>;
type StripKind = 'track' | 'mixer-node';
interface Interval { readonly start: number; readonly end: number }

/** Cut-only interchange must retain edits made audible by a native Read mute lane. */
export function interchangeMuteAutomationMayOpen(project: unknown): (kind: StripKind, id: string) => boolean {
	const document = record(project);
	const lanes = records(document.automationLanes).filter(lane => {
		const address = record(lane.address);
		return address.kind === 'strip' && address.parameterId === 'mute';
	});
	if (!lanes.length) return () => false;
	const clips = new Map(records(document.clips).filter(clip => clip.kind === 'audio')
		.map(clip => [String(clip.id), clip]));
	const intervals = new Map<string, readonly Interval[]>();
	for (const track of records(document.tracks)) {
		if (track.type !== 'audio' || !Array.isArray(track.clipIds)) continue;
		const values = track.clipIds.flatMap((id: unknown) => {
			const clip = clips.get(String(id));
			const start = clip?.timelineStartFrame, duration = clip?.durationFrames;
			return typeof start === 'number' && Number.isSafeInteger(start) && start >= 0
				&& typeof duration === 'number' && Number.isSafeInteger(duration) && duration > 0
				&& Number.isSafeInteger(start + duration) ? [{ start, end: start + duration }] : [];
		});
		intervals.set(String(track.id), mergeIntervals(values));
	}
	const topology = isMixerGraphV21Surface(document.mixer)
		? createMixerSignalTopologyV21(document.mixer, { includeOutputs: false }) : null;
	const busIntervals = new Map<string, readonly Interval[]>();
	const open = new Set<string>();
	for (const value of lanes) {
		const lane = normalizeAutomationLaneV21(value);
		if (lane.address.kind !== 'strip' || lane.address.strip.kind === 'master') continue;
		const strip = lane.address.strip;
		let delivered = intervals.get(strip.id) ?? [];
		if (strip.kind === 'mixer-node') {
			delivered = busIntervals.get(strip.id) ?? mergeIntervals([...intervals].flatMap(([id, values]) => (
				topology?.reaches(`track:${id}`, `mixer-node:${strip.id}`) ? [...values] : []
			)));
			busIntervals.set(strip.id, delivered);
		}
		if (!delivered.length) continue;
		const options = { sampleRate: Number(document.sampleRate),
			...(isTempoMap(document.tempoMap) ? { tempoMap: document.tempoMap } : {}) };
		const points = resolveAutomationLanePointFramesV21(lane, options);
		const at = createAutomationLaneFrameEvaluatorV21(lane, options);
		// Mute is a discrete native parameter: its admitted segments are holds.
		// Include the inherited value at the interval start and exact changes inside it.
		let pointIndex = 0;
		if (delivered.some(({ start, end }) => {
			while (pointIndex < points.length && points[pointIndex]!.frame <= start) pointIndex++;
			if (at(start) < 1) return true;
			while (pointIndex < points.length && points[pointIndex]!.frame < end) {
				if (points[pointIndex++]!.value < 1) return true;
			}
			return false;
		})) {
			open.add(JSON.stringify([strip.kind, strip.id]));
		}
	}
	return (kind, id) => open.has(JSON.stringify([kind, id]));
}

function mergeIntervals(values: Interval[]): readonly Interval[] {
	values.sort((left, right) => left.start - right.start || left.end - right.end);
	const merged: Interval[] = [];
	for (const interval of values) {
		const last = merged.at(-1);
		if (last && interval.start <= last.end) merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, interval.end) };
		else merged.push(interval);
	}
	return merged;
}

function isTempoMap(value: unknown): value is HoldTempoMap {
	const map = record(value);
	return (map.mode === 'musical' || map.mode === 'sampleLocked') && Array.isArray(map.events)
		&& map.events.every((value: unknown) => {
			const event = record(value);
			return isRational(event.beat) && isRational(event.bpm)
				&& (map.mode !== 'sampleLocked' || Number.isSafeInteger(event.samplePosition)
					&& Number(event.samplePosition) >= 0);
		});
}
function isRational(value: unknown): value is Rational {
	const rational = record(value);
	return Number.isSafeInteger(rational.num) && Number.isSafeInteger(rational.den) && Number(rational.den) > 0;
}
function record(value: unknown): Data {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
}
function records(value: unknown): readonly Data[] {
	return Array.isArray(value) ? value.map((item: unknown) => record(item)) : [];
}
