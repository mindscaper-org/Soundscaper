/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readDesktopPreloadSource } from './helpers/desktop-preload-source.mjs';
import { assistanceWorkflowFixture } from './helpers/assistance-workflow-fixture.ts';
import { validateAssistanceWorkflowFenceV1 } from '../src/common/editor/assistance/workflow-fence-v1.ts';

interface Bridge {
	readonly localAssistance: { readonly workflow: { run(request: unknown): Promise<unknown> } };
}

test('the bundled preload preserves signed timeline placement and agrees with workflow admission', async () => {
	const workflow = assistanceWorkflowFixture();
	let bridge: Bridge | undefined;
	const invocations: unknown[] = [];
	vm.runInNewContext(await readDesktopPreloadSource(), {
		ArrayBuffer, Uint8Array, URL,
		require: () => ({ contextBridge: { exposeInMainWorld(name: string, value: { v1: Bridge }) {
			if (name === 'scapeDesktop') bridge = value.v1;
		} }, ipcRenderer: {
			invoke: (_channel: string, request: unknown) => {
				invocations.push(structuredClone(request));
				return Promise.resolve({ contractVersion: 1, jobId: workflow.jobId,
					workflowId: workflow.workflowId, outcome: 'consent-declined' });
			}, send() {}, on() {}, removeListener() {},
		} }),
	});
	assert.ok(bridge);
	for (const offset of [undefined, 0, 24_000, -12_000, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) {
		const { timelinePlacementOffsetFrames: _oldOffset, ...range } = workflow.fence.sourceRanges[0]!;
		const fence = { ...workflow.fence, sourceRanges: [{ ...range,
			...(offset === undefined ? {} : { timelinePlacementOffsetFrames: offset }) }] };
		await bridge.localAssistance.workflow.run({ ...workflow, fence });
		assert.deepEqual((invocations.at(-1) as { fence: unknown }).fence,
			validateAssistanceWorkflowFenceV1(fence));
	}
	for (const offset of [0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0', null]) {
		const fence = { ...workflow.fence, sourceRanges: [{ ...workflow.fence.sourceRanges[0],
			timelinePlacementOffsetFrames: offset }] };
		const before = invocations.length;
		assert.throws(() => validateAssistanceWorkflowFenceV1(fence));
		await assert.rejects(bridge.localAssistance.workflow.run({ ...workflow, fence }));
		assert.equal(invocations.length, before);
	}
});
