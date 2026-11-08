/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepareLightscaperDesktopCurrentV1 } from '../scripts/desktop-lightscaper-prepare-current-v1.ts';
import {
	claimLightscaperDesktopBuildRootCurrentV1, lightscaperDesktopBuildEnvironmentCurrentV1,
	resolveLightscaperDesktopTargetCurrentV1,
	pruneLightscaperRendererEmptyDirectoriesCurrentV1,
} from '../scripts/lib/desktop-lightscaper-preparation-current-v1.ts';

test('Lightscaper preparation selects only maintained desktop targets without changing the environment', () => {
	const environment = { SOUNDSCAPER_DESKTOP_TARGET_PLATFORM: 'mac', SOUNDSCAPER_DESKTOP_TARGET_ARCH: 'arm64' };
	assert.deepEqual(resolveLightscaperDesktopTargetCurrentV1(environment), { platform: 'mac', arch: 'arm64' });
	assert.deepEqual(environment, { SOUNDSCAPER_DESKTOP_TARGET_PLATFORM: 'mac', SOUNDSCAPER_DESKTOP_TARGET_ARCH: 'arm64' });
	assert.throws(() => resolveLightscaperDesktopTargetCurrentV1({ ...environment, SOUNDSCAPER_DESKTOP_TARGET_ARCH: 'x64' }));
	assert.throws(() => resolveLightscaperDesktopTargetCurrentV1({ SOUNDSCAPER_DESKTOP_TARGET_PLATFORM: 'other' }));
});

test('Lightscaper renderer staging removes empty generated directories and keeps every file', async () => {
	const root = await mkdtemp(join(tmpdir(), 'lightscaper-prune-'));
	try {
		await mkdir(join(root, 'install-screenshots/nested'), { recursive: true });
		await mkdir(join(root, 'assets')); await writeFile(join(root, 'assets/keep.js'), 'keep');
		await pruneLightscaperRendererEmptyDirectoriesCurrentV1(root);
		await assert.rejects(readFile(join(root, 'install-screenshots')), { code: 'ENOENT' });
		assert.equal(await readFile(join(root, 'assets/keep.js'), 'utf8'), 'keep');
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Lightscaper renderer preparation removes inherited audio desktop composition and external FFmpeg routing', () => {
	const inherited = { SCAPE_PRODUCT: 'soundscaper', SCAPE_DESKTOP_CODEC_RUNTIME: 'main-process', PUBLIC_FFMPEG_CORE_BASE_URL: 'https://example.invalid', SCAPE_BUILD_SOURCE_MAPS: '1' };
	const environment = lightscaperDesktopBuildEnvironmentCurrentV1(inherited);
	assert.equal(environment.SCAPE_PRODUCT, 'lightscaper');
	assert.equal(environment.SCAPE_DESKTOP_CODEC_RUNTIME, undefined);
	assert.equal(environment.PUBLIC_FFMPEG_CORE_BASE_URL, undefined);
	assert.equal(environment.SCAPE_BUILD_SOURCE_MAPS, '1');
	assert.equal(inherited.SCAPE_PRODUCT, 'soundscaper');
});

test('Lightscaper preparation refuses an existing output and preserves its contents', async () => {
	const root = await mkdtemp(join(tmpdir(), 'lightscaper-prepare-'));
	try {
		const output = join(root, 'build'); await mkdir(output); await writeFile(join(output, 'previous'), 'keep');
		await assert.rejects(prepareLightscaperDesktopCurrentV1(fileURLToPath(new URL('../', import.meta.url)), { SCAPE_DESKTOP_BUILD_ROOT: output }), /exist/iu);
		assert.equal(await readFile(join(output, 'previous'), 'utf8'), 'keep');
		await claimLightscaperDesktopBuildRootCurrentV1(join(root, 'fresh'));
	} finally { await rm(root, { recursive: true, force: true }); }
});
