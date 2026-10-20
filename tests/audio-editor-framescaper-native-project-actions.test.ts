/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	bindFramescaperNativeProjectActionRuntime,
	createFramescaperNativeProjectActionSubsetRuntime,
	framescaperNativeProjectActionRuntimeFor,
} from '../src/common/editor/ui/framescaper-native-project-actions.ts';

test('a baseline controller receives a nominal runtime without a public property', () => {
	const controller = Object.freeze({ id: 'baseline-controller' });
	const runtime = createFramescaperNativeProjectActionSubsetRuntime(
		['image-sequence-import'], { 'image-sequence-import': async () => undefined },
	);
	bindFramescaperNativeProjectActionRuntime(controller, runtime);

	assert.equal(framescaperNativeProjectActionRuntimeFor(controller), runtime);
	assert.equal(framescaperNativeProjectActionRuntimeFor({ ...controller }), null);
	assert.equal(Object.hasOwn(controller, 'framescaperNativeProjectActions'), false);
	assert.throws(
		() => bindFramescaperNativeProjectActionRuntime(controller, { ...runtime } as never),
		/exact Framescaper project action runtime/u,
	);
});
