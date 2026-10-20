/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import {
	roundScheduledParameterContextFrameOffset,
	ScheduledParameterRegistry,
	type ScheduledParameterMessage,
} from '../src/common/editor/engine/scheduled-parameter-registry.ts';

function observe(operation: () => number): number | { error: { name: string; message: string } } {
	try { return operation(); } catch (error) {
		assert.ok(error instanceof Error);
		return { error: { name: error.name, message: error.message } };
	}
}

const receipt = JSON.parse(readFileSync(new URL('./fixtures/responsiveness-round4-frame-parity.json', import.meta.url), 'utf8')) as {
	cases: readonly { inputs: [number, number, number, number, number, number]; result: ReturnType<typeof observe> }[];
};

test('public parameter offsets match 157 frozen original conversions and refusals', () => {
	for (const { inputs, result } of receipt.cases) {
		assert.deepEqual(observe(() => roundScheduledParameterContextFrameOffset(...inputs)), result);
	}
});

test('uncounted message targets retain per-event standalone conversion and complete immutable packets', () => {
	const descriptor = stripParameterDescriptor({ kind: 'strip', strip: { kind: 'track', id: 'track' }, parameterId: 'pan' }, 32);
	const packets: ScheduledParameterMessage[] = [];
	const target = new ScheduledParameterRegistry().registerMessageTarget(descriptor, packet => { packets.push(packet); });
	const events = Array.from({ length: 1000 }, (_, frame) => ({ kind: 'set' as const, frame, value: 0 }));
	target.schedule(events, { fromFrame: 0, contextStartTime: 0, sampleRate: 44_100, contextSampleRate: 48_000, transportRate: 1.2 });
	assert.equal(packets.length, 1);
	const packet = packets[0]!;
	assert.ok(Object.isFrozen(packet) && Object.isFrozen(packet.events) && packet.events.every(Object.isFrozen));
	assert.deepEqual(packet.events[0], { kind: 'set', frameOffset: 32, value: 0 });
	assert.deepEqual(packet.events.at(-1), { kind: 'set', frameOffset: 938, value: 0 });
	events[0]!.value = .5;
	assert.equal(packet.events[0]!.value, 0);
});
