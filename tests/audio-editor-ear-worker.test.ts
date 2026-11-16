/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderEarInWorker, type EarWorkerPort } from '../src/common/editor/controller/export/internal/ear-render-worker-client.ts';
import { resolveEarDelivery } from '../src/common/editor/ear-delivery.ts';

const plan = resolveEarDelivery({ mode: 'authored', programme: { name: 'Programme', language: 'eng' }, content: { name: 'Content', language: 'eng' }, bed: { name: 'Bed', layout: 'mono', assignments: [] } },
	{ mode: 'mix', format: 'wav', earLayout: 'stereo' })!;

function fixture() {
	let terminated = 0;
	let sent: unknown;
	const listeners = new Map<string, (event?: unknown) => void>();
	const port = {
		postMessage(message: unknown) { sent = message; },
		terminate() { terminated += 1; },
		addEventListener(type: string, callback: (event?: unknown) => void) { listeners.set(type, callback); },
	} as unknown as EarWorkerPort;
	return { port, get terminated() { return terminated; }, get sent() { return sent; },
		message(data: unknown) { listeners.get('message')?.({ data }); },
		fail() { listeners.get('error')?.(); },
	};
}

test('EAR worker returns the exact channel geometry and terminates after success', async () => {
	const worker = fixture();
	const inputs = [new Float32Array([0.5])];
	const pending = renderEarInWorker(plan, inputs, new AbortController().signal, () => worker.port);
	assert.deepEqual(worker.sent, { plan, channels: inputs });
	worker.message({ channels: [new Float32Array([0.25]), new Float32Array([0.25])] });
	assert.equal((await pending).length, 2);
	assert.equal(inputs[0]![0], 0.5);
	assert.equal(worker.terminated, 1);
});

test('EAR cancellation and worker failures reject without publishing partial audio', async () => {
	for (const failure of ['abort', 'error', 'malformed', 'refusal'] as const) {
		const worker = fixture();
		const abort = new AbortController();
		const pending = renderEarInWorker(plan, [new Float32Array(2)], abort.signal, () => worker.port);
		if (failure === 'abort') abort.abort();
		else if (failure === 'error') worker.fail();
		else if (failure === 'malformed') worker.message({ channels: [new Float32Array(1)] });
		else worker.message({ error: 'Unsupported ADM' });
		await assert.rejects(pending);
		assert.equal(worker.terminated, 1);
		worker.message({ channels: [new Float32Array(2), new Float32Array(2)] });
		assert.equal(worker.terminated, 1);
	}
	const abort = new AbortController(); abort.abort();
	await assert.rejects(renderEarInWorker(plan, [], abort.signal, () => { throw new Error('must not start'); }), { name: 'AbortError' });
});
