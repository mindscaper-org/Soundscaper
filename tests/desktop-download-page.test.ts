/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { handleDownloadPageRequest } from '../functions/download/index.ts';
import { selectLatestDesktopRc } from '../src/common/site/desktop-releases.ts';

const RELEASES = 'https://github.com/LeoWattenberg/Soundscaper/releases';

function release(product: string, version: string, published = '2026-10-28T12:00:00Z') {
	const name = product === 'soundscaper' ? 'Soundscaper' : 'Framescaper';
	return {
		tag_name: `${product}-v${version}`, published_at: published, draft: false,
		assets: ['win-x64.exe', 'mac-arm64.dmg', 'linux-arm64.AppImage'].map(target => ({
			name: `${name}-${version}-${target}`, state: 'uploaded',
			browser_download_url: 'https://attacker.example/installer',
		})),
	};
}

test('download pages select the latest published RC independently for each product', () => {
	const current = release('soundscaper', '1.0.0-rc.Oct.29.b', '2026-10-30T12:00:00Z');
	const releases = [
		release('soundscaper', '1.0.0-rc.999'), current,
		release('framescaper', '1.0.0-rc.Oct.28.f'),
		release('soundscaper', '2.0.0-beta.1', '2026-10-31T12:00:00Z'),
		release('soundscaper', '2.0.0', '2026-10-31T12:00:00Z'),
		{ ...release('soundscaper', '1.0.0-rc.1000', '2026-10-31T12:00:00Z'), draft: true },
		{ ...release('soundscaper', '1.0.0-rc.1001', '2026-10-31T12:00:00Z'), assets: [{ name: 'sources.zip', state: 'uploaded' }] },
		{ ...release('soundscaper', '1.0.0-rc.1002'), published_at: 'invalid' },
	];
	assert.equal(selectLatestDesktopRc(releases, 'soundscaper')?.version, '1.0.0-rc.Oct.29.b');
	assert.equal(selectLatestDesktopRc(releases, 'framescaper')?.version, '1.0.0-rc.Oct.28.f');
	assert.equal(selectLatestDesktopRc([releases[3], releases[4]], 'soundscaper'), null);
});

for (const product of ['soundscaper', 'framescaper'] as const) {
	test(`${product} download page lists only uploaded packages from its selected RC`, async () => {
		const current = release(product, '1.0.0-rc.Oct.29.b');
		current.assets.push(
			{ name: 'SHA256SUMS', state: 'uploaded', browser_download_url: 'https://attacker.example/hash' },
			{ name: 'sources.zip', state: 'uploaded', browser_download_url: 'https://attacker.example/source' },
			{ name: 'Framescaper-1.0.0-rc.other-win-arm64.exe', state: 'uploaded', browser_download_url: '' },
			{ name: `${product === 'soundscaper' ? 'Soundscaper' : 'Framescaper'}-1.0.0-rc.Oct.29.b-win-arm64.exe`,
				state: 'new', browser_download_url: '' },
		);
		const response = await handleDownloadPageRequest(new Request(`https://${product}.org/download/`),
			async () => Response.json([current]));
		const html = await response.text();
		assert.equal(response.status, 200);
		assert.match(response.headers.get('content-type') ?? '', /^text\/html/u);
		assert.equal(response.headers.get('cache-control'), 'no-store');
		assert.match(html, new RegExp(`<h1>Download ${product === 'soundscaper' ? 'Soundscaper' : 'Framescaper'}</h1>`, 'u'));
		assert.ok(html.includes(`href="https://${product}.org/download/"`));
		assert.ok(html.includes(`href="${RELEASES}/download/${current.tag_name}/${current.assets[0]?.name}"`));
		assert.ok(html.includes(`href="${RELEASES}/tag/${current.tag_name}"`));
		assert.ok(html.includes(`href="${RELEASES}/download/${current.tag_name}/SHA256SUMS"`));
		assert.ok(html.includes(`href="${RELEASES}/download/${current.tag_name}/sources.zip"`));
		assert.ok(!html.includes('attacker.example'));
		assert.ok(!html.includes('rc.other'));
		assert.ok(!html.includes('win-arm64.exe'));
	});
}

test('a newer release appears on the next visit without rebuilding the page', async () => {
	let version = '1.0.0-rc.1';
	const fetchImpl: typeof fetch = async () => Response.json([release('soundscaper', version)]);
	const request = new Request('https://soundscaper.org/download');
	assert.ok((await (await handleDownloadPageRequest(request, fetchImpl)).text()).includes(version));
	version = '1.0.0-rc.2';
	const updated = await (await handleDownloadPageRequest(request, fetchImpl)).text();
	assert.ok(updated.includes(version));
	assert.ok(!updated.includes('1.0.0-rc.1'));
});

test('no RC and an unavailable release feed leave a usable release link with distinct messages', async () => {
	const request = new Request('https://soundscaper.org/download/');
	const empty = await handleDownloadPageRequest(request, async () => Response.json([]));
	assert.equal(empty.status, 200);
	assert.match(await empty.text(), /No release candidate is available yet/u);
	const unavailable = await handleDownloadPageRequest(request, async () => new Response(null, { status: 503 }));
	const html = await unavailable.text();
	assert.equal(unavailable.status, 503);
	assert.equal(unavailable.headers.get('retry-after'), '300');
	assert.match(html, /could not load the latest release candidate/u);
	assert.ok(html.includes(`${RELEASES}?q=soundscaper`));
});

test('download page supports HEAD and rejects unknown hosts, paths and methods before fetching', async () => {
	const fetchImpl: typeof fetch = async () => { throw new Error('should not fetch'); };
	for (const url of ['https://other.example/download/', 'https://soundscaper.org/download/other']) {
		assert.equal((await handleDownloadPageRequest(new Request(url), fetchImpl)).status, 404);
	}
	const post = await handleDownloadPageRequest(new Request('https://soundscaper.org/download/', { method: 'POST' }), fetchImpl);
	assert.equal(post.status, 405);
	assert.equal(post.headers.get('allow'), 'GET, HEAD');
	const head = await handleDownloadPageRequest(new Request('https://soundscaper.org/download/', { method: 'HEAD' }),
		async () => Response.json([release('soundscaper', '1.0.0-rc.1')]));
	assert.equal(head.status, 200);
	assert.equal(await head.text(), '');
});
