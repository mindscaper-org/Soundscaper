/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareAutomationLaneForSchedulingV21 } from '../automation-lane-v21.ts';
import type { HoldTempoMap } from '../timeline-time.ts';
import { compileAutomationLaneEventsV21 } from './automation-lane-scheduler-v21.ts';
import type { ScheduledParameterRegistry, ScheduledParameterScheduleOptions } from './scheduled-parameter-registry.ts';

// Reuse the compiled body for every already-queued iteration. Bound synchronous
// replay work independently of the compiler's unchanged per-window event limit.
const MAXIMUM_REPLAY_EVENTS = 1_048_576;
const MAXIMUM_REPLAY_WINDOWS = 100_000;

export interface AutomationReadbackInputV21 {
	readonly lane: unknown;
	readonly registry: Pick<ScheduledParameterRegistry, 'get'>;
	readonly sampleRate: number;
	readonly contextSampleRate: number;
	readonly contextTime: number;
	readonly transportRate: number;
	readonly startFrame: number;
	/** The graph's input start, before its output/path latency. */
	readonly inputStartTime: number;
	readonly endFrame: number;
	readonly tempoMap?: HoldTempoMap;
	readonly loop?: Readonly<{ startFrame: number; endFrame: number; scheduledThroughTime: number }>;
}

/** Restore this parameter's canonical continuation without replacing its audio graph. */
export function restoreAutomationReadbackV21(input: AutomationReadbackInputV21): boolean {
	const lane = prepareAutomationLaneForSchedulingV21(input.lane);
	const target = input.registry.get(lane.address);
	if (!target) return false;
	const rate = positive(input.sampleRate, 'project sample rate') * positive(input.transportRate, 'transport rate');
	positive(input.contextSampleRate, 'context sample rate');
	const now = nonnegative(input.contextTime, 'context time');
	const started = nonnegative(input.inputStartTime, 'playback input start');
	const startFrame = frame(input.startFrame), endFrame = frame(input.endFrame);
	if (endFrame < startFrame) throw new RangeError('Automation readback requires an ordered playback window.');
	let windowStart = startFrame, windowTime = started;
	let windowEnd = endFrame, nextLoopTime = 0, repetitions = 0;
	const loop = input.loop;
	if (loop) {
		const loopStart = frame(loop.startFrame), loopEnd = frame(loop.endFrame);
		const through = nonnegative(loop.scheduledThroughTime, 'queued loop boundary');
		if (loopEnd <= loopStart || startFrame < loopStart || startFrame > loopEnd) {
			throw new RangeError('Automation readback requires a valid active loop.');
		}
		windowEnd = loopEnd;
		const firstBoundary = started + (loopEnd - startFrame) / rate;
		const period = (loopEnd - loopStart) / rate;
		if (now >= firstBoundary) {
			const iteration = Math.floor((now - firstBoundary) / period);
			windowStart = loopStart;
			windowTime = firstBoundary + iteration * period;
		}
		nextLoopTime = windowTime + (windowEnd - windowStart) / rate;
		// loopScheduleTime names the next unqueued iteration, not a window to add.
		const queuedSeconds = through - nextLoopTime - .5 / input.contextSampleRate;
		repetitions = queuedSeconds < 0 ? 0 : Math.floor(queuedSeconds / period) + 1;
		if (!Number.isSafeInteger(repetitions) || repetitions > MAXIMUM_REPLAY_WINDOWS) {
			throw new RangeError('Automation readback exceeds its bounded queued-window replay.');
		}
	}
	const currentFrame = Math.min(windowEnd, windowStart + Math.max(0, Math.floor((now - windowTime) * rate)));
	const contextStartTime = windowTime + (currentFrame - windowStart) / rate;
	const compile = (fromFrame: number, toFrame: number) => compileAutomationLaneEventsV21(lane, {
		fromFrame, toFrame, sampleRate: input.sampleRate, tempoMap: input.tempoMap, descriptor: target.descriptor,
	});
	const tail = compile(currentFrame, windowEnd);
	const body = repetitions > 0 && loop ? compile(loop.startFrame, loop.endFrame) : [];
	if (tail.length + body.length * repetitions > MAXIMUM_REPLAY_EVENTS) {
		throw new RangeError('Automation readback exceeds its bounded queued-event replay.');
	}
	const schedule = (events: typeof tail, fromFrame: number, time: number) => {
		if (input.registry.get(lane.address) !== target) {
			throw new Error('Automation readback target no longer belongs to the active graph.');
		}
		const options: ScheduledParameterScheduleOptions = {
			fromFrame, contextStartTime: time, sampleRate: input.sampleRate,
			contextSampleRate: input.contextSampleRate, transportRate: input.transportRate,
		};
		target.schedule(events, options);
	};
	// Finish all validation/compilation before canceling or replacing any events.
	schedule(tail, currentFrame, contextStartTime);
	if (loop) {
		const period = (loop.endFrame - loop.startFrame) / rate;
		for (let index = 0; index < repetitions; index++) {
			schedule(body, loop.startFrame, nextLoopTime + index * period);
		}
	}
	return true;
}

function frame(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Automation readback requires nonnegative sample frames.');
	return value;
}
function nonnegative(value: number, name: string): number {
	if (!Number.isFinite(value) || value < 0) throw new RangeError(`Automation readback requires a nonnegative ${name}.`);
	return value;
}
function positive(value: number, name: string): number {
	if (!Number.isFinite(value) || value <= 0) throw new RangeError(`Automation readback requires a positive ${name}.`);
	return value;
}
