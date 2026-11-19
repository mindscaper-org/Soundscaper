/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nativePluginOfflineInstanceIds, assertNativePluginOfflineRenderAdmission } from '../src/common/editor/engine/native-plugin-offline-admission.ts';

const plugin = { id: 'plugin', type: 'native-plugin', params: { instanceId: 'instance' } };

test('export does not acquire native instances from a bypassed rack', () => {
	for (const location of ['track', 'group', 'send', 'master'] as const) {
		const owner = { id: 'owner', effectsActive: false, effects: [plugin] };
		const project = {
			tracks: location === 'track' ? [{ ...owner, type: 'audio' }] : [],
			mixer: { groups: location === 'group' ? [owner] : [], sends: location === 'send' ? [owner] : [] },
			master: location === 'master' ? owner : { effects: [] },
		};
		assert.deepEqual(nativePluginOfflineInstanceIds(project), [], location);
		assert.doesNotThrow(() => assertNativePluginOfflineRenderAdmission(project), location);
	}
});

test('export still requires a native renderer for an active rack', () => {
	const project = { mixer: { groups: [{ id: 'group', effects: [plugin] }] } };
	assert.deepEqual(nativePluginOfflineInstanceIds(project), ['instance']);
	assert.throws(() => assertNativePluginOfflineRenderAdmission(project), /native plug-ins/iu);
	assert.doesNotThrow(() => assertNativePluginOfflineRenderAdmission(project, {}, true));
	assert.deepEqual(nativePluginOfflineInstanceIds(project, { trackId: 'isolated' }), []);
});
