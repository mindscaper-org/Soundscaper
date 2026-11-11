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

export function scheduleAutoTuneControls(project: EngineProject, registry: ScheduledParameterRegistry | null,
	options: Readonly<{ fromFrame: number; toFrame: number; contextStartTime: number; sampleRate: number; contextSampleRate: number; transportRate: number }>): void {
	if (!registry) return;
	for (const target of targets.get(registry) ?? []) {
		const frames = Math.max(1, Math.round((options.toFrame - options.fromFrame) * options.contextSampleRate / options.sampleRate / options.transportRate));
		const origin = Math.round(options.contextStartTime * options.contextSampleRate) + target.latencyFrames;
		const notes = autoTuneControlNotes(project, target.trackId, options.fromFrame, frames, options.contextSampleRate / options.transportRate)
			.map(note => ({ ...note, startFrame: note.startFrame + origin, endFrame: note.endFrame + origin }));
		target.port.postMessage({ type: 'control-notes', notes, fromFrame: origin, toFrame: origin + frames });
	}
}
