/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	expectedProductReleaseTag,
	resolveProductApplicationVersion,
	resolveProductDesktopMetadata,
	resolveProductReleaseTag,
	validateProductReleaseLines,
} from '../scripts/lib/product-release-lines.mjs';
import { desktopReleaseTargetPackageInventory } from '../scripts/desktop-release-assets.mjs';
import { selectUpdate } from '../desktop/update-check.js';

const ROOT = new URL('../', import.meta.url);
const RELEASE_LINES = validateProductReleaseLines(JSON.parse(
	await readFile(new URL('config/product-release-lines.json', ROOT), 'utf8'),
));

test('product release lines select declared versions and active channels', () => {
	for (const [productId, product] of Object.entries(RELEASE_LINES.products)) {
		const channel = product.applicationVersionChannel;
		assert.equal(resolveProductApplicationVersion(productId, RELEASE_LINES), product[channel].version);
		assert.equal(product.candidate.tagPrefix, `${productId}-v`);
		assert.equal(product.stable.tagPrefix, productId === 'soundscaper' ? 'v' : 'framescaper-v');
		for (const releaseChannel of ['candidate', 'stable']) {
			const tag = expectedProductReleaseTag(productId, RELEASE_LINES, releaseChannel);
			assert.equal(tag, `${product[releaseChannel].tagPrefix}${product[releaseChannel].version}`);
			if (product.releaseChannel !== releaseChannel) {
				assert.throws(() => resolveProductReleaseTag(tag, RELEASE_LINES), /not active|deferred/iu);
			} else {
				assert.deepEqual(resolveProductReleaseTag(tag, RELEASE_LINES), {
					productId, channel: releaseChannel, version: product[releaseChannel].version,
				});
			}
		}
	}
});

function fixtureReleaseLines() {
	const lines = structuredClone(RELEASE_LINES);
	for (const product of Object.values(lines.products)) {
		product.applicationVersionChannel = 'candidate';
		product.releaseChannel = 'candidate';
		product.candidate.version = '1.0.0-rc.1';
		product.stable.version = '1.0.0';
	}
	return lines;
}

test('the resolver supports divergent product versions without package metadata', () => {
	const divergent = fixtureReleaseLines();
	divergent.products.soundscaper.candidate.version = '1.0.0-rc.2';
	const validated = validateProductReleaseLines(divergent);
	assert.equal(resolveProductApplicationVersion('soundscaper', validated), '1.0.0-rc.2');
	assert.equal(resolveProductApplicationVersion('framescaper', validated), '1.0.0-rc.1');
	assert.deepEqual(resolveProductDesktopMetadata('soundscaper', validated), {
		schemaVersion: 1,
		id: 'soundscaper',
		applicationVersion: '1.0.0-rc.2',
		applicationVersionChannel: 'candidate',
		releaseChannel: 'candidate',
		updateTagPrefix: 'soundscaper-v',
	});
	assert.equal(resolveProductDesktopMetadata('framescaper', validated).releaseChannel, 'candidate');

	const stable = structuredClone(validated);
	stable.products.soundscaper.applicationVersionChannel = 'stable';
	stable.products.soundscaper.releaseChannel = 'stable';
	const selected = validateProductReleaseLines(stable);
	assert.equal(resolveProductApplicationVersion('soundscaper', selected), '1.0.0');
	assert.equal(resolveProductDesktopMetadata('soundscaper', selected).updateTagPrefix, 'v');
	assert.deepEqual(resolveProductReleaseTag('v1.0.0', selected), {
		productId: 'soundscaper',
		channel: 'stable',
		version: '1.0.0',
	});
});

test('date-named candidates retain their exact version in tags, packages, and updates', () => {
	const dated = fixtureReleaseLines();
	dated.products.soundscaper.candidate.version = '1.0.0-rc.Oct.1';
	const validated = validateProductReleaseLines(dated);
	const version = resolveProductApplicationVersion('soundscaper', validated);
	assert.equal(version, '1.0.0-rc.Oct.1');
	assert.equal(resolveProductDesktopMetadata('soundscaper', validated).applicationVersion, version);
	const tag = expectedProductReleaseTag('soundscaper', validated);
	assert.equal(tag, 'soundscaper-v1.0.0-rc.Oct.1');
	assert.deepEqual(resolveProductReleaseTag(tag, validated), {
		productId: 'soundscaper', channel: 'candidate', version,
	});
	const packagePattern = desktopReleaseTargetPackageInventory('soundscaper', 'mac-arm64', version)[0].pattern;
	assert.equal(packagePattern.test('Soundscaper-1.0.0-rc.Oct.1-mac-arm64.dmg'), true);
	assert.equal(packagePattern.test('Soundscaper-1.0.0-rcXOctX1-mac-arm64.dmg'), false);
	const release = { tag_name: tag, prerelease: true, draft: false };
	assert.equal(selectUpdate([release], '1.0.0-rc.11', 'soundscaper-v'), release);
	assert.equal(selectUpdate([release], version, 'soundscaper-v'), null);
	assert.equal(selectUpdate([release], '1.0.0', 'soundscaper-v'), null);
});

