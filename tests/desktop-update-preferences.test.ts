/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DesktopSettingsStore } from '../desktop/settings.js';
import { createUpdatePreferencesPreload, updatePreferences, UPDATE_PREFERENCES_CHANNEL } from '../desktop/update-preferences.ts';

test('automatic update checks default on and a preference change persists across restart', async t => {
	const root = await mkdtemp(join(tmpdir(), 'scape-update-preferences-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'desktop-settings.json');
	const settings = new DesktopSettingsStore(path);
	assert.equal((await settings.load(['en'])).updatesEnabled, true);
	await settings.setUpdatesEnabled(false);
	const restored = new DesktopSettingsStore(path);
	assert.equal((await restored.load(['en'])).updatesEnabled, false);
	await restored.setUpdatesEnabled(true);
	assert.equal((await new DesktopSettingsStore(path).load(['en'])).updatesEnabled, true);
});

test('the preference bridge validates requests and preserves settings in portable or Store profiles', async () => {
	let enabled = true;
	let writes = 0;
	const settings = { snapshot: () => ({ updatesEnabled: enabled }), setUpdatesEnabled: async (value: boolean) => { writes++; enabled = value; return value; } };
	const bridge = createUpdatePreferencesPreload(async (channel, value) => {
		assert.equal(channel, UPDATE_PREFERENCES_CHANNEL);
		return updatePreferences(settings, true, value);
	});
	assert.deepEqual(await bridge.updatePreferences(), { available: true, enabled: true });
	assert.deepEqual(await bridge.updatePreferences(false), { available: true, enabled: false });
	assert.equal(writes, 1);
	assert.deepEqual(await updatePreferences(settings, false, true), { available: false, enabled: false });
	assert.equal(writes, 1);
	await assert.rejects(updatePreferences(settings, true, 'false'), /boolean/u);
	await assert.rejects(createUpdatePreferencesPreload(async () => ({ enabled: 'true' })).updatePreferences(), /Invalid/u);
});
