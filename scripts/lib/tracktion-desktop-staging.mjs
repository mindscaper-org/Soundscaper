/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';

import { resolveNativeAddonPayloadTarget } from './native-addon-payload-manifest.mjs';

export async function stageTracktionDesktopApplication(sourceRoot, applicationRoot) {
	await build({
		entryPoints: {
			main: join(sourceRoot, 'tracktion-main.ts'),
			'tracktion-utility-process': join(sourceRoot, 'tracktion-utility-process.ts'),
		},
		outdir: applicationRoot,
		outExtension: { '.js': '.mjs' },
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node26',
		external: [
			'electron', 'electron/*', './constants.js', './protocol.js', './save-targets.js',
			'./tracktion-installed-plugin-registration.mjs',
		],
	});
}

export async function stageTracktionDesktopPeer({ repositoryRoot, runtimeRoot, target }) {
	const host = resolveNativeAddonPayloadTarget();
	if (host.id !== target) throw new Error(`Tracktion desktop ${target} requires a native ${target} build runner.`);
	try {
		const result = await promisify(execFile)(process.execPath, ['scripts/test-tracktion-session.mjs', '--build-peer'], {
			cwd: repositoryRoot,
		});
		process.stdout.write(result.stdout);
	} catch (error) {
		throw new Error('Could not build the Soundscaper native Tracktion peer. ' + (error.stderr || error.message), { cause: error });
	}
	const windows = target.startsWith('win-');
	const name = windows ? 'soundscaper_tracktion_peer.exe' : 'soundscaper_tracktion_peer';
	const output = join(runtimeRoot, 'tracktion');
	await mkdir(output, { recursive: true });
	await copyFile(join(repositoryRoot, '.native-build/tracktion-session', windows ? 'Release' : '', name), join(output, name));
}
