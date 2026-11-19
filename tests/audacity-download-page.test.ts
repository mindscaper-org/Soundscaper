/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { handleAudacityDownloadRequest } from '../functions/download/audacity/index.ts';
import { AUDACITY_DOWNLOAD_LANGUAGES } from '../src/common/site/audacity-download/localization.ts';
import { parseAudacityRelease } from '../src/common/site/audacity-download/releases.ts';
import { handleDownloadPageRequest } from '../functions/download/index.ts';

const offline: typeof fetch = async () => new Response(null, { status: 503 });
const request = (path = 'en/', headers: HeadersInit = {}) => new Request(`https://soundscaper.org/download/audacity/${path}`, { headers });

test('every imported language renders all three editors and a localized comparison without source-site branding', async () => {
	test.mock.method(console, 'warn', () => undefined);
	for (const locale of AUDACITY_DOWNLOAD_LANGUAGES) {
		const response = await handleAudacityDownloadRequest(request(`${locale}/`), offline);
		const html = await response.text();
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('content-language'), locale);
		assert.ok(html.includes(`<html lang="${locale}"`));
		assert.ok(html.includes(`rel="canonical" href="https://soundscaper.org/download/audacity/${locale}/"`));
		for (const product of ['soundscaper', 'audacity4', 'audacity3']) assert.ok(html.includes(`aria-labelledby="${product}-title"`));
		assert.ok(html.includes('<table'));
		assert.ok(html.includes('Audacity 4.0.2'));
		assert.ok(html.includes('Audacity 3.7.9'));
		assert.ok(!/kw\.media|SiteSidebar|CookieConsent/u.test(html));
		assert.ok(html.includes(`href="/${locale}/"`));
		if (locale === 'fr') {
			assert.ok(html.includes('Pistes temporelles'));
			assert.ok(html.includes('Mis à jour le 15 novembre 2026.'));
		}
		if (locale === 'de') assert.ok(html.includes('Zeitspuren'));
	}
});

test('entry routes, regional case, RTL, HEAD and invalid requests follow download routing contracts', async () => {
	for (const path of ['', 'en', 'pt-br/']) assert.equal((await handleAudacityDownloadRequest(request(path), offline)).status, 200);
	const arabic = await handleAudacityDownloadRequest(request('ar/'), offline);
	assert.match(await arabic.text(), /dir="rtl"/u);
	for (const url of ['https://soundscaper.org/download/audacity/xx/', 'https://framescaper.org/download/audacity/en/',
		'https://soundscaper.org/download/audacity/en/extra/']) {
		assert.equal((await handleAudacityDownloadRequest(new Request(url), offline)).status, 404);
	}
	assert.equal((await handleAudacityDownloadRequest(new Request(request(), { method: 'HEAD' }), offline)).status, 200);
	assert.equal(await (await handleAudacityDownloadRequest(new Request(request(), { method: 'HEAD' }), offline)).text(), '');
	const post = await handleAudacityDownloadRequest(new Request(request(), { method: 'POST' }), () => { throw new Error('Unexpected lookup'); });
	assert.equal(post.status, 405);
	assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('platform hints select native packages while unknown Macs use universal Audacity and mobile keeps the chooser', async () => {
	const windows = await (await handleAudacityDownloadRequest(request('en/', {
		'User-Agent': 'Windows NT 10.0; Win64; x64', 'Sec-CH-UA-Platform': '"Windows"',
		'Sec-CH-UA-Arch': '"arm"', 'Sec-CH-UA-Bitness': '"64"',
	}), offline)).text();
	assert.match(windows, /class="download-main" href="[^"]+audacity-win-4\.0\.2-arm64\.msi"/u);
	const mac = await (await handleAudacityDownloadRequest(request('en/', { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }), offline)).text();
	assert.match(mac, /class="download-main" href="[^"]+audacity-macOS-4\.0\.2-universal\.dmg"/u);
	const mobile = await (await handleAudacityDownloadRequest(request('en/', { 'User-Agent': 'iPhone Mobile' }), offline)).text();
	assert.match(mobile, /id="audacity4-options"><summary class="download-main">Download Audacity/u);
	assert.match(mobile, /href="\/en\/">Open online version/u);
});

test('upstream releases refresh independently and reject untrusted or mismatched asset URLs', async () => {
	const source = `export const audacityReleases = { version: '4.9.1', win: [
		{ name: 'installer', browser_download_url: 'https://github.com/audacity/audacity/releases/download/Audacity-4.9.1/audacity-win-4.9.1-arm64.msi' },
		{ name: 'bad', browser_download_url: 'https://attacker.example/audacity-win-4.9.1-arm64.msi' },
		{ name: 'old', browser_download_url: 'https://github.com/audacity/audacity/releases/download/Audacity-4.0.2/audacity-win-4.0.2-x86_64.msi' }
	] };
`;
	assert.equal(parseAudacityRelease(source).assets.length, 1);
	const fetchImpl: typeof fetch = async url => String(url).includes('raw.githubusercontent.com') ? new Response(source) : Response.json([{
		tag_name: 'Soundscaper-rc.2026.Nov.15.a', draft: false, published_at: '2026-11-15T00:00:00Z',
		assets: [{ name: 'Soundscaper-rc.2026.Nov.15.a-win-arm64.exe', state: 'uploaded' }],
	}]);
	const html = await (await handleAudacityDownloadRequest(request(), fetchImpl)).text();
	assert.ok(html.includes('Soundscaper-rc.2026.Nov.15.a-win-arm64.exe'));
	assert.ok(html.includes('audacity-win-4.9.1-arm64.msi'));
	assert.ok(!html.includes('attacker.example'));
	assert.ok(html.includes('Audacity 4.0.2'), 'the comparison retains its reviewed version');
	const fallback = await (await handleAudacityDownloadRequest(request(), async () => new Response('x'.repeat(262145)))).text();
	assert.ok(fallback.includes('audacity-win-4.0.2-arm64.msi'));
});

test('the existing other-downloads menu reaches the new page family', async () => {
	const html = await (await handleDownloadPageRequest(new Request('https://soundscaper.org/download/de/'), async () => Response.json([{
		tag_name: 'Soundscaper-rc.2026.Nov.15.a', draft: false, published_at: '2026-11-15T00:00:00Z',
		assets: [{ name: 'Soundscaper-rc.2026.Nov.15.a-win-x64.exe', state: 'uploaded' }],
	}]))).text();
	assert.match(html, /<details class="other-downloads">[\s\S]*href="\/download\/audacity\/de\/"[\s\S]*<\/details>/u);
});
