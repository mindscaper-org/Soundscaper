/* SPDX-License-Identifier: AGPL-3.0-only */
import { WorkerRequestBroker } from '../../../../worker-request-broker.ts';
import { STREAMED_EFFECT_CHUNK_FRAMES } from '../../../../streamed-effects/admission.ts';
import type { StreamedProcessingRequest, StreamedProcessingPorts } from '../../../../streamed-effects/processing.ts';
import { assertAudacityEffectOutput } from '../../../../audacity-effects/pcm-channel-validation.ts';

interface WorkerPort {
	postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
	addEventListener(type: string, listener: (event: { data?: unknown; error?: Error; message?: string }) => void): void;
	terminate(): void;
}
type CreateWorker = (url: URL) => WorkerPort;
/** The worker pulls one PCM packet and acknowledges one write at a time. Late I/O is fenced after termination. */
export async function runStreamedEffectWorker(request: StreamedProcessingRequest, ports: StreamedProcessingPorts, signal: AbortSignal,
	createWorker?: CreateWorker | null): Promise<void> {
	signal.throwIfAborted(); ports.assertCurrent();
	if (createWorker === null || !createWorker && typeof Worker === 'undefined') {
		const { runStreamedSelectionProcessing } = await import('../../../../streamed-effects/processing.ts');
		const { initializePffft } = await import('../../../../pffft.js'); if (request.effects.some(effect => ['audacity-filter-curve-eq', 'audacity-graphic-eq', 'audacity-noise-reduction'].includes(effect.type))) await initializePffft();
		await runStreamedSelectionProcessing(request, { ...ports, assertCurrent: () => { signal.throwIfAborted(); ports.assertCurrent(); } }); return;
	}
	const worker = createWorker ? createWorker(new URL('../../../../streamed-effects/worker-entry.ts', import.meta.url))
		: new Worker(new URL('../../../../streamed-effects/worker-entry.ts', import.meta.url), { type: 'module', name: 'selection-effect-stream' });
	const broker = new WorkerRequestBroker();
	let closed = false, written = 0;
	const busy = new Set<string>();
	const fail = (error: unknown): void => { broker.reject('stream', error); };
	worker.addEventListener('error', event => fail(event.error ?? new Error(event.message ?? 'Streamed effect worker failed.')));
	worker.addEventListener('messageerror', () => fail(new Error('Invalid streamed effect worker message.')));
	worker.addEventListener('message', event => { void handle(event.data).catch(fail); });
	function current(): void { signal.throwIfAborted(); ports.assertCurrent(); if (closed) throw new DOMException('Effect stream closed.', 'AbortError'); }
	async function handle(value: unknown): Promise<void> {
		if (closed) return;
		current(); broker.touch('stream');
		const data = value as { type?: string; id?: number; start?: number; end?: number; control?: boolean; channels?: Float32Array[]; message?: string; name?: string };
		if (data?.type === 'error') { const error = new Error(data.message ?? 'Effect processing failed.'); error.name = data.name ?? 'Error'; throw error; }
		if (data?.type === 'result') { if (busy.size || written !== request.frameCount) throw new RangeError('Incomplete streamed worker output.'); broker.resolve('stream', undefined); return; }
		if (!data?.type || busy.has(data.type) || !Number.isSafeInteger(data.id)) throw new RangeError('Unexpected concurrent streamed effect packet.');
		busy.add(data.type);
		try {
			if (data.type === 'read') {
				const start = data.start!, end = data.end!;
				if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > request.frameCount || end - start > STREAMED_EFFECT_CHUNK_FRAMES) throw new RangeError('Invalid streamed worker read.');
				const read = data.control ? ports.readControl : ports.read;
				if (!read) throw new Error('Streamed detector reader missing.');
				const channels = [...await read(start, end)]; current();
				if ((data.control ? channels.length < 1 || channels.length > 32 : channels.length !== request.channelCount) || channels.some(channel => channel.length !== end - start)) throw new RangeError('Invalid streamed PCM read.');
				assertAudacityEffectOutput(channels);
				worker.postMessage({ type: 'reply', id: data.id, channels }, [...new Set(channels.map(channel => channel.buffer as ArrayBuffer))]);
			} else if (data.type === 'write') {
				const channels = data.channels; assertAudacityEffectOutput(channels);
				if (!channels || channels.length !== request.channelCount || channels[0]!.length > STREAMED_EFFECT_CHUNK_FRAMES || channels[0]!.length < 1
					|| written + channels[0]!.length > request.frameCount) throw new RangeError('Invalid streamed worker output packet.');
				await ports.write(channels); current(); written += channels[0]!.length;
				worker.postMessage({ type: 'reply', id: data.id });
			} else throw new RangeError('Unknown streamed effect worker message.');
			broker.touch('stream');
		} finally { busy.delete(data.type!); }
	}
	try {
		await broker.request<void>({ id: 'stream', signal, post: () => worker.postMessage({ type: 'render', request }) });
		current();
	} finally { closed = true; worker.terminate(); broker.dispose(); }
}
