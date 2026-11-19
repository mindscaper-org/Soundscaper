/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { handleDownloadPageRequest } from '../functions/download/index.ts';
import { ROUTE_LOCALES } from '../src/common/i18n/locales.js';

const fetchRelease: typeof fetch = async () => Response.json(['Soundscaper', 'Framescaper'].map(name => ({
	tag_name: `${name.toLowerCase()}-v1.0.0-rc.1`, published_at: '2026-10-30T12:00:00Z', draft: false,
	assets: ['win-x64.exe', 'mac-arm64.dmg', 'linux-arm64.deb', 'SHA256SUMS', 'sources.zip', 'THIRD_PARTY_LICENSES.md', 'Soundscaper-AGPL-3.0.txt']
		.map(target => ({ name: target.includes('.') && !target.startsWith('Soundscaper-AGPL') && !target.endsWith('.md') && target !== 'sources.zip'
			? `${name}-1.0.0-rc.1-${target}` : target, state: 'uploaded' })),
})));

for (const product of ['soundscaper', 'framescaper']) {
	test(`${product} serves every supported download language with localized navigation and metadata`, async () => {
		for (const { locale, direction } of ROUTE_LOCALES) {
			const response = await handleDownloadPageRequest(new Request(`https://${product}.org/download/${locale}/`), fetchRelease);
			assert.equal(response.status, 200, locale);
			assert.equal(response.headers.get('content-language'), locale);
			const document = new JSDOM(await response.text()).window.document;
			assert.equal(document.documentElement.lang, locale);
			assert.equal(document.documentElement.dir, direction);
			assert.equal(document.querySelector('link[rel="canonical"]')?.getAttribute('href'), `https://${product}.org/download/${locale}/`);
			assert.equal(document.querySelectorAll('link[rel="alternate"]').length, ROUTE_LOCALES.length + 1);
			assert.equal(document.querySelector('.brand')?.getAttribute('href'), `/${locale}/`);
			assert.equal(document.querySelector('.browser-option a')?.getAttribute('href'), `/${locale}/`);
			assert.ok(document.querySelector(`a[href="/docs/${locale === 'en' ? '' : `${locale.toLowerCase()}/`}"]`), locale);
			const peer = product === 'soundscaper' ? 'framescaper' : 'soundscaper';
			assert.ok(document.querySelector(`a[href="https://${peer}.org/download/${locale}/"]`), locale);
			assert.ok(document.querySelector(`footer a[href="/privacy/${locale === 'de' ? 'de' : 'en'}/"]`), locale);
			for (const descriptor of ROUTE_LOCALES) {
				assert.ok(document.querySelector(`nav a[hreflang="${descriptor.locale}"][href="/download/${descriptor.locale}/"]`), locale);
			}
			assert.ok(!document.body.textContent?.match(/\{[a-zA-Z]+\}/u), locale);
			if (!locale.startsWith('en')) {
				assert.notEqual(document.querySelector('h1')?.textContent, `Download ${product === 'soundscaper' ? 'Soundscaper' : 'Framescaper'}`, locale);
				assert.notEqual(document.querySelector('.other-downloads summary')?.textContent, 'Other downloads', locale);
			}
		}
	});
}

test('German download copy covers packages, resources, UTC dates and localized retry states', async () => {
	const request = new Request('https://soundscaper.org/download/de', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
	const response = await handleDownloadPageRequest(request, fetchRelease);
	const html = await response.text();
	assert.match(html, /<h1>Soundscaper herunterladen<\/h1>/u);
	assert.match(html, /Windows x64-Installationsprogramm/u);
	assert.match(html, /Prüfsummen/u);
	assert.match(html, /30\. Oktober 2026/u);
	const empty = await handleDownloadPageRequest(request, async () => Response.json([]));
	assert.equal(empty.status, 200);
	assert.match(await empty.text(), /Noch kein Release Candidate verfügbar/u);
	const failed = await handleDownloadPageRequest(request, async () => new Response(null, { status: 503 }));
	assert.equal(failed.status, 503);
	assert.equal(failed.headers.get('retry-after'), '300');
	const failedHtml = await failed.text();
	assert.match(failedHtml, /Downloads sind vorübergehend nicht verfügbar/u);
	assert.match(failedHtml, /href="https:\/\/soundscaper.org\/download\/de\/">Erneut versuchen/u);
});

test('localized routes accept lowercase regional tags, support HEAD and reject unknown languages before fetching', async () => {
	const regional = await handleDownloadPageRequest(new Request('https://framescaper.org/download/pt-br/'), fetchRelease);
	assert.equal(regional.status, 200);
	assert.equal(regional.headers.get('content-language'), 'pt-BR');
	const head = await handleDownloadPageRequest(new Request('https://soundscaper.org/download/ar', { method: 'HEAD' }), fetchRelease);
	assert.equal(head.status, 200);
	assert.equal(head.headers.get('content-language'), 'ar');
	assert.equal(await head.text(), '');
	const noFetch: typeof fetch = async () => { assert.fail('Invalid routes must not fetch releases'); };
	for (const path of ['/download/xx/', '/download/af/', '/download/de/extra', '/download/%3Cscript%3E/']) {
		assert.equal((await handleDownloadPageRequest(new Request(`https://soundscaper.org${path}`), noFetch)).status, 404);
	}
});

test('Pages invocation rules cover localized download paths', async () => {
	const rules = JSON.parse(await readFile(new URL('../public/_routes.json', import.meta.url), 'utf8')) as { include: string[] };
	assert.ok(rules.include.includes('/download/*'));
});
