/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createAutoTuneProcessor } from '../src/common/editor/first-party-effects/auto-tune/dsp.ts';
import { instantiateStaffPadWasm } from '../src/common/editor/staffpad/wasm-instance.ts';

class ProcessorBase {
	readonly messages: unknown[] = [];
	readonly port = { onmessage: null as ((event: { data: unknown }) => void) | null,
		postMessage: (message: unknown): void => { this.messages.push(message); } };
}
Object.assign(globalThis, { AudioWorkletProcessor: ProcessorBase, sampleRate: 48000 });
const { AutoTuneWorkletProcessor } = await import('../src/common/editor/first-party-effects/auto-tune/worklet.ts');
const module = await WebAssembly.compile(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url)));

test('real Auto-Tune worklet matches the streaming kernel, accepts controls and releases native state', () => {
	const settings = { channelCount: 1, params: { retune: 0 }, staffPadWasmModule: module };
	const worklet = new AutoTuneWorkletProcessor({ processorOptions: settings });
	const reference = createAutoTuneProcessor({ sampleRate: 48000, channelCount: 1, params: settings.params,
		staffPadRuntime: instantiateStaffPadWasm(module) });
	try {
		for (let block = 0; block < 400; block++) {
			if (block === 200) {
				worklet.port.onmessage?.({ data: { type: 'configure', params: { key: 'c', scale: 'major', mix: 50 }, revision: 1 } } as MessageEvent);
				reference.updateParams({ key: 'c', scale: 'major', mix: 50 });
			}
			const input = [Float32Array.from({ length: 128 }, (_, frame) => .3 * Math.sin(2 * Math.PI * 280 * (block * 128 + frame) / 48000))];
			const actual = [new Float32Array(128)], expected = [new Float32Array(128)];
			assert.equal(worklet.process([input], [actual]), true);
			reference.processBlock(input, expected, 128);
			assert.deepEqual(actual, expected);
		}
		worklet.port.onmessage?.({ data: { type: 'reset' } } as MessageEvent);
		const output = [new Float32Array(128).fill(1)];
		assert.equal(worklet.process([[]], [output]), true);
		assert.ok(output[0]!.every(sample => sample === 0));
		worklet.port.onmessage?.({ data: { type: 'dispose' } } as MessageEvent);
		assert.equal(worklet.process([[]], [output]), false);
		assert.ok(output[0]!.every(sample => sample === 0));
	} finally { reference.dispose(); worklet.port.onmessage?.({ data: { type: 'dispose' } } as MessageEvent); }
});

test('invalid initialization and live controls fail explicitly rather than bypassing Auto-Tune', () => {
	assert.throws(() => new AutoTuneWorkletProcessor({ processorOptions: { channelCount: 1 } }), /compiled StaffPad/);
	const worklet = new AutoTuneWorkletProcessor({ processorOptions: { channelCount: 1, staffPadWasmModule: module } });
	const messages: unknown[] = [];
	worklet.port.postMessage = (value: unknown): void => { messages.push(value); };
	worklet.port.onmessage?.({ data: { type: 'configure', params: { mix: -1 } } } as MessageEvent);
	assert.match(JSON.stringify(messages), /auto-tune.mix/);
	const output = [new Float32Array(128).fill(1)];
	assert.equal(worklet.process([[]], [output]), false);
	assert.ok(output[0]!.every(sample => sample === 0));
});
