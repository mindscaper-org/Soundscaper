/* SPDX-License-Identifier: AGPL-3.0-only */
import type { EarDeliveryPlan } from '../../../ear-delivery.ts';

export interface EarWorkerPort {
	postMessage(message: unknown): void;
	terminate(): void;
	addEventListener(type: 'message', callback: (event: MessageEvent<unknown>) => void): void;
	addEventListener(type: 'error' | 'messageerror', callback: () => void): void;
}

/** One export owns one worker; cancellation terminates calculation and mixing. */
export function renderEarInWorker(
	plan: EarDeliveryPlan,
	channels: readonly Float32Array[],
	signal: AbortSignal,
	createWorker: () => EarWorkerPort = () => new Worker(new URL('../../../ear/worker.ts', import.meta.url), { type: 'module', name: 'ebu-ear-renderer' }),
): Promise<readonly Float32Array[]> {
	if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('The EBU EAR render was cancelled.', 'AbortError'));
	return new Promise((resolve, reject) => {
		let worker: EarWorkerPort | undefined;
		let settled = false;
		const finish = (error?: unknown, output?: readonly Float32Array[]): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', abort);
			worker?.terminate();
			if (output) resolve(output); else reject(error);
		};
		const abort = (): void => finish(signal.reason ?? new DOMException('The EBU EAR render was cancelled.', 'AbortError'));
		try {
			worker = createWorker();
			signal.addEventListener('abort', abort, { once: true });
			worker.addEventListener('error', () => finish(new Error('The EBU EAR renderer worker failed.')));
			worker.addEventListener('messageerror', () => finish(new Error('The EBU EAR renderer response could not be read.')));
			worker.addEventListener('message', ({ data }) => {
				if (data && typeof data === 'object' && 'channels' in data && Array.isArray(data.channels)
					&& data.channels.length === plan.channelCount
					&& data.channels.every((channel: unknown) => channel instanceof Float32Array && channel.length === channels[0]?.length)) {
					finish(undefined, data.channels as Float32Array[]);
				} else finish(new Error(data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
					? data.error : 'The EBU EAR renderer returned invalid output.'));
			});
			if (signal.aborted) { abort(); return; }
			worker.postMessage({ plan, channels });
		} catch (error) { finish(error); }
	});
}
