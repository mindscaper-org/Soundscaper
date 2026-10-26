/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareAutomationLaneForSchedulingV21 } from '../automation-lane-v21.ts';
import { hasProductionMixerProjectAuthority } from '../project-schema-version.ts';
import {
	compileAutomationLaneEventsV21,
	type ScheduleAutomationLaneOptionsV21,
} from './automation-lane-scheduler-v21.ts';
import type {
	ScheduledParameterEvent,
	ScheduledParameterRegistry,
} from './scheduled-parameter-registry.ts';
import type { EngineProject } from './types.ts';

const MAXIMUM_REUSED_PROJECT_AUTOMATION_EVENTS = 16_384;

export interface ScheduledProjectAutomationLaneV21 {
	readonly laneId: string;
	readonly events: readonly ScheduledParameterEvent[];
}

/** Schedule one complete graph window after preflighting every lane target and event bound. */
export function scheduleProjectAutomationLanesV21(
	project: EngineProject,
	registry: Pick<ScheduledParameterRegistry, 'get' | 'getSuspendedParameter'>,
	options: ScheduleAutomationLaneOptionsV21,
): readonly ScheduledProjectAutomationLaneV21[] {
	if (!hasProductionMixerProjectAuthority(project)) return Object.freeze([]);
	if (!Array.isArray(project.automationLanes)) {
		throw new TypeError('A V21 project requires an automationLanes array.');
	}
	const lanes = project.automationLanes.map((value) => prepareAutomationLaneForSchedulingV21(value));
	const activeLanes = [];
	let retainedEvents = 0;
	for (const lane of lanes) {
		const target = registry.get(lane.address);
		const descriptor = target?.descriptor ?? registry.getSuspendedParameter(lane.address);
		if (!descriptor) throw new ReferenceError(`Automation lane ${lane.id} has no active graph target.`);
		const compilation = {
			fromFrame: options.fromFrame,
			toFrame: options.toFrame,
			sampleRate: options.sampleRate,
			tempoMap: options.tempoMap,
			descriptor,
			maximumEvents: options.maximumEvents,
		};
		const events = compileAutomationLaneEventsV21(lane, compilation);
		if (target) {
			// Bound additional preflight ownership even when later graph callbacks
			// invalidate prepared events. Overflow lanes retain full validation.
			const reusable = lane.timebase === 'absolute-samples'
				&& events.length <= MAXIMUM_REUSED_PROJECT_AUTOMATION_EVENTS - retainedEvents;
			if (reusable) retainedEvents += events.length;
			activeLanes.push({ lane, events: reusable ? events : null,
				compilation, tolerance: descriptor.automationTolerance });
		}
	}
	return Object.freeze(activeLanes.map(({ lane, events: prepared, compilation, tolerance }) => {
		// A preceding target can retire/rebind a later lane while publishing its
		// message. Always resolve the current handle after the atomic preflight.
		const target = registry.get(lane.address);
		if (!target) throw new ReferenceError('The automation lane target is not registered in the active audio graph.');
		const descriptor = target.descriptor;
		const reusable = prepared !== null && descriptor === compilation.descriptor
			&& Object.is(descriptor.automationTolerance, tolerance) && Object.is(options.fromFrame, compilation.fromFrame)
			&& Object.is(options.toFrame, compilation.toFrame) && Object.is(options.sampleRate, compilation.sampleRate)
			&& Object.is(options.maximumEvents, compilation.maximumEvents);
		// Absolute-sample events do not depend on mutable tempo maps. Revalidate
		// descriptor admission even when the expensive curve expansion is reused.
		if (reusable) prepareAutomationLaneForSchedulingV21(lane, { descriptor });
		const events = reusable ? prepared : compileAutomationLaneEventsV21(lane, {
			fromFrame: options.fromFrame, toFrame: options.toFrame, sampleRate: options.sampleRate,
			tempoMap: options.tempoMap, descriptor, maximumEvents: options.maximumEvents,
		});
		target.schedule(events, {
			fromFrame: options.fromFrame, contextStartTime: options.contextStartTime,
			sampleRate: options.sampleRate, contextSampleRate: options.contextSampleRate,
			transportRate: options.transportRate,
		});
		return Object.freeze({ laneId: lane.id, events });
	}));
}
