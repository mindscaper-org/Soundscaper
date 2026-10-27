/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { scheduleProjectAutomationLanesV21 } from '../src/common/editor/engine/project-automation-scheduler-v21.ts';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { ScheduledParameterRegistry, type ScheduledParameterMessage } from '../src/common/editor/engine/scheduled-parameter-registry.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

test('real current playback windows reuse admitted curves while scheduling every exact registry message', () => {
	const tracks = 8, points = 1000, sampleRate = 48_000;
	const project = projectForRuntimeConsumers(createSoundscaperProject({ id: 'playback-automation-work',
		sources: [{ id: 'source', storageKey: 'source', sampleRate, frameCount: sampleRate, channelCount: 1 }],
		clips: [{ id: 'clip', sourceId: 'source', sourceStartFrame: 0, sourceDurationFrames: sampleRate, durationFrames: sampleRate, timelineStartFrame: 0 }],
		tracks: Array.from({ length: tracks }, (_, index) => ({ id: `track-${index}`, clipIds: index === 0 ? ['clip'] : [] })),
		automationLanes: Array.from({ length: tracks }, (_, index) => normalizeAutomationLaneV21({ id: `lane-${index}`,
			address: { kind: 'strip', strip: { kind: 'track', id: `track-${index}` }, parameterId: 'gain' }, timebase: 'absolute-samples',
			points: Array.from({ length: points }, (_, point) => ({ id: `point-${point}`, position: point * 48, value: point % 2 ? 0.8 : 0.5 })),
			segments: Array.from({ length: points - 1 }, () => ({ kind: 'linear' })) })) }));
	const registry = new ScheduledParameterRegistry(), messages: ScheduledParameterMessage[] = [];
	for (const lane of project.automationLanes) registry.registerMessageTarget(stripParameterDescriptor(lane.address, 0), message => { messages.push(message); });
	const descriptor = Object.getOwnPropertyDescriptor;
	let reads = 0;
	Object.getOwnPropertyDescriptor = function(value: unknown, key: PropertyKey) {
		if (key === 'position' && value && typeof value === 'object' && Object.hasOwn(value, 'id') && Object.hasOwn(value, 'value')) reads++;
		return descriptor(value, key);
	};
	try {
		for (let window = 0; window < 5; window++) {
			const output = scheduleProjectAutomationLanesV21(project as unknown as EngineProject, registry,
				{ fromFrame: 0, toFrame: 48, contextStartTime: window * 0.001, sampleRate, contextSampleRate: sampleRate });
			assert.deepEqual(output, project.automationLanes.map(lane => ({ laneId: lane.id,
				events: [{ kind: 'set', frame: 0, value: 0.5 }, { kind: 'linear', frame: 48, value: 0.8 }] })));
		}
		assert.equal(reads, 0, `${reads} detached admitted point-position descriptor reads`);
	} finally { Object.getOwnPropertyDescriptor = descriptor; }
	assert.deepEqual(messages, Array.from({ length: 5 }, (_, window) => project.automationLanes.map(lane => ({
		type: 'schedule-parameter-v1', revision: window + 1, address: lane.address, fromFrame: 0,
		contextStartTime: window * 0.001, sampleRate, contextSampleRate: sampleRate, transportRate: 1,
		events: [{ kind: 'set', frameOffset: 0, value: 0.5 }, { kind: 'linear', frameOffset: 48, value: 0.8 }],
	}))).flat());
});