test('candidate identifiers follow semantic versioning and stable versions stay plain', () => {
	for (const version of [
		'1.0.0-rc.', '1.0.0-rc.Oct..1', '1.0.0-rc.Oct.01',
		'1.0.0-rc.01', '1.0.0-rc.Oct_1', '1.0.0-preview.Oct.1',
	]) {
		const changed = fixtureReleaseLines();
		changed.products.soundscaper.candidate.version = version;
		assert.throws(() => validateProductReleaseLines(changed), /release version is invalid/iu, version);
	}
	const changed = fixtureReleaseLines();
	changed.products.soundscaper.stable.version = '1.0.0-rc.Oct.1';
	assert.throws(() => validateProductReleaseLines(changed), /stable release version is invalid/iu);
});

test('release-line validation rejects malformed register identities', () => {
	for (const mutate of [
		(value) => { value.products.soundscaper.extra = true; },
		(value) => { value.products.framescaper.candidate.version = 'latest'; },
		(value) => {
			value.products.soundscaper.applicationVersionChannel =
				value.products.soundscaper.applicationVersionChannel === 'stable' ? 'candidate' : 'stable';
		},
	]) {
		const changed = fixtureReleaseLines();
		mutate(changed);
		assert.throws(() => validateProductReleaseLines(changed), /release|exact|version/iu);
	}
});

test('browser and desktop builds resolve the selected product version from release lines', async () => {
	const [vite, desktop, constants, main] = await Promise.all([
		readFile(new URL('vite.config.mjs', ROOT), 'utf8'),
		readFile(new URL('scripts/desktop-prepare.mjs', ROOT), 'utf8'),
		readFile(new URL('desktop/constants.js', ROOT), 'utf8'),
		readFile(new URL('desktop/main.mjs', ROOT), 'utf8'),
	]);
	assert.match(vite, /resolveProductApplicationVersion\(\s*productId/iu);
	assert.doesNotMatch(vite, /package\.json[^\n]+version/iu);
	assert.match(desktop, /resolveProductApplicationVersion\(\s*PRODUCT_ID/iu);
	assert.doesNotMatch(desktop, /applicationVersion:\s*projectPackage\.version/iu);
	assert.match(desktop, /version:\s*applicationVersion/iu, 'Electron package metadata uses the selected version');
	assert.match(desktop, /applicationVersion,/u, 'the runtime stage manifest uses the selected version');
	assert.match(desktop, /desktop\/product\.json'\), productMetadata/u);
	assert.match(constants, /productConfig\.updateTagPrefix/u);
	assert.match(main, /currentVersion:\s*app\.getVersion\(\).*tagPrefix:\s*UPDATE_TAG_PREFIX/u);
	assert.match(main, /version:\s*app\.getVersion\(\)/u, 'diagnostics/environment reports the Electron version');
	assert.match(main, /app\.getVersion\(\) !== DECLARED_APPLICATION_VERSION/u);

	const divergent = fixtureReleaseLines();
	divergent.products.soundscaper.candidate.version = '1.0.0-rc.7';
	const metadata = resolveProductDesktopMetadata('soundscaper', divergent);
	assert.equal(selectUpdate([
		{ tag_name: 'v1.0.0', prerelease: false, draft: false },
		{ tag_name: 'soundscaper-v1.0.0-rc.8', prerelease: true, draft: false },
	], metadata.applicationVersion, metadata.updateTagPrefix).tag_name,
	'soundscaper-v1.0.0-rc.8');
	const packagePattern = desktopReleaseTargetPackageInventory(
		'soundscaper', 'mac-arm64', metadata.applicationVersion,
	)[0].pattern;
	assert.equal(packagePattern.test('Soundscaper-1.0.0-rc.7-mac-arm64.dmg'), true);
	assert.equal(packagePattern.test('Soundscaper-1.0.0-rc.1-mac-arm64.dmg'), false);
});
