/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMidiRenderWorker, type MidiRenderWorkerRequest } from './midi-render-worker.ts';
const render = createMidiRenderWorker();
const scope = globalThis as unknown as {
	onmessage: (event: MessageEvent<MidiRenderWorkerRequest>) => void;
	postMessage(value: unknown, transfer?: Transferable[]): void;
};
scope.onmessage = ({ data }) => {
	void render(data).then(result => {
		scope.postMessage(result, result.timeline ? [result.timeline.frames.buffer, result.timeline.messages.buffer] : result.channels?.map(plane => plane.buffer) ?? []);
	}).catch((error: unknown) => {
		scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
	});
};
