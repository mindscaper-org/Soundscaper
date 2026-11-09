/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DesktopSettingsStore } from '../desktop/settings.js';
import { ReleaseChecker } from '../desktop/update-check.js';
import { seedDesktopNightlyPackagedLocale } from '../scripts/lib/desktop-nightly-tests-packaged-runtime.mjs';

test('disposable nightly profiles disable automatic update dialogs without changing desktop defaults', async context => {
	const profile = await mkdtemp(join(tmpdir(), 'nightly-dialogs-'));
	context.after(() => rm(profile, { recursive: true, force: true }));
	await seedDesktopNightlyPackagedLocale(profile);
	const settings = new DesktopSettingsStore(join(profile, 'desktop-settings.json'));
	assert.equal((await settings.load(['de-DE'])).updatesEnabled, false);
	let requests = 0;
	const checker = new ReleaseChecker({
		currentVersion: '1.0.0-rc.Nov.9.a', settings,
		fetchImpl: async () => {
			requests += 1;
			return Response.json([]);
		},
	});
	assert.deepEqual(await checker.check(), { status: 'disabled' });
	assert.equal(requests, 0);
	assert.deepEqual(await checker.check({ manual: true }), { status: 'current' });
	assert.equal(requests, 1, 'manual update checks remain available');
	const ordinary = new DesktopSettingsStore(join(profile, 'ordinary-settings.json'));
	assert.equal((await ordinary.load(['en'])).updatesEnabled, true);
});
