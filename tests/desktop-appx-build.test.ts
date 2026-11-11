/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDesktopAppx } from '../scripts/desktop-appx.mjs';

test('AppX build scopes Store settings to its own Windows preparation and packaging', async () => {
	const calls: { command: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
	let assets: unknown;
	const inherited = { SCAPE_WIN_SIGNING: 'azure', CSC_LINK: 'existing-certificate',
		WIN_CSC_LINK: 'existing-windows-certificate' };
	const options = { args: ['--development', '--arch=arm64'], environment: inherited,
		platform: 'win32' as const, hostArch: 'arm64' as const, repositoryRoot: '/fixture',
		run: async (command: string, args: string[], { env }: { env: NodeJS.ProcessEnv }) => { calls.push({ command, args, env }); },
		prepareAssets: async (value: unknown) => { assets = value; } };
	await buildDesktopAppx(options);
	assert.equal(calls.length, 2);
	assert.ok(calls[0]?.args[0]?.endsWith('scripts/desktop-prepare.mjs'));
	assert.equal(calls[1]?.command, 'bash');
	assert.deepEqual(calls[1]?.args.slice(1), ['--config', 'electron-builder.appx.config.cjs', '--win', '--arm64', '--publish', 'never']);
	for (const { env } of calls) {
		assert.equal(env.SCAPE_WIN_SIGNING, 'none');
		assert.equal(env.CSC_LINK, undefined);
		assert.equal(env.WIN_CSC_LINK, undefined);
		assert.equal(env.SOUNDSCAPER_DESKTOP_TARGET_PLATFORM, 'win');
		assert.equal(env.SOUNDSCAPER_DESKTOP_TARGET_ARCH, 'arm64');
		assert.equal(env.SCAPE_APPX_IDENTITY_NAME, 'Soundscaper.Development');
	}
	assert.equal(inherited.SCAPE_WIN_SIGNING, 'azure');
	assert.deepEqual(assets, { repositoryRoot: '/fixture', outputRoot: '/fixture/.desktop-build/icons',
		productId: 'soundscaper', version: '1.0.0.0' });
	calls.length = 0;
	await buildDesktopAppx({ ...options, args: ['--development', '--prepared', '--arch=arm64'] });
	assert.equal(calls.length, 1);
});

test('AppX build rejects invalid input and missing Store identity before running build tools', async () => {
	const options = { platform: 'win32' as const, hostArch: 'x64' as const, environment: {},
		run: async () => { assert.fail('preflight must fail before preparation'); } };
	for (const args of [['--arch=ia32'], ['--unknown'], ['--arch=x64', '--arch=arm64']]) {
		await assert.rejects(buildDesktopAppx({ ...options, args }), /AppX/u);
	}
	await assert.rejects(buildDesktopAppx({ ...options, args: [] }), /SCAPE_APPX_IDENTITY_NAME/u);
	await assert.rejects(buildDesktopAppx({ ...options, args: ['--development'], platform: 'linux' }), /Windows/u);
	await assert.rejects(buildDesktopAppx({ ...options, args: ['--development'], environment: { SCAPE_PRODUCT: 'other' } }), /SCAPE_PRODUCT/u);
});
