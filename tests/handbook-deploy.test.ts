/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareHandbookDeployment, verifyIndependentHandbook } from '../scripts/lib/handbook-deploy.ts';
import { matchedHeaders, parseHeaderRules } from '../scripts/lib/product-web-routing.mjs';

for (const productId of ['soundscaper', 'framescaper']) {
	test(`${productId} handbook deployment stages only documentation with its existing policies`, async context => {
		const root = await mkdtemp(join(tmpdir(), 'handbook-deploy-'));
		context.after(() => rm(root, { recursive: true, force: true }));
		await mkdir(join(root, 'handbook/dist/_astro'), { recursive: true });
		await mkdir(join(root, 'public'));
		await writeFile(join(root, 'public/_headers'), await readFile(new URL('../public/_headers', import.meta.url)));
		await writeFile(join(root, 'handbook/dist/index.html'), `<link rel="canonical" href="https://${productId}.org/docs/"><link href="/docs/_astro/style.css">`);
		await writeFile(join(root, 'handbook/dist/_astro/style.css'), 'body {}');
		await writeFile(join(root, 'handbook/dist/404.html'), 'Missing handbook page');
		const outputRoot = await prepareHandbookDeployment({ repositoryRoot: root, productId });
		assert.match(await readFile(join(outputRoot, 'docs/index.html'), 'utf8'), new RegExp(`${productId}\\.org/docs/`, 'u'));
		const rules = parseHeaderRules(await readFile(join(outputRoot, '_headers'), 'utf8'));
		const document = matchedHeaders(rules, '/docs/');
		assert.deepEqual(document.get('cross-origin-opener-policy'), ['same-origin']);
		assert.deepEqual(document.get('cross-origin-embedder-policy'), ['credentialless']);
		assert.deepEqual(document.get('cache-control'), ['no-cache']);
		assert.deepEqual(document.get('x-scape-handbook'), ['independent']);
		assert.deepEqual(document.get('permissions-policy'), ['microphone=(), speaker-selection=(), display-capture=(), camera=(), geolocation=()']);
		assert.deepEqual(matchedHeaders(rules, '/docs/_astro/style.css').get('cache-control'), ['public, max-age=31536000, immutable']);
		const redirects = await readFile(join(outputRoot, '_redirects'), 'utf8');
		assert.match(redirects, /^\/docs \/docs\/ 301$/mu);
		assert.doesNotMatch(redirects, /^\/framescaper\//mu);
		if (productId === 'soundscaper') assert.match(redirects, /\/docs\/framescaper\/ https:\/\/framescaper\.org\/docs\/ 301/u);
		await writeFile(join(outputRoot, 'stale-editor.js'), 'not part of the handbook');
		await prepareHandbookDeployment({ repositoryRoot: root, productId });
		await assert.rejects(readFile(join(outputRoot, 'stale-editor.js')), { code: 'ENOENT' });
		await assert.rejects(prepareHandbookDeployment({
			repositoryRoot: root, productId: productId === 'soundscaper' ? 'framescaper' : 'soundscaper',
		}), /was built for https:\/\//u);
	});
}

test('handbook Workers own only documentation routes on the existing product domains', async () => {
	const configuration = JSON.parse(await readFile(new URL('../wrangler.handbook.jsonc', import.meta.url), 'utf8')) as {
		workers_dev: boolean;
		preview_urls: boolean;
		assets: { directory: string; html_handling: string; not_found_handling: string };
		env: Record<string, { name: string; routes: { pattern: string; zone_name: string }[] }>;
	};
	assert.equal(configuration.workers_dev, false);
	assert.equal(configuration.preview_urls, false);
	assert.equal(configuration.assets.directory, './.wrangler/handbook-site');
	assert.equal(configuration.assets.html_handling, 'force-trailing-slash');
	assert.equal(configuration.assets.not_found_handling, '404-page');
	for (const productId of ['soundscaper', 'framescaper']) {
		assert.equal(configuration.env[productId].name, `${productId}-handbook`);
		assert.deepEqual(configuration.env[productId].routes, [
			{ pattern: `${productId}.org/docs`, zone_name: `${productId}.org` },
			{ pattern: `${productId}.org/docs/*`, zone_name: `${productId}.org` },
		]);
	}
});

test('product publication requires the independent docs route before removing the Pages copy', async () => {
	const options = { origin: 'https://soundscaper.org' };
	await assert.rejects(verifyIndependentHandbook({ ...options,
		fetchImpl: () => Promise.resolve(new Response('old Pages handbook')),
	}), /Run the Handbook workflow/u);
	await assert.rejects(verifyIndependentHandbook({ ...options,
		fetchImpl: () => Promise.resolve(new Response('missing', { status: 404 })),
	}), /Run the Handbook workflow/u);
	await verifyIndependentHandbook({ ...options, fetchImpl: input => {
		assert.equal(new URL(String(input)).pathname, '/docs/');
		return Promise.resolve(new Response('independent handbook', { headers: { 'x-scape-handbook': 'independent' } }));
	} });
});
