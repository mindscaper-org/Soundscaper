/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMixerParameterActions } from '../src/common/editor/controller/composition/internal/mixer-parameter-actions.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { ScheduledParameterRegistry } from '../src/common/editor/engine/scheduled-parameter-registry.ts';
import { scheduleAutomationLaneV21 } from '../src/common/editor/engine/automation-lane-scheduler-v21.ts';
import { engineAutomationControlMethods } from '../src/common/editor/engine/automation-control-v21.ts';
import { ENGINE_ASSERT_ACTIVE } from '../src/common/editor/engine/runtime-symbols.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';

for (const finish of ['cancel', 'unchanged'] as const) test(`static Read ${finish} returns to the authored lane continuation without an edit`, () => {
	const f = fixture();
	f.actions.beginParameterGesture(f.lane.address);
	f.actions.previewParameterGesture(f.lane.address, .5);
	f.context.currentTime = 1.5;
	if (finish === 'cancel') f.actions.cancelParameterGesture(f.lane.address);
	else f.actions.commitParameterGesture(f.lane.address, 1);
	assert.equal(f.commits(), 0);
	assert.ok(f.events.some(event => event.value === .8 && event.time === 4), 'restore the future authored gain step');
	assert.equal(f.events.at(-1)?.time, 10);
});

test('a project replacement cannot restore either old or incoming automation', () => {
	const f = fixture();
	f.actions.beginParameterGesture(f.lane.address);
	f.actions.previewParameterGesture(f.lane.address, .5);
	const before = structuredClone(f.events);
	f.replaceProject();
	assert.equal(f.actions.cancelParameterGesture(f.lane.address), false);
	assert.deepEqual(f.events, before);
	assert.equal(f.commits(), 0);
});

test('an ordinary static fader with no lane restores its existing scalar value', () => {
	const f = fixture({ withoutLane: true });
	f.actions.beginParameterGesture(f.lane.address);
	f.actions.previewParameterGesture(f.lane.address, .5);
	f.context.currentTime = 1.5;
	f.actions.cancelParameterGesture(f.lane.address);
	assert.equal(f.events.at(-1)?.value, 1);
	assert.equal(f.events.at(-1)?.time, 1.5);
	assert.equal(f.commits(), 0);
});

interface Event { value: number; time: number }
function fixture(options: Readonly<{ withoutLane?: boolean }> = {}) {
	let project = createSoundscaperProject({ id: 'static-readback', sampleRate: 48_000,
		tracks: [createAudioTrack({ id: 'voice' })], automationLanes: [{ id: 'gain',
			address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: 'a', position: 0, value: .2 },
				{ id: 'b', position: 192_000, value: .8 }, { id: 'c', position: 480_000, value: .8 }],
			segments: [{ kind: 'hold' }, { kind: 'hold' }] }] });
	const lane = project.automationLanes[0]!, events: Event[] = [];
	if (options.withoutLane) project = createSoundscaperProject({ ...project, automationLanes: [] });
	const context = { currentTime: 1, sampleRate: 48_000 };
	const registry = new ScheduledParameterRegistry();
	registry.registerAudioParam(stripParameterDescriptor(lane.address), {
		setValueAtTime(value: number, time: number) { events.push({ value, time }); },
		linearRampToValueAtTime(value: number, time: number) { events.push({ value, time }); },
		cancelScheduledValues(time: number) {
			for (let index = events.length - 1; index >= 0; index--) if (events[index]!.time >= time) events.splice(index, 1);
		},
	} as unknown as AudioParam);
	scheduleAutomationLaneV21(lane, registry, { fromFrame: 0, toFrame: 480_000, contextStartTime: 0,
		sampleRate: 48_000, contextSampleRate: 48_000, transportRate: 1 });
	const host = { context, project, graph: { parameterRegistry: registry, latencyFrames: 0 },
		state: 'playing', sampleRate: 48_000, playbackRate: 1, playbackStartFrame: 0,
		playbackStartTime: 0, playEndFrame: 480_000, loop: { enabled: false },
		get positionFrame() { return context.currentTime * 48_000; }, [ENGINE_ASSERT_ACTIVE]() {},
	};
	let commits = 0;
	const actions = createMixerParameterActions({ getProject: () => project, state: { readOnly: false },
		copy: { projectNotFound: 'No project', projectReadOnly: 'Read only' },
		engine: {
			previewScheduledParameter(address, value) {
				return engineAutomationControlMethods.previewScheduledParameter.call(host as unknown as EngineRuntimeHost, address, value);
			},
			restoreScheduledAutomationLane(value: unknown) {
				return engineAutomationControlMethods.restoreScheduledAutomationLane.call(host as unknown as EngineRuntimeHost, value);
			},
		},
		commit: () => { commits++; throw new Error('Unchanged Read gesture must not commit.'); },
	});
	return { actions, context, events, lane, commits: () => commits,
		replaceProject() { project = createSoundscaperProject({ ...project, id: 'incoming' }); } };
}
