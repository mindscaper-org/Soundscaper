/* SPDX-License-Identifier: AGPL-3.0-only */
import { Worker as NodeWorker } from 'node:worker_threads';
import type { MidiRenderWorkerPort, } from '../../src/common/editor/engine/midi-threaded-renderer.ts';

/** Run the production synthesis runtime on a genuine second thread in focused tests. */
export class NodeMidiWorker implements MidiRenderWorkerPort {
	readonly worker: NodeWorker;
	constructor() {
		const runtime = new URL('../../src/common/editor/engine/midi-render-worker.ts', import.meta.url).href;
		this.worker = new NodeWorker(`const { parentPort } = require('node:worker_threads');
import(${JSON.stringify(runtime)}).then(({ createMidiRenderWorker }) => {
	const render = createMidiRenderWorker();
	parentPort.on('message', request => { void render(request).then(result => { parentPort.postMessage(result, result.timeline ? [result.timeline.frames.buffer, result.timeline.messages.buffer] : result.channels?.map(plane => plane.buffer) ?? []); })
	.catch(error => { parentPort.postMessage({ id: request.id, error: error.message }); }); });
});`, { eval: true });
	}
	postMessage(message: unknown): void { this.worker.postMessage(message); }
	terminate(): void { void this.worker.terminate(); }
	addEventListener(type: string, listener: (event: MessageEvent) => void): void {
		this.worker.on(type, value => { listener({ data: value } as MessageEvent); });
	}
}
