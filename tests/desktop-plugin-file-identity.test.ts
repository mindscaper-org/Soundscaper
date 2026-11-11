/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { validateHelperJobGrant } from '../desktop/helper-job-grant.ts';
import { nativeChildFileIdentityFromStat } from '../desktop/native-child-file-identity.ts';
import { DesktopPluginRegistry, pluginObservationFromScanEntry } from '../desktop/plugin-registry.ts';
import { ENTRY } from './helpers/desktop-plugin-scan-service-fixture.ts';

const IDENTITY = { dev: '2731094893', ino: '70650219154495431' };

test('plugin scan and host grants retain exact NTFS file IDs beyond the safe integer range', () => {
	const scan = validateHelperJobGrant('plugin-scan', { rootPath: 'C:\\Plugins', format: 'vst2', identity: IDENTITY });
	assert.equal(String(scan.identity.ino), IDENTITY.ino);
	const registry = new DesktopPluginRegistry({ isQuarantined: () => false });
	const observation = pluginObservationFromScanEntry({ ...ENTRY, classification: 'effect',
		compatibility: 'compatible', channelSupport: [{ inputs: 2, outputs: 2 }] }, {
		format: 'vst2', platform: 'win32', architecture: 'x64', identity: IDENTITY,
	});
	assert.equal(registry.record(observation).status, 'recorded');
	const installationId = registry.describe().entries[0].installations[0].installationId;
	registry.allow(installationId);
	assert.equal(String(registry.hostGrantFor(installationId).identity.ino), IDENTITY.ino);
	assert.notEqual(String(registry.hostGrantFor(installationId).identity.ino), String(Number(IDENTITY.ino)));
	assert.equal(nativeChildFileIdentityFromStat({ dev: 2731094893n, ino: 70650219154495431n }).ino, IDENTITY.ino);
});

test('plugin grants reject rounded numbers and noncanonical or overflowing file IDs', () => {
	for (const ino of [Number(IDENTITY.ino), '-1', '01', '1.0', '18446744073709551616']) {
		assert.throws(() => validateHelperJobGrant('plugin-scan', {
			rootPath: 'C:\\Plugins', format: 'vst2', identity: { ...IDENTITY, ino },
		}));
	}
});
