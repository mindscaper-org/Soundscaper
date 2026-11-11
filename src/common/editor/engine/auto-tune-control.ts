/* SPDX-License-Identifier: AGPL-3.0-only */

import { autoTuneControlNotes } from '../first-party-effects/auto-tune/project-control.ts';
import type { EngineProject } from './types.ts';
import type { ScheduledParameterRegistry } from './scheduled-parameter-registry.ts';

interface ControlTarget {
	readonly port: Pick<MessagePort, 'postMessage'>;
	readonly trackId: string;
	readonly latencyFrames: number;
}
const targets = new WeakMap<ScheduledParameterRegistry, ControlTarget[]>();

/** Each graph owns its MIDI schedules; sibling graphs in one context never
 * receive each other's seek, render or loop windows. */
export function registerAutoTuneControl(registry: ScheduledParameterRegistry | undefined,
	port: Pick<MessagePort, 'postMessage'>, trackId: string, latencyFrames: number): void {
	if (!registry || !trackId) return;
	const entries = targets.get(registry) ?? [];
	entries.push({ port, trackId, latencyFrames });
	targets.set(registry, entries);
}

interface ControlWindow {
	readonly fromFrame: number;
	readonly toFrame: number;
	readonly contextStartTime: number;
	readonly sampleRate: number;
	readonly contextSampleRate: number;
	readonly transportRate: number;
}
const offlinePlans = new WeakMap<object, Readonly<{ project: EngineProject; windows: readonly ControlWindow[] }>>();

/** Offline processors must have their controls before the first render quantum. */
export function setOfflineAutoTuneControlWindows(context: Readonly<{ sampleRate: number }>, project: EngineProject,
	ranges: readonly Readonly<{ startFrame: number; endFrame: number }>[], sampleRate: number): void {
	let contextStartTime = 0;
	const windows = ranges.map(range => {
		const window = { fromFrame: range.startFrame, toFrame: range.endFrame, contextStartTime,
			sampleRate, contextSampleRate: context.sampleRate, transportRate: 1 };
		contextStartTime += (range.endFrame - range.startFrame) / sampleRate;
		return window;
	});
	offlinePlans.set(context, { project, windows });
}

export function initialAutoTuneControlSchedules(context: object, trackId: string, latencyFrames: number) {
	const plan = offlinePlans.get(context);
	return plan && trackId ? plan.windows.map(window => controlSchedule(plan.project, trackId, latencyFrames, window)) : [];
}

export function scheduleAutoTuneControls(project: EngineProject, registry: ScheduledParameterRegistry | null,
	options: ControlWindow): void {
	if (!registry) return;
	for (const target of targets.get(registry) ?? []) {
		target.port.postMessage(controlSchedule(project, target.trackId, target.latencyFrames, options));
	}
}

function controlSchedule(project: EngineProject, trackId: string, latencyFrames: number, options: ControlWindow) {
	const frames = Math.max(1, Math.round((options.toFrame - options.fromFrame) * options.contextSampleRate / options.sampleRate / options.transportRate));
	const origin = Math.round(options.contextStartTime * options.contextSampleRate) + latencyFrames;
	const notes = autoTuneControlNotes(project, trackId, options.fromFrame, frames, options.contextSampleRate / options.transportRate)
		.map(note => ({ ...note, startFrame: note.startFrame + origin, endFrame: note.endFrame + origin }));
	return { type: 'control-notes' as const, notes, fromFrame: origin, toFrame: origin + frames };
}
