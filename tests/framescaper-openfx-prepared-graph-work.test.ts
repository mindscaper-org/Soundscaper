/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeOpenFxExactPlaneWorkFixture, nativeOpenFxFrameWorkFixture } from './helpers/native-openfx-frame-work-fixture.ts';
import { createFramescaperSelectedOpenFxExactPlanesNativeMedia } from '../src/framescaper/selected-native-media-openfx-exact-planes.ts';
import { createFramescaperOpenFxFrameGraphNativeMedia } from '../src/framescaper/editor-openfx-frame-graph-native-media.ts';

test('owned OpenFX context/input/frame queries use target indices while preserving authored effect order', async context => {
	const { plan, foundation } = nativeOpenFxExactPlaneWorkFixture(100); let executions = 0;
	const planes = createFramescaperSelectedOpenFxExactPlanesNativeMedia({ foundationPlan: foundation, openFx: { plan,
		execute: async request => { executions += 1; assert.equal(request.instanceId, 'effect-filter-99'); return { mode: 'bypass', availability: 'missing', reportsDegradation: true }; } }, assertCurrent() {} });
	let graphVisits = 0;
	for (const method of ['some', 'flatMap', 'filter'] as const) {
		const original = Array.prototype[method];
		Object.defineProperty(Array.prototype, method, { value: function (this: unknown[], callback: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
			if (this.length >= 100 && /selected-native-media-openfx-exact-planes|editor-openfx-frame-graph-native-media/u.test(new Error().stack ?? '')) graphVisits += this.length;
			return Reflect.apply(original, this, [callback, thisArg]) as unknown;
		} });
		context.after(() => { Object.defineProperty(Array.prototype, method, { value: original }); });
	}
	for (let index = 0; index < 100; index += 1) {
		const id = index === 0 ? 'video-clip' : `video-clip-${String(index)}`;
		assert.equal(planes.has('retimer', id), false); assert.equal(planes.has('paint', id), false); assert.equal(planes.has('filter', id), true);
		assert.deepEqual(planes.inputs('filter', id), ['video-source']);
	}
	const result = await planes.apply({ context: 'filter', targetId: 'video-clip-99', outputOrdinal: plan.output.frameCount - 1,
		primary: { identity: 'video-source', frame: { width: 2, height: 2, pixels: new Uint8Array(16) } }, named: [], signal: new AbortController().signal });
	assert.equal(executions, 1); assert.equal(result.dispositions.length, 1); assert.equal(result.dispositions[0]?.instanceId, 'effect-filter-99');
	assert.equal(graphVisits, 0, 'rendered queries never revisit the entire project/effect node arrays');
});

test('generic mutable OpenFX frame graphs keep observing caller enabled-state changes', async () => {
	const plan = structuredClone(nativeOpenFxFrameWorkFixture()); let executions = 0;
	const effect = plan.nodes.find(node => node.kind === 'openfx'); assert.ok(effect?.kind === 'openfx');
	const state = effect.state as { enabled: boolean };
	const graph = createFramescaperOpenFxFrameGraphNativeMedia({ plan, assertCurrent() {},
		execute: async () => { executions += 1; return { mode: 'bypass', availability: 'missing', reportsDegradation: true }; } });
	const request = { context: 'filter' as const, targetId: 'video-clip', outputOrdinal: 0,
		primary: { identity: 'video-source', rgba: { width: 2, height: 2, pixels: new Uint8Array(16) } }, namedPlanes: [], signal: new AbortController().signal };
	state.enabled = false; await graph.apply(request); assert.equal(executions, 0);
	state.enabled = true; await graph.apply({ ...request, outputOrdinal: 1 }); assert.equal(executions, 1);
});
