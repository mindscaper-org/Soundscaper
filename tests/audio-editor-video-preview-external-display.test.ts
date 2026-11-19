/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	FramescaperNativeServicesBridge,
} from '../src/common/editor/ui/framescaper-native-services-bridge.ts';
import {
	framescaperNativeServicesStoreFor,
} from '../src/common/editor/ui/framescaper-native-services-bridge.ts';
import {
	publishEvaluatedVideoPreviewFrame,
} from '../src/common/editor/ui/workspace/video-preview-external-display.ts';
import { deferred, waitFor } from './helpers/async-test-control.ts';

const DISPLAY = Object.freeze({
	displayId: 'display-2', label: 'Programme', primary: false,
	width: 1_920, height: 1_080, hdrCapable: false, colorManaged: false,
});

test('the active display receives the preview evaluator bytes once with exact backpressure', async () => {
	const presented: Readonly<Record<string, unknown>>[] = [];
	let release: (() => void) | null = null;
	const bridge = fakeBridge('display-2', (request) => {
		presented.push(request as Readonly<Record<string, unknown>>);
		return new Promise((resolve) => { release = () => resolve({
			displays: [DISPLAY], activeDisplayId: 'display-2',
		}); });
	});
	await framescaperNativeServicesStoreFor(bridge).refresh();
	const captures: Uint8Array[] = [];
	const compositor = { captureEvaluatedRgba: () => {
		const rgba = Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255);
		captures.push(rgba);
		return { width: 2, height: 1, rgba };
	} };
	const project = { id: 'project-1', revision: 8 };
	const preview = { compositor, project, currentProject: () => project };
	const dependencies = { resolveBridge: () => bridge };

	assert.equal(publishEvaluatedVideoPreviewFrame({
		...preview, timelineFrame: 48_000,
	}, dependencies), true);
	assert.equal(publishEvaluatedVideoPreviewFrame({
		...preview, timelineFrame: 48_001,
	}, dependencies), false);
	assert.equal(captures.length, 1, 'a backpressured frame is dropped before framebuffer readback');
	await waitFor(() => presented.length === 1, 'first clean-display submission');
	assert.equal(presented.length, 1);
	assert.equal(presented[0]?.rgba, captures[0], 'the compositor-owned readback is published directly');
	assert.equal(presented[0]?.sequence, 0);
	assert.equal(presented[0]?.dynamicRange, 'sdr');
	assert.match(String(presented[0]?.rgbaSha256), /^[a-f0-9]{64}$/u);
	assert.match(String(presented[0]?.evaluationFingerprint), /^[a-f0-9]{64}$/u);

	(release as unknown as () => void)();
	await turn();
	assert.equal(publishEvaluatedVideoPreviewFrame({
		...preview, timelineFrame: 48_001,
	}, dependencies), true);
	await waitFor(() => presented.length === 2, 'next clean-display submission');
	assert.equal(presented[1]?.sequence, 1);
	assert.notEqual(presented[1]?.evaluationFingerprint, presented[0]?.evaluationFingerprint);
	(release as (() => void) | null)?.();
	await turn();
});

test('a display restart and a project revision each retire a frame whose digest is pending', async (context) => {
	const projection = { displays: [DISPLAY], activeDisplayId: 'display-2' };
	let presented = 0;
	const opening = deferred<typeof projection>();
	const bridge = { ...fakeBridge('display-2', async () => { presented++; return projection; }),
		setExternalDisplay: () => opening.promise };
	const store = framescaperNativeServicesStoreFor(bridge);
	await store.refresh();
	let project = { id: 'project-1', revision: 1 };
	let digest = deferred<ArrayBuffer>();
	const nativeDigest = context.mock.method(globalThis.crypto.subtle, 'digest', () => digest.promise);
	const compositor = { captureEvaluatedRgba: () => ({ width: 1, height: 1, rgba: Uint8Array.of(1, 2, 3, 255) }) };
	const submit = () => publishEvaluatedVideoPreviewFrame({
		compositor, project, currentProject: () => project, timelineFrame: 0,
	}, { resolveBridge: () => bridge });

	assert.equal(submit(), true);
	assert.equal(presented, 0, 'pixel hashing must finish before the frame is submitted');
	assert.equal(nativeDigest.mock.callCount(), 1);
	const changingDisplay = store.setExternalDisplay('display-2');
	digest.resolve(new ArrayBuffer(32));
	await turn();
	assert.equal(presented, 0, 'a reopened display must not acquire the earlier frame');
	assert.equal(submit(), false, 'capture stays paused while the new display is opening');
	opening.resolve(projection);
	await changingDisplay;

	digest = deferred<ArrayBuffer>();
	assert.equal(submit(), true);
	project = { ...project, revision: 2 };
	digest.resolve(new ArrayBuffer(32));
	await turn();
	assert.equal(presented, 0, 'an edited project must not publish its retired frame');

	assert.equal(submit(), true);
	await waitFor(() => presented === 1, 'current frame after retirement');
});

test('no display session means no framebuffer capture or publication', async () => {
	let presented = 0;
	let captures = 0;
	const bridge = fakeBridge(null, async () => {
		presented += 1;
		return { displays: [DISPLAY], activeDisplayId: null };
	});
	await framescaperNativeServicesStoreFor(bridge).refresh();
	const project = { id: 'project-1', revision: 0 };
	assert.equal(publishEvaluatedVideoPreviewFrame({
		compositor: { captureEvaluatedRgba: () => {
			captures += 1;
			return { width: 1, height: 1, rgba: Uint8Array.of(0, 0, 0, 255) };
		} },
		project, currentProject: () => project, timelineFrame: 0,
	}, { resolveBridge: () => bridge }), false);
	assert.equal(captures, 0);
	assert.equal(presented, 0);
});


function fakeBridge(
	activeDisplayId: string | null,
	present: (request: unknown) => Promise<unknown>,
): FramescaperNativeServicesBridge {
	return {
		snapshot: async () => ({
			snapshotVersion: 1, runtimeAvailable: true, nativeMediaEnabled: true,
			queue: [], roots: [], watchRules: [],
		}),
		control: async () => { throw new Error('unused'); },
		reorder: async () => [],
		remove: async () => false,
		externalDisplays: async () => ({ displays: [DISPLAY], activeDisplayId }),
		presentExternalDisplay: present,
	} as FramescaperNativeServicesBridge;
}

function turn(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
