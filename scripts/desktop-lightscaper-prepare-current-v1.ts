/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { generateDesktopIcon } from './desktop-icons.mjs';
import { stageDesktopLightscaperRawRuntimeCurrentV1 } from './lib/desktop-lightscaper-raw-runtime-current-v1.ts';
import { bundleLightscaperDesktopMainCurrentV1 } from './lib/desktop-lightscaper-main-bundle-current-v1.ts';
import {
	claimLightscaperDesktopBuildRootCurrentV1, lightscaperDesktopBuildEnvironmentCurrentV1,
	resolveLightscaperDesktopTargetCurrentV1,
} from './lib/desktop-lightscaper-preparation-current-v1.ts';
import { buildLightscaperDesktopRendererCurrentV1 } from './lib/desktop-lightscaper-renderer-build-current-v1.ts';
import { captureDesktopLightscaperStageCurrentV1 } from './lib/desktop-lightscaper-stage-current-v1.ts';
import { readProductReleaseLines, resolveProductDesktopMetadata } from './lib/product-release-lines.mjs';

const execute = promisify(execFile);

/** A separate managed Photo composition keeps the existing audio/video native
 * authorities intact. The package runs the same Current Photo app as the site. */
export async function prepareLightscaperDesktopCurrentV1(repositoryRoot: string, inherited: NodeJS.ProcessEnv = process.env): Promise<void> {
	const environment = lightscaperDesktopBuildEnvironmentCurrentV1(inherited);
	const target = resolveLightscaperDesktopTargetCurrentV1(environment);
	const buildRoot = resolve(repositoryRoot, environment.SCAPE_DESKTOP_BUILD_ROOT ?? '.desktop-build');
	const releaseLines = await readProductReleaseLines(repositoryRoot);
	const metadata = resolveProductDesktopMetadata('lightscaper', releaseLines);
	const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' });
	const sourceRevision = stdout.trim();
	if (!/^[a-f0-9]{40}$/u.test(sourceRevision)) throw new Error('Lightscaper preparation requires a full source commit.');
	await claimLightscaperDesktopBuildRootCurrentV1(buildRoot);
	const appRoot = join(buildRoot, 'app'), rendererRoot = join(buildRoot, 'renderer');
	await mkdir(join(appRoot, 'desktop'), { recursive: true });
	await writeJson(join(appRoot, 'package.json'), {
		name: 'lightscaper-desktop', productName: 'Lightscaper', version: metadata.applicationVersion,
		main: 'desktop/main.mjs', type: 'module', license: 'AGPL-3.0-only',
		desktopName: 'org.lightscaper.desktop', homepage: 'https://lightscaper.org',
		description: 'Local-first photo library and non-destructive develop editor', author: 'Mindscaper',
	});
	await writeJson(join(appRoot, 'desktop/product.json'), metadata);
	await bundleLightscaperDesktopMainCurrentV1(repositoryRoot, appRoot);
	await buildLightscaperDesktopRendererCurrentV1(repositoryRoot, rendererRoot, environment);
	await stageDesktopLightscaperRawRuntimeCurrentV1({ repositoryRoot, runtimeRoot: join(buildRoot, 'runtime') });
	await generateDesktopIcon({ sourcePath: join(repositoryRoot, 'public/logo/lightscaper.svg'), outputPath: join(buildRoot, 'icons/icon.png') });
	const licenses = join(buildRoot, 'licenses'); await mkdir(licenses);
	await cp(join(repositoryRoot, 'LICENSE'), join(licenses, 'Soundscaper-AGPL-3.0.txt'));
	await cp(join(repositoryRoot, 'THIRD_PARTY_LICENSES.md'), join(licenses, 'THIRD_PARTY_LICENSES.md'));
	await cp(join(repositoryRoot, 'LICENSES'), join(licenses, 'LICENSES'), { recursive: true });
	const receipt = await captureDesktopLightscaperStageCurrentV1({ repositoryRoot, buildRoot, productMetadata: metadata, target, sourceRevision });
	await writeJson(join(buildRoot, 'stage-manifest.json'), receipt);
	console.log(`Prepared Lightscaper ${metadata.applicationVersion} for ${target.platform}-${target.arch} at ${buildRoot}.`);
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, '\t')}\n`, { flag: 'wx' });
}
