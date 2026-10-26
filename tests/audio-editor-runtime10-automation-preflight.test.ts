/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { compileAutomationLaneEventsV21 } from '../src/common/editor/engine/automation-lane-scheduler-v21.ts';
import { scheduleProjectAutomationLanesV21 } from '../src/common/editor/engine/project-automation-scheduler-v21.ts';
import { ScheduledParameterRegistry, type ScheduledParameterMessage } from '../src/common/editor/engine/scheduled-parameter-registry.ts';
import { canonicalParameterAddressKey, type ParameterAddress } from '../src/common/editor/parameter-address.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

const address = (id: string): ParameterAddress => ({ kind: 'effect', strip: { kind: 'track', id: 'track' }, effectId: id, parameterId: 'mix' });
const descriptor = (id: string) => ({ id: canonicalParameterAddressKey(address(id)), address: address(id), unit: 'linear',
	minimum: 0, maximum: 1, defaultValue: 0, step: null, taper: 'linear' as const, automationTolerance: .001,
	automatable: true, latencyFrames: 7, tailFrames: 0 });
const lane = (id: string) => ({ id, address: address(id), timebase: 'absolute-samples',
	points: [{ id: `${id}-0`, position: 0, value: 0 }, { id: `${id}-1`, position: 4096, value: 1 }], segments: [{ kind: 'eased' }] });
const project = (...ids: string[]): EngineProject => ({ schemaFamily: 'soundscaper', schemaVersion: 1, mixer: {},
	automationLanes: ids.map(lane) }) as EngineProject;
const options = () => ({ fromFrame: 13, toFrame: 4000, sampleRate: 48_000, contextSampleRate: 48_000, contextStartTime: 2, maximumEvents: 1000 });

test('project preflight reuses curved event work when scheduling the admitted target', (context) => {
	const packets: ScheduledParameterMessage[] = [];
	const registry = new ScheduledParameterRegistry();
	const target = registry.registerMessageTarget(descriptor('curve'), packet => { packets.push(packet); });
	const absolute = context.mock.method(Math, 'abs');
	const expected = compileAutomationLaneEventsV21(lane('curve'), { ...options(), descriptor: target.descriptor });
	const probes = absolute.mock.callCount();
	absolute.mock.resetCalls();
	const result = scheduleProjectAutomationLanesV21(project('curve'), registry, options());
	assert.deepEqual(result, [{ laneId: 'curve', events: expected }]);
	assert.equal(packets.length, 1);
	assert.ok(probes > 30);
	assert.equal(absolute.mock.callCount(), probes, 'adaptive curve probes occur only during atomic preflight');
});

test('project preflight validates every lane before publishing and checks the current registry handle', () => {
	const packets: ScheduledParameterMessage[] = [];
	const registry = new ScheduledParameterRegistry();
	registry.registerMessageTarget(descriptor('first'), packet => { packets.push(packet); registry.unregister(address('second')); });
	registry.registerMessageTarget(descriptor('second'), packet => { packets.push(packet); });
	assert.throws(() => scheduleProjectAutomationLanesV21(project('first', 'missing'), registry, options()), /no active graph target/u);
	assert.equal(packets.length, 0);
	assert.throws(() => scheduleProjectAutomationLanesV21(project('first', 'second'), registry, options()), /not registered/u);
	assert.equal(packets.length, 1);
});

test('scheduling sees changed compilation options and newly registered descriptors', () => {
	const packets: ScheduledParameterMessage[] = [];
	const registry = new ScheduledParameterRegistry();
	const settings = options();
	registry.registerMessageTarget(descriptor('first'), () => {
		settings.fromFrame = 99;
		registry.unregister(address('second'));
		registry.registerMessageTarget({ ...descriptor('second'), automationTolerance: .1 }, packet => { packets.push(packet); });
	});
	registry.registerMessageTarget(descriptor('second'), () => { assert.fail('retired target must not receive events'); });
	const result = scheduleProjectAutomationLanesV21(project('first', 'second'), registry, settings);
	assert.deepEqual(result[1]?.events, compileAutomationLaneEventsV21(lane('second'), { ...settings, descriptor: { ...descriptor('second'), automationTolerance: .1 } }));
	assert.equal(packets[0]?.fromFrame, 99);
	assert.equal(packets[0]?.events[0]?.frameOffset, 7);
});

