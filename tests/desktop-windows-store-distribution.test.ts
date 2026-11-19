/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { checkDesktopDistributionUpdates, configureWindowsApplicationIdentity } from '../desktop/windows-store-distribution.ts';

test('packaged Windows retains its OS identity while regular Windows retains its application ID', () => {
	const identities: string[] = [];
	for (const [platform, windowsStore] of [['win32', true], ['win32', undefined], ['linux', undefined]] as const) {
		configureWindowsApplicationIdentity({ platform, windowsStore, appId: 'org.soundscaper.desktop',
			setAppUserModelId: value => identities.push(value) });
	}
	assert.deepEqual(identities, ['org.soundscaper.desktop']);
});

test('Store startup never checks GitHub; the existing manual update action opens Store updates', async () => {
	let githubChecks = 0;
	const urls: string[] = [];
	const dependencies = { windowsStore: true, checkRelease: async () => { githubChecks++; return { status: 'current' }; },
		openExternal: async (url: string) => { urls.push(url); } };
	assert.deepEqual(await checkDesktopDistributionUpdates({ ...dependencies, manual: false }), { status: 'store-managed' });
	assert.deepEqual(urls, []);
	assert.deepEqual(await checkDesktopDistributionUpdates({ ...dependencies, manual: true }), { status: 'store-managed' });
	assert.equal(githubChecks, 0);
	assert.deepEqual(urls, ['ms-windows-store://downloadsandupdates']);
	await assert.rejects(checkDesktopDistributionUpdates({ ...dependencies, manual: true,
		openExternal: async () => { throw new Error('Store unavailable'); } }), /Store unavailable/u);
});

test('ordinary desktop update checks retain their result and manual flag', async () => {
	const result = { status: 'available', version: '2.0.0' };
	assert.equal(await checkDesktopDistributionUpdates({ windowsStore: undefined, manual: true,
		checkRelease: async ({ manual }) => { assert.equal(manual, true); return result; },
		openExternal: async () => { assert.fail('ordinary updates do not open Store'); } }), result);
});
