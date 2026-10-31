/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBuildChunks } from '../check-build-chunks.mjs';
import { generateProductWindowIcon } from './offline-application-shell.mjs';
import { pruneLightscaperRendererEmptyDirectoriesCurrentV1 } from './desktop-lightscaper-preparation-current-v1.ts';

export async function runLightscaperDesktopBuildCommandCurrentV1(args: readonly string[], repositoryRoot: string, environment: NodeJS.ProcessEnv): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(process.execPath, [...args], { cwd: repositoryRoot, env: environment, stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code === 0 && signal === null) resolve();
			else reject(new Error(`Lightscaper desktop producer failed (${String(code)}, ${String(signal)}): ${args[0]}`));
		});
	});
}

/** The desktop uses the real Web Core renderer, including its ordinary output
 * and startup guards. Browser storage belongs to the private Electron partition. */
export async function buildLightscaperDesktopRendererCurrentV1(repositoryRoot: string, rendererRoot: string, environment: NodeJS.ProcessEnv): Promise<void> {
	const run = (args: readonly string[], cwd = repositoryRoot) => runLightscaperDesktopBuildCommandCurrentV1(args, cwd, environment);
	await run([join(repositoryRoot, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', rendererRoot]);
	await run([join(repositoryRoot, 'scripts/generate-static-routes.mjs'), rendererRoot]);
	await run([join(repositoryRoot, 'scripts/generate-offline-application-shell.mjs'), rendererRoot]);
	await generateProductWindowIcon({ outputRoot: rendererRoot, repositoryRoot, productId: 'lightscaper' });
	checkBuildChunks(rendererRoot);
	const checks = await mkdtemp(join(tmpdir(), 'lightscaper-renderer-checks-'));
	try {
		const directoryLink = process.platform === 'win32' ? 'junction' : 'dir';
		await symlink(rendererRoot, join(checks, 'dist'), directoryLink);
		await symlink(join(repositoryRoot, 'src'), join(checks, 'src'), directoryLink);
		await run([join(repositoryRoot, 'scripts/check-i18n-build.mjs')], checks);
		await run([join(repositoryRoot, 'scripts/check-cloudflare-assets.mjs')], checks);
	} finally { await rm(checks, { recursive: true, force: true }); }
	await pruneLightscaperRendererEmptyDirectoriesCurrentV1(rendererRoot);
}
