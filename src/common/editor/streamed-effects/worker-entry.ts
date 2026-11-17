/* SPDX-License-Identifier: AGPL-3.0-only */
import { runStreamedSelectionProcessing, type StreamedProcessingRequest } from './processing.ts';
import { initializePffft } from '../pffft.js';

const scope = self as unknown as {
	postMessage(data: unknown, transfer?: ArrayBuffer[]): void;
	addEventListener(type: 'message', handler: (event: { data: { type: string; id: number; channels: Float32Array[]; request: StreamedProcessingRequest } }) => void): void;
};
let sequence = 0, running = false;
const replies = new Map<number, (channels: Float32Array[]) => void>();
function exchange(message: Record<string, unknown>, transfer: ArrayBuffer[] = []): Promise<Float32Array[]> {
	if (replies.size >= 2) throw new Error('Streamed worker exceeded its packet bound.');
	const id = ++sequence;
	return new Promise(resolve => { replies.set(id, resolve); scope.postMessage({ ...message, id }, transfer); });
}
scope.addEventListener('message', ({ data }) => {
	if (data.type === 'reply' && replies.has(data.id)) { const resolve = replies.get(data.id)!; replies.delete(data.id); resolve(data.channels); return; }
	if (data.type !== 'render' || running) return;
	running = true;
	void (async () => {
		try {
			if (data.request.effects.some(effect => ['audacity-filter-curve-eq', 'audacity-graphic-eq', 'audacity-noise-reduction'].includes(effect.type))) await initializePffft();
			await runStreamedSelectionProcessing(data.request, {
				assertCurrent: () => undefined, yieldToMainThread: false,
				read: (start, end) => exchange({ type: 'read', start, end }),
				readControl: (start, end) => exchange({ type: 'read', start, end, control: true }),
				write: async channels => { await exchange({ type: 'write', channels }, [...new Set(channels.map(channel => channel.buffer as ArrayBuffer))]); },
			});
			scope.postMessage({ type: 'result' });
		} catch (error) { scope.postMessage({ type: 'error', name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) }); }
	})();
});
