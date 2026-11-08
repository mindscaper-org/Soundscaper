/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readdir, rmdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
	normalizeLightscaperDesktopTargetCurrentV1, type LightscaperDesktopTargetCurrentV1,
} from './desktop-lightscaper-stage-current-v1.ts';

export function resolveLightscaperDesktopTargetCurrentV1(environment: NodeJS.ProcessEnv): Readonly<LightscaperDesktopTargetCurrentV1> {
	const hostPlatform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform;
	return normalizeLightscaperDesktopTargetCurrentV1({
		platform: environment.SOUNDSCAPER_DESKTOP_TARGET_PLATFORM ?? hostPlatform,
		arch: environment.SOUNDSCAPER_DESKTOP_TARGET_ARCH ?? process.arch,
	});
}

export function lightscaperDesktopBuildEnvironmentCurrentV1(inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = { ...inherited, SCAPE_PRODUCT: 'lightscaper' };
	delete environment.SCAPE_DESKTOP_CODEC_RUNTIME;
	delete environment.PUBLIC_FFMPEG_CORE_BASE_URL;
	return environment;
}

/** Preparation never silently deletes another process's verification output. */
export async function claimLightscaperDesktopBuildRootCurrentV1(buildRoot: string): Promise<void> {
	if (!isAbsolute(buildRoot) || buildRoot.includes('\0')) throw new TypeError('Lightscaper build root must be absolute.');
	await mkdir(buildRoot);
}

/** Vite can leave empty public-asset directories after product filtering. Stage
 * only the produced file closure; later package verification still refuses extras. */
export async function pruneLightscaperRendererEmptyDirectoriesCurrentV1(root: string): Promise<void> {
	async function visit(directory: string): Promise<void> {
		for (const child of await readdir(directory, { withFileTypes: true })) {
			if (child.isDirectory() && !child.isSymbolicLink()) await visit(join(directory, child.name));
		}
		if (directory !== root && !(await readdir(directory)).length) await rmdir(directory);
	}
	await visit(root);
}
