/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { selectLatestDesktopRc, selectLatestDesktopRelease } from '../src/common/site/desktop-releases.ts';
import { createSoundscaperReleasePreparation } from '../scripts/prepare-soundscaper-release.mjs';
import { readProductReleaseLinesSync, expectedProductReleaseTag, resolveProductDesktopMetadata } from '../scripts/lib/product-release-lines.mjs';
import { desktopReleaseTargetPackageInventory } from '../scripts/desktop-release-assets.mjs';

test('the release register, public tag, numeric package version, and installer name agree', () => {
	const lines = readProductReleaseLinesSync();
	const metadata = resolveProductDesktopMetadata('soundscaper', lines);
	const version = lines.products.soundscaper[lines.products.soundscaper.applicationVersionChannel].version;
	assert.equal(metadata.applicationVersion, version);
	assert.match(metadata.applicationVersion, /^Soundscaper(?:-(?:alpha|beta|rc))?\.\d{4}\.[A-Z][a-z]{2}\.\d{1,2}\.[a-z]+$/u);
	assert.match(metadata.packageVersion, /^\d+\.\d+\.\d+$/u);
	assert.equal(expectedProductReleaseTag('soundscaper', lines), metadata.applicationVersion);
	const config = createRequire(import.meta.url)('../electron-builder.config.cjs');
	assert.equal(config.artifactName, `${version}-\${os}-\${arch}.\${ext}`);
	assert.equal(config.buildVersion, metadata.packageVersion);
	assert.equal(config.extraMetadata.releaseVersion, metadata.applicationVersion);
	for (const row of desktopReleaseTargetPackageInventory('soundscaper', 'win-x64', metadata.applicationVersion)) {
		assert.ok(row.pattern.test(`${version}-win-x64.${row.label.endsWith('ZIP') ? 'zip' : 'exe'}`));
	}
});

test('calendar release preparation rejects semantic versions and synchronizes numeric transport metadata', () => {
	const documents = { releaseLines: readProductReleaseLinesSync(),
		packageMetadata: { name: 'soundscaper', version: '0.0.0' },
		packageLock: { name: 'soundscaper', version: '0.0.0', packages: { '': { name: 'soundscaper', version: '0.0.0' } } },
		desktopProduct: {},
	};
	for (const [version, numeric] of [['Soundscaper-alpha.2026.Nov.11.a', '2026.1111.0'], ['Soundscaper.2026.Nov.11.a', '2026.1111.3']]) {
		const prepared = createSoundscaperReleasePreparation(documents, version);
		assert.equal(prepared.packageMetadata.version, numeric);
		assert.equal(prepared.packageMetadata.releaseVersion, version);
		assert.equal(prepared.packageLock.packages[''].version, numeric);
		assert.equal(prepared.desktopProduct.applicationVersion, version);
	}
	assert.throws(() => createSoundscaperReleasePreparation(documents, '2.0.0'), /calendar/iu);
	assert.throws(() => createSoundscaperReleasePreparation(documents, ' Soundscaper.2026.Nov.11.a'), /calendar/iu);
});

test('download pages and direct links select new calendar release tags and filenames by release order', () => {
	const tags = ['Soundscaper-rc.2026.Nov.9.z', 'Soundscaper-rc.2026.Nov.10.a', 'Framescaper-rc.2026.Nov.12.a'];
	const releases = tags.map((tag, index) => ({ tag_name: tag, draft: false, published_at: `2026-11-${20 - index}T00:00:00Z`,
		assets: [{ name: `${tag}-win-x64.exe`, state: 'uploaded' }],
	}));
	assert.equal(selectLatestDesktopRc(releases, 'soundscaper')?.version, tags[1]);
	assert.equal(selectLatestDesktopRelease(releases, 'soundscaper', 'win-x64.exe'),
		`https://github.com/LeoWattenberg/Soundscaper/releases/download/${tags[1]}/${tags[1]}-win-x64.exe`);
});
