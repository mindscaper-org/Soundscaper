/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { StreamingRecorderProcessor } from '../src/common/editor/recording-worklet.js';
import { createRecordingController } from '../src/common/editor/recording.js';
import { RecordingInputLossError, handleRecordingInputEvent } from '../src/common/editor/recording-input-events.ts';

interface Port {
	postMessage(message: Record<string, unknown>): void;
	onmessage(event: { data: Record<string, unknown> }): void;
}

function processorFixture(startFrame = 0, stopFrame?: number) {
	const previousRate: unknown = Reflect.get(globalThis, 'sampleRate');
	Reflect.set(globalThis, 'sampleRate', 128);
	const processor = new StreamingRecorderProcessor({ processorOptions: { channelCount: 1, chunkFrames: 128 } });
	if (previousRate === undefined) Reflect.deleteProperty(globalThis, 'sampleRate');
	else Reflect.set(globalThis, 'sampleRate', previousRate);
	const messages: Record<string, unknown>[] = [];
	const port = processor.port as unknown as Port;
	port.postMessage = message => {
		messages.push(message);
		if (message.type === 'audio-chunk') port.onmessage({ data: { type: 'chunk-ack', chunkId: message.chunkId } });
	};
	port.onmessage({ data: { type: 'start', startFrame, stopFrame } });
	return {
		messages,
		process(available: boolean, seconds = 1) {
			for (let index = 0; index < seconds; index += 1) {
				processor.process([available ? [new Float32Array(128)] : []], [[new Float32Array(128)]]);
			}
		},
	};
}

test('absent input-channel delivery recovers within grace and then stops a sustained outage', () => {
	const fixture = processorFixture();
	fixture.process(true); fixture.process(false, 4); fixture.process(true);
	assert.equal(fixture.messages.some(message => message.type === 'input-lost'), false);
	fixture.process(false, 5);
	assert.equal(fixture.messages.filter(message => message.type === 'input-lost').length, 1);
	assert.equal(fixture.messages.filter(message => message.type === 'stopped').length, 1);
	assert.deepEqual(fixture.messages.filter(message => message.type === 'input-status').map(message => message.available), [false, true, false]);
});

test('valid digital silence is present input and never triggers loss', () => {
	const fixture = processorFixture(); fixture.process(true, 20);
	assert.equal(fixture.messages.some(message => message.type === 'input-lost' || message.type === 'input-status'), false);
});

test('the absence grace starts at scheduled capture and respects an earlier scheduled stop', () => {
	const waiting = processorFixture(128 * 10);
	waiting.process(false, 10);
	assert.equal(waiting.messages.some(message => message.type === 'input-status'), false);
	waiting.process(false, 4);
	assert.equal(waiting.messages.some(message => message.type === 'input-lost'), false);
	waiting.process(false);
	assert.equal(waiting.messages.filter(message => message.type === 'input-lost').length, 1);
	const ending = processorFixture(0, 128 * 2); ending.process(false, 10);
	assert.equal(ending.messages.filter(message => message.type === 'stopped').length, 1);
	assert.equal(ending.messages.some(message => message.type === 'input-lost'), false);
});

test('input-presence diagnostics contain throwing observers and identify terminal physical loss', () => {
	assert.doesNotThrow(() => handleRecordingInputEvent({ type: 'input-status', available: false }, () => {}, () => { throw new Error('logger failed'); }));
	let failure: RecordingInputLossError | undefined;
	assert.equal(handleRecordingInputEvent({ type: 'input-lost' }, error => { failure = error; }), true);
	assert.ok(failure instanceof RecordingInputLossError);
	assert.equal(failure.code, 'RECORDING_INPUT_LOST');
});

test('terminal no-channel loss drains accepted recording chunks before rejecting stop', async () => {
	const writes: unknown[] = [], errors: unknown[] = [];
	const node = {
		port: { onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null, postMessage() {}, start() {} },
		connect() {}, disconnect() {},
	};
	const controller = await createRecordingController({
		context: { audioWorklet: { async addModule() {} }, createMediaStreamSource: () => ({ connect() {}, disconnect() {} }), destination: {} },
		stream: { getTracks: () => [] }, nodeFactory: () => node,
		onChunk: async (chunk: unknown) => { writes.push(chunk); }, onError: (error: unknown) => { errors.push(error); },
	} as never);
	controller.start();
	node.port.onmessage?.({ data: { type: 'audio-chunk', frames: 1, frameStart: 0, channels: [Float32Array.of(0.25)] } });
	node.port.onmessage?.({ data: { type: 'input-lost' } });
	const stopping = controller.stop();
	node.port.onmessage?.({ data: { type: 'stopped', frame: 1 } });
	await assert.rejects(stopping, RecordingInputLossError);
	assert.equal(writes.length, 1); assert.equal(errors.length, 1);
	await controller.dispose();
});
