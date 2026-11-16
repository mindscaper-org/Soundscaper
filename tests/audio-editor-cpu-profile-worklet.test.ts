/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';

test('profiling boundaries preserve distinct channels, zero missing inputs and stop emitting on close', async () => {
	type Boundary = { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean };
	type Constructor = new(options: { processorOptions: { control: SharedArrayBuffer; label: string; edge: string } }) => Boundary;
	const names = ['AudioWorkletProcessor', 'registerProcessor'] as const;
	const prior = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
	const originalStamp = console.timeStamp;
	const stamps: string[] = [];
	let Registered: Constructor | undefined;
	Object.assign(globalThis, { AudioWorkletProcessor: class {}, registerProcessor: (name: string, constructor: Constructor) => {
		assert.equal(name, 'scape-cpu-boundary'); Registered = constructor;
	} });
	console.timeStamp = label => { stamps.push(String(label)); };
	try {
		await import('../src/common/editor/engine/cpu-profile-worklet.ts');
		assert.ok(Registered);
		const control = new Int32Array(new SharedArrayBuffer(4)); Atomics.store(control, 0, 1);
		const begin = new Registered({ processorOptions: { control: control.buffer, label: 'begin', edge: 'begin' } });
		const end = new Registered({ processorOptions: { control: control.buffer, label: 'end', edge: 'end' } });
		const input = [Float32Array.of(.25, -.5), Float32Array.of(.75, -.125)];
		const output = input.map(channel => new Float32Array(channel.length));
		assert.equal(begin.process([input], [output]), true);
		assert.deepEqual(output, input);
		assert.equal(end.process([input], [output]), true);
		assert.deepEqual(stamps, ['begin', 'end']);
		Atomics.store(control, 0, 0);
		begin.process([[input[0]!]], [output]);
		assert.deepEqual(output[0], input[0]); assert.deepEqual(output[1], new Float32Array(2));
		begin.process([[]], [output]);
		assert.ok(output.every(channel => channel.every(sample => sample === 0)));
		assert.deepEqual(stamps, ['begin', 'end']);
	} finally {
		console.timeStamp = originalStamp;
		for (const [index, name] of names.entries()) {
			const descriptor = prior[index];
			if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
		}
	}
});
