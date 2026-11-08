/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { generateWaveformPeaks } from '../src/common/editor/controller/source/waveform-analysis.ts';

for (const phase of ['start', 'chunk', 'finish']) {
	test(`background waveform cancellation terminates a worker waiting at ${phase}`, async context => {
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
		context.after(() => {
			if (previous) Object.defineProperty(globalThis, 'Worker', previous);
			else Reflect.deleteProperty(globalThis, 'Worker');
		});
		let entered!: () => void;
		const waiting = new Promise<void>(resolve => { entered = resolve; });
		let terminated = 0;
		class ProbeWorker {
			onmessage: ((event: { data: { type: string } }) => void) | null = null;
			postMessage(message: { type: string }): void {
				if (message.type === phase) { entered(); return; }
				queueMicrotask(() => { this.onmessage?.({ data: { type: message.type === 'start' ? 'ready' : 'ack' } }); });
			}
			terminate(): void { terminated += 1; }
		}
		Object.defineProperty(globalThis, 'Worker', { configurable: true, value: ProbeWorker });
		const abort = new AbortController();
		const reason = new DOMException('Project closed.', 'AbortError');
		const operation = generateWaveformPeaks([Float32Array.of(.1, .2)], {
			audioAnalysisFailed: 'Analysis failed.', audioAnalysisWorkerFailed: 'Worker failed.',
		}, 65_536, abort.signal);
		await waiting;
		abort.abort(reason);
		await assert.rejects(operation, error => error === reason);
		assert.equal(terminated, 1);
	});
}
