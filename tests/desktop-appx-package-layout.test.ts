/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { validateDesktopPackageInstalledLayout } from '../scripts/lib/desktop-package-format-layout.mjs';

test('AppX audit admits only its app directory and preserves EXE/ZIP layout boundaries', async context => {
	const root = await mkdtemp(join(tmpdir(), 'scape-appx-layout-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	for (const directory of ['', 'app', 'Soundscaper', 'other']) {
		const applicationRoot = join(root, directory);
		const resourcesRoot = join(applicationRoot, 'resources');
		await mkdir(resourcesRoot, { recursive: true });
		await writeFile(join(applicationRoot, 'Soundscaper.exe'), 'fixture');
		const options = { extraction: root, resourcesRoot, productId: 'soundscaper', targetId: 'win-x64' };
		if (directory === 'app') {
			assert.equal((await validateDesktopPackageInstalledLayout({ ...options, packageFormat: '.appx' })).applicationRoot, applicationRoot);
			await assert.rejects(validateDesktopPackageInstalledLayout({ ...options, packageFormat: '.zip' }), /layout/u);
		} else {
			await assert.rejects(validateDesktopPackageInstalledLayout({ ...options, packageFormat: '.appx' }), /layout/u);
		}
	}
});
