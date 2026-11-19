/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBundledPluginResources } from '../desktop/bundled-plugin-resources.ts';

const resource = { path: 'payload/runtime/instrument-data/surge-xt/wavetables/Basic.wt', byteLength: 1024, sha256: 'a'.repeat(64) };
test('factory data has a separate bounded authenticated inventory without joining the native-code closure', () => {
	assert.deepEqual(validateBundledPluginResources([resource], 'payload/runtime/'), [resource]);
	for (const rows of [[{ ...resource, path: 'payload/runtime/instruments/Surge XT.vst3/Contents/x86_64-linux/Surge XT.so' }],
		[resource, resource], [{ ...resource, byteLength: 513 * 1024 * 1024 }], [{ ...resource, sha256: 'bad' }],
		[{ ...resource, path: 'payload/runtime/instrument-data/surge-xt/../outside.wt' }], [{ ...resource, extra: true }]]) {
		assert.throws(() => validateBundledPluginResources(rows, 'payload/runtime/'));
	}
});
