/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionPreviewWorkerRuntime } from '../src/common/editor/motion-preview-worker-runtime.ts';
import type { MotionPreviewWorkerRequest, MotionPreviewWorkerResponse, MotionPreviewWorkerScope } from '../src/common/editor/motion-preview-worker-protocol.ts';
import type { MotionPreviewFrame } from '../src/common/editor/controller/composition/motion-preview-types.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';

const project = createMotionscaperProject({ id: 'runtime-progress', title: 'Runtime progress', compositionId: 'main', width: 16, height: 16 });
const frame: MotionPreviewFrame = { width: 16, height: 16, rgba: new Uint8ClampedArray(1024), time: { num: 0, den: 1 }, compositionId: 'main', revision: 0, generation: 1, backend: 'worker-cpu' };
async function reactions(): Promise<void> { for (let index = 0; index < 6; index++) await Promise.resolve(); }

test('Motion worker publishes coalesced completed work only for the active render', async context => {
	const target = new EventTarget(); const messages: MotionPreviewWorkerResponse[] = []; let now = 0;
	const renders: { progress: () => void; signal: AbortSignal; resolve(frame: MotionPreviewFrame): void; reject(error: Error): void }[] = [];
	const scope: MotionPreviewWorkerScope = {
		postMessage(message) { messages.push(message); },
		addEventListener(type, listener) { target.addEventListener(type, listener as EventListener); },
		removeEventListener(type, listener) { target.removeEventListener(type, listener as EventListener); },
	};
	const runtime = createMotionPreviewWorkerRuntime(scope, () => ({
		setProject() { return Promise.resolve('worker-cpu'); },
		render(_request, signal, onProgress) { assert.ok(onProgress); return new Promise((resolve, reject) => { renders.push({ progress: onProgress, signal, resolve, reject }); }); },
		dispose() {},
	}), () => now);
	context.after(() => runtime.dispose());
	const send = (message: MotionPreviewWorkerRequest) => target.dispatchEvent(new MessageEvent('message', { data: message }));
	send({ type: 'project', requestId: 1, project, maximumAssetBytes: 1024, maximumWorkingBytes: 1024 * 1024, hasFootageDecoder: false }); await reactions();
	assert.deepEqual(messages, [{ type: 'ready', requestId: 1, backend: 'worker-cpu' }]);
	send({ type: 'render', requestId: 2, compositionId: 'main', time: { num: 0, den: 1 }, generation: 1 }); await reactions();
	const first = renders[0]; assert.ok(first);
	first.progress(); for (let index = 0; index < 10; index++) first.progress();
	assert.deepEqual(messages.at(-1), { type: 'progress', requestId: 2, sequence: 1, completedWork: 1 });
	now = 1000; assert.equal(messages.length, 2, 'Elapsed time alone must never publish a heartbeat.');
	first.progress(); assert.deepEqual(messages.at(-1), { type: 'progress', requestId: 2, sequence: 2, completedWork: 12 });
	send({ type: 'cancel', requestId: 2 }); await reactions(); assert.equal(first.signal.aborted, true);
	now = 2000; first.progress(); assert.equal(messages.length, 3);
	first.reject(new DOMException('Cancelled', 'AbortError')); await reactions();
	assert.equal(messages.at(-1)?.type, 'error');
	send({ type: 'render', requestId: 3, compositionId: 'main', time: { num: 0, den: 1 }, generation: 2 }); await reactions();
	const second = renders[1]; assert.ok(second);
	first.progress(); assert.equal(messages.length, 4, 'A late checkpoint from the prior render cannot extend its replacement.');
	second.progress(); assert.deepEqual(messages.at(-1), { type: 'progress', requestId: 3, sequence: 1, completedWork: 1 });
	second.resolve({ ...frame, generation: 2 }); await reactions(); assert.equal(messages.at(-1)?.type, 'frame');
	now = 3000; second.progress(); assert.equal(messages.length, 6, 'Completed frames no longer publish work.');
});