test('reuse revalidates a mutable descriptor before scheduling its previously admitted events', (context) => {
	const packets: ScheduledParameterMessage[] = [];
	const registry = new ScheduledParameterRegistry();
	const mutable = descriptor('second');
	registry.registerMessageTarget(descriptor('first'), packet => { packets.push(packet); mutable.maximum = .5; });
	const second = registry.registerMessageTarget(mutable, packet => { packets.push(packet); });
	context.mock.property(second, 'descriptor', mutable);
	assert.throws(() => scheduleProjectAutomationLanesV21(project('first', 'second'), registry, options()), /outside its target range/u);
	assert.equal(packets.length, 1, 'a stale preflight cannot admit an invalid later lane');
});

test('in-place tolerance edits still rebuild the affected curve', (context) => {
	const registry = new ScheduledParameterRegistry();
	const mutable = descriptor('second');
	registry.registerMessageTarget(descriptor('first'), () => { mutable.automationTolerance = .1; });
	const second = registry.registerMessageTarget(mutable, () => {});
	context.mock.property(second, 'descriptor', mutable);
	const result = scheduleProjectAutomationLanesV21(project('first', 'second'), registry, options());
	assert.deepEqual(result[1]?.events, compileAutomationLaneEventsV21(lane('second'), { ...options(), descriptor: mutable }));
	assert.ok(result[1]!.events.length < result[0]!.events.length);
});

test('musical lanes observe tempo-map edits made while earlier targets publish', () => {
	const registry = new ScheduledParameterRegistry();
	const tempoMap = { mode: 'musical' as const, events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] };
	registry.registerMessageTarget(descriptor('first'), () => { tempoMap.events[0]!.bpm.num = 60; });
	registry.registerMessageTarget(descriptor('second'), () => {});
	const musical = { ...lane('second'), timebase: 'musical-beats',
		points: [{ id: 'second-0', position: { num: 0, den: 1 }, value: 0 },
			{ id: 'second-1', position: { num: 4, den: 1 }, value: 1 }] };
	const settings = { ...options(), toFrame: 48_000, tempoMap };
	const result = scheduleProjectAutomationLanesV21({ ...project('first'), automationLanes: [lane('first'), musical] }, registry, settings);
	assert.deepEqual(result[1]?.events, compileAutomationLaneEventsV21(musical, { ...settings, descriptor: descriptor('second') }));
});

test('reuse preserves compilation rejection when a start frame becomes negative zero', () => {
	const registry = new ScheduledParameterRegistry();
	const settings = { ...options(), fromFrame: 0 };
	registry.registerMessageTarget(descriptor('first'), () => { settings.fromFrame = -0; });
	registry.registerMessageTarget(descriptor('second'), () => { assert.fail('invalid frame must not publish'); });
	assert.throws(() => scheduleProjectAutomationLanesV21(project('first', 'second'), registry, settings), /frame must be a non-negative safe integer/u);
});

test('project event reuse stays within its invocation budget and freshly compiles overflow lanes', (context) => {
	const absolute = context.mock.method(Math, 'abs');
	const expected = compileAutomationLaneEventsV21(lane('reference'), { ...options(), descriptor: descriptor('reference') });
	const probes = absolute.mock.callCount();
	const reusableLanes = Math.floor(16_384 / expected.length);
	const ids = Array.from({ length: reusableLanes + 2 }, (_, index) => `budget-${String(index)}`);
	const registry = new ScheduledParameterRegistry();
	for (const id of ids) registry.registerMessageTarget(descriptor(id), () => {});
	absolute.mock.resetCalls();
	const result = scheduleProjectAutomationLanesV21(project(...ids), registry, options());
	assert.equal(result.length, ids.length);
	for (const scheduled of result) assert.deepEqual(scheduled.events, expected);
	assert.equal(absolute.mock.callCount(), (ids.length + 2) * probes,
		'only the first 16384 preflight events can remain for reuse; overflow lanes validate then recompile');
});
