#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { prepareDesktopAppxAssets } from './desktop-appx-assets.mjs';
import { desktopAppxSettings } from './lib/desktop-appx-config.cjs';

const ROOT = resolve(import.meta.dirname, '..');
const HELP = `Build an unsigned Store AppX on Windows (Git Bash required).
  npm run desktop:appx -- [--arch=x64|arm64] [--prepared] [--development]
  --prepared     Reuse an authenticated desktop:prepare stage for this target.
  --development  Use a separate development identity and version 1.0.0.0.
For Store builds set SCAPE_APPX_IDENTITY_NAME, SCAPE_APPX_PUBLISHER,
SCAPE_APPX_PUBLISHER_DISPLAY_NAME and SCAPE_APPX_VERSION (A.B.C.0).
The output needs package signing before local sideload installation.`;

export async function buildDesktopAppx({ args = process.argv.slice(2), environment = process.env,
	platform = process.platform, hostArch = process.arch, repositoryRoot = ROOT,
	run = runCommand, prepareAssets = prepareDesktopAppxAssets } = {}) {
	if (args.length === 1 && args[0] === '--help') { console.log(HELP); return; }
	const architectureArgs = args.filter(arg => arg.startsWith('--arch='));
	const arch = architectureArgs[0]?.slice('--arch='.length) ?? hostArch;
	if (architectureArgs.length > 1 || !['x64', 'arm64'].includes(arch)
		|| args.some(arg => !['--development', '--prepared', `--arch=${arch}`].includes(arg))) {
		throw new Error(`Invalid AppX arguments.\n${HELP}`);
	}
	if (platform !== 'win32') throw new Error('AppX packaging requires a Windows x64 or ARM64 build host.');
	const productId = environment.SCAPE_PRODUCT ?? 'soundscaper';
	if (!['soundscaper', 'framescaper'].includes(productId)) throw new Error('SCAPE_PRODUCT must be soundscaper or framescaper.');
	const productName = productId === 'soundscaper' ? 'Soundscaper' : 'Framescaper';
	const env = { ...environment, SCAPE_PRODUCT: productId, SCAPE_WIN_SIGNING: 'none', SCAPE_MAC_SIGNING: 'false',
		CSC_IDENTITY_AUTO_DISCOVERY: 'false', SOUNDSCAPER_DESKTOP_TARGET_PLATFORM: 'win', SOUNDSCAPER_DESKTOP_TARGET_ARCH: arch };
	delete env.CSC_LINK;
	delete env.WIN_CSC_LINK;
	if (args.includes('--development')) Object.assign(env, {
		SCAPE_APPX_IDENTITY_NAME: `${productName}.Development`, SCAPE_APPX_PUBLISHER: `CN=${productName} Development`,
		SCAPE_APPX_PUBLISHER_DISPLAY_NAME: `${productName} Development`, SCAPE_APPX_VERSION: '1.0.0.0',
	});
	const { version } = desktopAppxSettings(env);
	if (!args.includes('--prepared')) await run(process.execPath, [resolve(repositoryRoot, 'scripts/desktop-prepare.mjs')], { cwd: repositoryRoot, env });
	await prepareAssets({ repositoryRoot, outputRoot: resolve(repositoryRoot, '.desktop-build/icons'), productId, version });
	await run('bash', [resolve(repositoryRoot, 'scripts/ci-electron-builder.sh'), '--config', 'electron-builder.appx.config.cjs',
		'--win', `--${arch}`, '--publish', 'never'], { cwd: repositoryRoot, env });
}

function runCommand(command, args, options) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, { ...options, stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code === 0) resolvePromise();
			else reject(new Error(`AppX build exited with ${signal ?? code}.`));
		});
	});
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	buildDesktopAppx().catch(error => { console.error(error.message); process.exitCode = 1; });
}
