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

test('project preflight validates every lane before publishing', () => {
	const packets: ScheduledParameterMessage[] = [];
	const registry = new ScheduledParameterRegistry();
	registry.registerMessageTarget(descriptor('first'), packet => { packets.push(packet); });
	registry.registerMessageTarget(descriptor('second'), packet => { packets.push(packet); });
	assert.throws(() => scheduleProjectAutomationLanesV21(project('first', 'missing'), registry, options()), /no active graph target/u);
	assert.equal(packets.length, 0);
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
