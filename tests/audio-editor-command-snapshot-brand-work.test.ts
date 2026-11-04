/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

import { snapshotInertEditorCommand } from '../src/common/editor/commands/editor-command-snapshot.ts';

test('command snapshots avoid binary getter probes on arrays and non-view typed-array probes', async (context) => {
	const bufferGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get;
	const typedGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length')!.get;
	const apply = Reflect.apply;
	let arrayProbes = 0, nonViewProbes = 0;
	context.mock.method(Reflect, 'apply', (...[target, receiver, argumentsList]: Parameters<typeof Reflect.apply>) => {
		if ((target === bufferGetter || target === typedGetter) && Array.isArray(receiver)) arrayProbes++;
		if (target === typedGetter && !ArrayBuffer.isView(receiver)) nonViewProbes++;
		const result: unknown = apply(target, receiver, argumentsList);
		return result;
	});
	// A separate module instance captures the observed intrinsic without adding
	// diagnostics to the production snapshot API.
	const moduleUrl = new URL('../src/common/editor/commands/editor-command-snapshot.ts', import.meta.url);
	moduleUrl.search = 'brand-work';
	const observed = await import(moduleUrl.href) as typeof import('../src/common/editor/commands/editor-command-snapshot.ts');
	const command = { type: 'batch', commands: Array.from({ length: 64 }, (_, index) => ({
		type: 'selection/set', selection: { clipIds: [`clip-${index}`], trackIds: [`track-${index}`] },
	})) };
	assert.deepEqual(observed.snapshotInertEditorCommand(command), command);
	assert.equal(arrayProbes, 0, 'Array admission must not throw and catch binary receiver errors.');
	assert.equal(nonViewProbes, 0, 'Only native views need a typed-array length probe.');
});

test('snapshot classification retains binary isolation, aliases, and caller-code fences', () => {
	const bytes = Uint8Array.of(1, 2, 3);
	const buffer = Uint8Array.of(4, 5).buffer;
	const shared = { value: ['retained'] };
	const command = { type: 'custom', bytes, buffer, left: shared, right: shared };
	const result = snapshotInertEditorCommand(command) as unknown as typeof command;
	assert.deepEqual(result, command);
	assert.equal(result.left, result.right);
	assert.notEqual(result.left, shared);
	assert.notEqual(result.bytes.buffer, bytes.buffer);
	assert.notEqual(result.buffer, buffer);
	bytes[0] = 99;
	new Uint8Array(buffer)[0] = 99;
	assert.equal(result.bytes[0], 1);
	assert.equal(new Uint8Array(result.buffer)[0], 4);
	const getter = { get value(): never { return assert.fail('Snapshot classification must not invoke getters.'); } };
	assert.throws(() => snapshotInertEditorCommand({ type: 'custom', getter }), /own enumerable data property/u);
});

test('native brand classification rejects disguised and unsupported binary values', () => {
	for (const value of [new ArrayBuffer(4), new Uint8Array(4), new Float32Array(4), new DataView(new ArrayBuffer(4))]) {
		Object.setPrototypeOf(value, Object.prototype);
		assert.throws(() => snapshotInertEditorCommand({ type: 'custom', value }), TypeError);
	}
	assert.throws(() => snapshotInertEditorCommand({ type: 'custom', value: new DataView(new ArrayBuffer(4)) }), /binary values/u);
	assert.throws(() => snapshotInertEditorCommand({ type: 'custom', value: new Uint16Array(4) }), /exact Uint8Array/u);
	assert.throws(() => snapshotInertEditorCommand({ type: 'custom', value: runInNewContext('[]') as unknown }), /plain array/u);
	const array = new Proxy([], { get() { assert.fail('Array metadata must be read through own descriptors.'); } });
	assert.deepEqual(snapshotInertEditorCommand({ type: 'custom', array }), { type: 'custom', array: [] });
});
