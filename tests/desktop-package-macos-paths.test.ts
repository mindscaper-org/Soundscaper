/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { auditExtractedDesktopPackageContent, writeDesktopPackageContentManifest }
	from '../scripts/lib/desktop-package-content-manifest.mjs';
import { osCodecPackageTree } from './helpers/desktop-package-os-codec-fixture.js';

test('macOS package audits bind the same bytes after DMG filename decomposition', async (context) => {
	const fixture = await osCodecPackageTree(context, 'mac-arm64');
	const extractedRoot = dirname(fixture.resourcesRoot);
	const contents = join(extractedRoot, 'Soundscaper.app', 'Contents');
	const resourcesRoot = join(contents, 'Resources');
	await mkdir(join(contents, 'MacOS'), { recursive: true });
	await rename(fixture.resourcesRoot, resourcesRoot);
	const executable = Buffer.alloc(8);
	executable.writeUInt32LE(0xfeedfacf);
	executable.writeUInt32LE(0x0100000c, 4);
	await writeFile(join(contents, 'MacOS', 'Soundscaper'), executable);
	const nfc = join(resourcesRoot, 'Café.fxp');
	const nfd = nfc.normalize('NFD');
	await writeFile(nfc, 'preset bytes');
	const identity = { productId: 'soundscaper', targetId: 'mac-arm64' };
	await writeDesktopPackageContentManifest({ ...fixture, resourcesRoot, ...identity });
	const options = { extractedRoot, runtimeManifestBytes: await readFile(fixture.runtimeManifestPath), ...identity };
	const staged = await auditExtractedDesktopPackageContent({ ...options, packageFormat: '.pkg' });
	await rename(nfc, nfd);
	const mounted = await auditExtractedDesktopPackageContent({ ...options, packageFormat: '.dmg' });
	assert.equal(mounted.installedClosureSha256, staged.installedClosureSha256);
	if (process.platform === 'linux') {
		await writeFile(nfc, 'preset bytes');
		await assert.rejects(auditExtractedDesktopPackageContent(options), /canonically equivalent file names/u);
		await rm(nfc);
	}
	await writeFile(nfd, 'edited bytes');
	await assert.rejects(auditExtractedDesktopPackageContent({ ...options, packageFormat: '.dmg' }), /closure disagrees/u);
});
