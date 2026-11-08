/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import test from 'node:test';
import { assertPlan, browserProductSiteForBuild, ordinaryBrowserProductSitePlan } from '../scripts/lib/browser-product-site-plan.mjs';
import { prepareOrdinaryBrowserProductSites, recordBrowserProductSiteEvidence } from '../scripts/lib/browser-product-test-sites.mjs';

test('a focused browser plan starts one product while retaining its distinct peer origin', () => {
	const framescaper = ordinaryBrowserProductSitePlan({ SCAPE_BROWSER_PRODUCTS: 'framescaper', PLAYWRIGHT_PORT: '4610' });
	assert.deepEqual(framescaper.sites.map(site => site.productId), ['framescaper']);
	assert.equal(framescaper.sites[0]!.origin, 'http://127.0.0.1:4611');
	assert.equal(framescaper.sites[0]!.peerOrigin, 'http://127.0.0.1:4610');
	const soundscaper = ordinaryBrowserProductSitePlan({ SCAPE_BROWSER_PRODUCTS: 'soundscaper' });
	assert.deepEqual(soundscaper.sites.map(site => site.productId), ['soundscaper']);
	assert.doesNotThrow(() => assertPlan(framescaper));
	assert.doesNotThrow(() => assertPlan(soundscaper));
	const lightscaper = ordinaryBrowserProductSitePlan({ SCAPE_BROWSER_PRODUCTS: 'lightscaper' });
	assert.deepEqual(lightscaper.sites.map(site => site.productId), ['lightscaper']);
	assert.equal(lightscaper.sites[0]!.origin, 'http://127.0.0.1:4324');
	assert.equal(lightscaper.sites[0]!.peerOrigin, 'http://127.0.0.1:4322');
	assert.doesNotThrow(() => assertPlan(lightscaper));
	assert.equal(browserProductSiteForBuild('lightscaper', { SCAPE_BROWSER_PRODUCTS: 'framescaper' }).productId, 'lightscaper');
	assert.deepEqual(ordinaryBrowserProductSitePlan({}).sites.map(site => site.productId), ['soundscaper', 'framescaper', 'lightscaper']);
});

test('browser product selection rejects unknown and repeated products, empty fields and origin collisions', () => {
	for (const selection of ['other', 'framescaper,framescaper', 'soundscaper,', ',framescaper']) {
		assert.throws(() => ordinaryBrowserProductSitePlan({ SCAPE_BROWSER_PRODUCTS: selection }), /product/iu);
	}
	assert.throws(() => ordinaryBrowserProductSitePlan({ SCAPE_BROWSER_PRODUCTS: 'framescaper', PLAYWRIGHT_PORT: '4610', PLAYWRIGHT_FRAMESCAPER_PORT: '4610' }), /different ports/iu);
	const both = ordinaryBrowserProductSitePlan({});
	assert.doesNotThrow(() => assertPlan(both));
	const wrongPeer = both.sites.map(site => site.productId === 'lightscaper' ? { ...site, peerOrigin: both.sites[1]!.origin } : site);
	assert.throws(() => assertPlan({ sites: wrongPeer }), /peer origins/u);
	assert.throws(() => assertPlan({ sites: [] }), /nonempty/iu);
	assert.throws(() => assertPlan({ sites: [both.sites[0], both.sites[0]] }), /unique|duplicate/iu);
	assert.throws(() => assertPlan({ sites: [both.sites[0], { ...both.sites[1], origin: both.sites[0]!.origin }] }), /origin|different/iu);
});

test('Framescaper and Lightscaper-only preparation authenticates each build without an absent Soundscaper producer', async context => {
	for (const productId of ['framescaper', 'lightscaper']) {
		const site = await fixtureSite(productId, context);
		await prepareOrdinaryBrowserProductSites({ sites: [site] }, { soundscaperBuildDirectory: '.wrangler/absent-module-producer', sourceMaps: false });
		await writeFile(resolve(site.outputDirectory, '_headers'), 'tampered');
		await assert.rejects(() => prepareOrdinaryBrowserProductSites({ sites: [site] }, { sourceMaps: false }), /browser file changed/iu);
	}
});

test('Soundscaper-only preparation copies and verifies its producer without requiring Framescaper', async context => {
	const site = await fixtureSite('soundscaper', context);
	const source = site.outputDirectory;
	const destination = `${source}-consumer`;
	context.after(() => rm(resolve(destination), { recursive: true, force: true }));
	const consumer = { ...site, outputDirectory: destination };
	await prepareOrdinaryBrowserProductSites({ sites: [consumer] }, { soundscaperBuildDirectory: source, sourceMaps: false });
	assert.equal(await readFile(resolve(destination, '_headers'), 'utf8'), 'headers');
	await prepareOrdinaryBrowserProductSites({ sites: [consumer] }, { reusePrepared: true, soundscaperBuildDirectory: '.wrangler/absent-module-producer', sourceMaps: false });
});

async function fixtureSite(productId: string, context: { after: (callback: () => Promise<void>) => void }) {
	await mkdir(resolve('.wrangler'), { recursive: true });
	const directory = await mkdtemp(resolve('.wrangler/module-browser-sites-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const outputDirectory = relative(resolve('.'), directory).replaceAll('\\', '/');
	const site = { productId, origin: `http://127.0.0.1:${productId === 'soundscaper' ? '4610' : '4611'}`,
		peerOrigin: `http://127.0.0.1:${productId === 'soundscaper' ? '4611' : '4610'}`, outputDirectory };
	await mkdir(resolve(directory, 'en'));
	for (const [file, content] of [
		['en/index.html', `<html data-product="${productId}"></html>`], ['_headers', 'headers'], ['_redirects', ''],
		['offline-shell.json', '{}'], ['service-worker.js', ''], [`manifest-${productId}.webmanifest`, '{}'],
	] as const) await writeFile(resolve(directory, file), content);
	await recordBrowserProductSiteEvidence(site);
	return site;
}
