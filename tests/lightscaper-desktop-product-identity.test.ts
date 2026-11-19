/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { productProfile } from '../src/common/products.js';
import { soundscaperConstantsSource } from '../scripts/lib/desktop-product-package-files.mjs';
import { resolveProductDesktopMetadata } from '../scripts/lib/product-release-lines.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONSTANTS_PATH = new URL('../desktop/constants.js', import.meta.url);
const SELECT_METADATA = `
const constants = await import(CONSTANTS_URL);
process.stdout.write(JSON.stringify({
 productId: constants.PRODUCT_ID, name: constants.APP_NAME, id: constants.APP_ID,
 scheme: constants.APP_SCHEME, origin: constants.APP_ORIGIN,
 partition: constants.SESSION_PARTITION, suffix: constants.PROJECT_FILE_EXTENSION,
 declaredVersion: constants.DECLARED_APPLICATION_VERSION,
 applicationVersionChannel: constants.APPLICATION_VERSION_CHANNEL,
 releaseChannel: constants.RELEASE_CHANNEL, updateTagPrefix: constants.UPDATE_TAG_PREFIX,
 webVcrEnabled: constants.FRAMESCAPER_WEB_VCR_ENABLED ?? false,
 homepage: constants.EXTERNAL_DESTINATIONS.homepage,
 privacyEn: constants.EXTERNAL_DESTINATIONS['privacy-en'],
 privacyDe: constants.EXTERNAL_DESTINATIONS['privacy-de'],
}));`;

test('Lightscaper desktop identity owns its private origin, storage partition and suffix', () => {
	assert.deepEqual(readMetadata(CONSTANTS_PATH, 'lightscaper'), {
		productId: 'lightscaper', name: 'Lightscaper', id: 'org.lightscaper.desktop',
		scheme: 'lightscaper-app', origin: 'lightscaper-app://bundle',
		partition: 'persist:lightscaper-production', suffix: '.liscape', declaredVersion: null,
		applicationVersionChannel: 'candidate', releaseChannel: 'deferred',
		updateTagPrefix: 'lightscaper-v', webVcrEnabled: false,
		homepage: 'https://lightscaper.org/', privacyEn: 'https://lightscaper.org/privacy/en/',
		privacyDe: 'https://lightscaper.org/privacy/de/',
	});
});

test('Lightscaper packaged metadata uses its own release-line version', async (context) => {
	const metadata = resolveProductDesktopMetadata('lightscaper');
	const constants = await constantsFixture(context, await readFile(CONSTANTS_PATH, 'utf8'), metadata);
	const selected = readMetadata(constants, undefined);
	assert.equal(selected.productId, 'lightscaper');
	assert.equal(selected.declaredVersion, metadata.applicationVersion);
	assert.equal(selected.applicationVersionChannel, metadata.applicationVersionChannel);
	assert.equal(selected.releaseChannel, 'deferred');
	assert.equal(selected.updateTagPrefix, 'lightscaper-v');
});

test('Lightscaper desktop profile agrees with main-process identity without enabling capture', () => {
	const profile = productProfile('lightscaper');
	assert.deepEqual(profile.desktop, {
		appId: 'org.lightscaper.desktop', scheme: 'lightscaper-app',
		sessionPartition: 'persist:lightscaper-production', executableName: 'lightscaper',
		category: 'Graphics;Photography',
	});
	assert.equal(Object.isFrozen(profile.desktop), true);
	assert.equal(profile.projectFileExtension, '.liscape');
	assert.deepEqual(profile.applicationFeatures, {});
	assert.equal(profile.capabilities.audioRecording, false);
});

test('Lightscaper identity admission preserves each peer and refuses approximate IDs', () => {
	for (const [productId, name, suffix] of [
		['soundscaper', 'Soundscaper', '.sscape'], ['framescaper', 'Framescaper', '.fscape'],
	]) {
		const selected = readMetadata(CONSTANTS_PATH, productId);
		assert.equal(selected.productId, productId);
		assert.equal(selected.name, name);
		assert.equal(selected.id, `org.${productId}.desktop`);
		assert.equal(selected.origin, `${productId}-app://bundle`);
		assert.equal(selected.partition, `persist:${productId}-production`);
		assert.equal(selected.suffix, suffix);
		assert.equal(selected.homepage, `https://${productId}.org/`);
	}
	for (const value of ['', 'Lightscaper', 'lightscaper ', 'unknown']) {
		const result = runNode(SELECT_METADATA.replace('CONSTANTS_URL', JSON.stringify(CONSTANTS_PATH.href)), value);
		assert.notEqual(result.status, 0, `Desktop identity accepted ${JSON.stringify(value)}.`);
		assert.match(result.stderr, /SCAPE_PRODUCT.*lightscaper/isu);
	}
});

test('Lightscaper suffix registration preserves Soundscaper staged constants isolation', async (context) => {
	const source = soundscaperConstantsSource(await readFile(CONSTANTS_PATH, 'utf8'));
	const constants = await constantsFixture(context, source, resolveProductDesktopMetadata('soundscaper'));
	const selected = readMetadata(constants, 'lightscaper');
	assert.equal(selected.productId, 'soundscaper');
	assert.equal(selected.suffix, '.sscape');
	assert.equal(selected.origin, 'soundscaper-app://bundle');
	assert.equal(selected.partition, 'persist:soundscaper-production');
	assert.equal(selected.homepage, 'https://soundscaper.org/');
	assert.doesNotMatch(source, /framescaper:v1:|FRAMESCAPER_WEB_VCR_|chooseLinkedVideo|desktopVideoCodec/u);
});

function readMetadata(url: URL, productId: string | undefined): Record<string, unknown> {
	const result = runNode(SELECT_METADATA.replace('CONSTANTS_URL', JSON.stringify(url.href)), productId);
	assert.equal(result.status, 0, result.stderr);
	const value: unknown = JSON.parse(result.stdout);
	assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}

function runNode(source: string, productId: string | undefined) {
	const env: NodeJS.ProcessEnv = { ...process.env };
	if (productId === undefined) delete env.SCAPE_PRODUCT;
	else env.SCAPE_PRODUCT = productId;
	return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
		cwd: ROOT, env, encoding: 'utf8', timeout: 10_000,
	});
}

async function constantsFixture(context: TestContext, source: string, metadata: unknown): Promise<URL> {
	const root = await mkdtemp(join(tmpdir(), 'lightscaper-desktop-identity-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
	await writeFile(join(root, 'constants.js'), source);
	await writeFile(join(root, 'product.json'), JSON.stringify(metadata));
	return pathToFileURL(join(root, 'constants.js'));
}
