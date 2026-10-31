/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { desktopInstallerSigningIdentity } from '../scripts/lib/desktop-signing-config.cjs';
import { setupDesktopSigningKeychain } from '../scripts/desktop-signing-keychain.mjs';

test('signed PKG builds require an Installer identity belonging to the app team', () => {
	assert.equal(desktopInstallerSigningIdentity({}, 'darwin'), null);
	const env = { SCAPE_MAC_SIGNING: 'true', APPLE_TEAM_ID: 'TEAM' };
	assert.throws(() => desktopInstallerSigningIdentity(env, 'darwin'), /CSC_INSTALLER_NAME/u);
	for (const identity of ['Developer ID Application: Example (TEAM)', 'Developer ID Installer: Example (OTHER)']) {
		assert.throws(() => desktopInstallerSigningIdentity({ ...env, CSC_INSTALLER_NAME: identity }, 'darwin'), /Installer identity/u);
	}
	assert.equal(desktopInstallerSigningIdentity({ ...env, CSC_INSTALLER_NAME: 'Developer ID Installer: Example (TEAM)' }, 'darwin'),
		'Developer ID Installer: Example (TEAM)');
});

test('the temporary keychain imports both app and installer certificates and removes the P12 files', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'installer-signing-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const calls: Array<{ command: string; args: readonly string[] }> = [];
	await setupDesktopSigningKeychain({
		env: {
			RUNNER_TEMP: root, GITHUB_ENV: join(root, 'github-env'),
			MAC_CERTIFICATE_P12: Buffer.from('app').toString('base64'), MAC_CERTIFICATE_PASSWORD: 'app-password',
			MAC_INSTALLER_CERTIFICATE_P12: Buffer.from('installer').toString('base64'), MAC_INSTALLER_CERTIFICATE_PASSWORD: 'installer-password',
		},
		executeFile: async (command: string, args: readonly string[]) => {
			calls.push({ command, args }); return { stdout: '', stderr: '' };
		},
	});
	const imports = calls.filter(({ args }) => args[0] === 'import');
	assert.equal(imports.length, 2);
	assert.ok(imports[0]?.args.includes('/usr/bin/codesign'));
	assert.ok(imports[1]?.args.includes('/usr/bin/productbuild'));
	assert.ok(imports[1]?.args.includes('/usr/bin/productsign'));
	assert.ok(!(await readdir(join(root, 'soundscaper-signing'))).some((name) => name.endsWith('.p12')));
});

test('missing installer credentials and failed imports never expose certificate passwords', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'installer-signing-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const env = {
		RUNNER_TEMP: root, GITHUB_ENV: join(root, 'github-env'),
		MAC_CERTIFICATE_P12: Buffer.from('app').toString('base64'), MAC_CERTIFICATE_PASSWORD: 'app-secret',
	};
	await assert.rejects(setupDesktopSigningKeychain({ env }), /installer certificate/u);
	await assert.rejects(setupDesktopSigningKeychain({
		env: { ...env, MAC_INSTALLER_CERTIFICATE_P12: 'aW5zdGFsbGVy', MAC_INSTALLER_CERTIFICATE_PASSWORD: 'installer-secret' },
		executeFile: async () => { throw new Error('app-secret installer-secret'); },
	}), (error: unknown) => error instanceof Error && !/app-secret|installer-secret/u.test(error.message));
});
