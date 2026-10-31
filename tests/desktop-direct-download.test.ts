/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { handleDesktopDownloadRequest } from '../functions/download/desktop/index.ts';

const RELEASES = 'https://github.com/LeoWattenberg/Soundscaper/releases';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36';

function release(product: string, version: string, suffixes: readonly string[], published = '2026-10-25T00:00:00Z') {
	const name = product === 'soundscaper' ? 'Soundscaper' : 'Framescaper';
	return {
		tag_name: `${product}-v${version}`, published_at: published, draft: false,
		assets: suffixes.map((suffix) => ({ name: `${name}-${version}-${suffix}`, state: 'uploaded' })),
	};
}

async function download(path: string, releases: unknown, headers: HeadersInit = {}, product = 'soundscaper') {
	const fetchImpl: typeof fetch = async () => Response.json(releases);
	return handleDesktopDownloadRequest(new Request(`https://${product}.org/download/desktop/${path}`, { headers }), fetchImpl);
}

const PACKAGES = [
	['windows-x64.exe', 'win-x64.exe'], ['windows-arm64.exe', 'win-arm64.exe'],
	['windows-x64.zip', 'win-x64.zip'], ['windows-arm64.zip', 'win-arm64.zip'],
	['mac-arm64.pkg', 'mac-arm64.pkg'], ['mac-arm64.dmg', 'mac-arm64.dmg'],
	['linux-x64.AppImage', 'linux-x64.AppImage'], ['linux-arm64.AppImage', 'linux-arm64.AppImage'],
	['linux-x64.deb', 'linux-x64.deb'], ['linux-arm64.deb', 'linux-arm64.deb'],
	['linux-x64.flatpak', 'linux-x64.flatpak'], ['linux-arm64.flatpak', 'linux-arm64.flatpak'],
] as const;

for (const product of ['soundscaper', 'framescaper']) {
	test(`${product} provides stable direct URLs for each desktop package`, async () => {
		const version = '1.0.0-rc.Oct.25.a';
		const published = release(product, version, PACKAGES.map(([, suffix]) => suffix));
		for (const [alias, suffix] of PACKAGES) {
			const response = await download(`${product}-${alias}`, [published], { 'User-Agent': WINDOWS }, product);
			assert.equal(response.status, 302);
			assert.equal(response.headers.get('location'),
				`${RELEASES}/download/${published.tag_name}/${product === 'soundscaper' ? 'Soundscaper' : 'Framescaper'}-${version}-${suffix}`);
			assert.equal(response.headers.get('cache-control'), 'no-store');
		}
	});
}

test('the generic direct-download endpoint resolves the Windows installer', async () => {
	const response = await download('', [release('soundscaper', '1.0.0-rc.1', ['win-x64.zip', 'win-x64.exe'])],
		{ 'User-Agent': WINDOWS });
	assert.equal(response.headers.get('location'),
		`${RELEASES}/download/soundscaper-v1.0.0-rc.1/Soundscaper-1.0.0-rc.1-win-x64.exe`);
	assert.ok(response.headers.get('vary')?.includes('User-Agent'));
});

test('desktop platform selection honors architecture hints and avoids mobile or unsupported architectures', async () => {
	const published = release('soundscaper', '1.0.0-rc.1', PACKAGES.map(([, suffix]) => suffix));
	const cases: readonly [HeadersInit, string | null][] = [
		[{ 'User-Agent': WINDOWS, 'Sec-CH-UA-Arch': '"arm"', 'Sec-CH-UA-Bitness': '"64"' }, 'win-arm64.exe'],
		[{ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; ARM64)' }, 'win-arm64.exe'],
		[{ 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' }, 'linux-x64.AppImage'],
		[{ 'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64)' }, 'linux-arm64.AppImage'],
		[{ 'Sec-CH-UA-Platform': '"macOS"', 'Sec-CH-UA-Arch': '"arm"', 'Sec-CH-UA-Bitness': '"64"' }, 'mac-arm64.pkg'],
		[{ 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }, null],
		[{ 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; arm64) Mobile' }, null],
		[{ 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }, null],
		[{ 'User-Agent': 'Mozilla/5.0 (X11; Linux armv7l)' }, null],
		[{ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64)' }, 'win-x64.exe'],
		[{}, null],
	];
	for (const [headers, suffix] of cases) {
		const response = await download('', [published], headers);
		assert.equal(response.headers.get('location'), suffix
			? `${RELEASES}/download/${published.tag_name}/Soundscaper-1.0.0-rc.1-${suffix}`
			: `${RELEASES}/tag/${published.tag_name}`, JSON.stringify(headers));
	}
});

test('direct downloads select the newest published matching package across product and release channels', async () => {
	const stable = { ...release('soundscaper', '1.0.0', ['win-x64.exe']), tag_name: 'v1.0.0' };
	const releases = [
		stable,
		release('soundscaper', '1.1.0-beta.1', ['win-x64.exe'], '2026-10-26T00:00:00Z'),
		release('soundscaper', '1.1.0-rc.1', ['linux-x64.AppImage'], '2026-10-27T00:00:00Z'),
		release('framescaper', '2.0.0-rc.1', ['win-x64.exe'], '2026-10-28T00:00:00Z'),
		{ ...release('soundscaper', '1.1.0-rc.2', ['win-x64.exe'], '2026-10-29T00:00:00Z'), draft: true },
	];
	assert.equal((await download('soundscaper-windows-x64.exe', releases)).headers.get('location'),
		`${RELEASES}/download/soundscaper-v1.1.0-beta.1/Soundscaper-1.1.0-beta.1-win-x64.exe`);
	assert.equal((await download('soundscaper-windows-x64.exe', [stable])).headers.get('location'),
		`${RELEASES}/download/v1.0.0/Soundscaper-1.0.0-win-x64.exe`);
});

test('direct downloads only trust uploaded package names that match the release version and product', async () => {
	const published = release('soundscaper', '1.0.0-rc.1', ['win-arm64.exe']);
	const poisoned = {
		...published,
		assets: [
			{ name: 'Soundscaper-1.0.0-rc.1-win-x64.exe', state: 'new' },
			{ name: 'Soundscaper-0.9.0-win-x64.exe', state: 'uploaded' },
			{ name: 'Soundscaper-1.0.0-rc.1-source-win-x64.exe', state: 'uploaded' },
			{ name: 'Framescaper-1.0.0-rc.1-win-x64.exe', state: 'uploaded' },
			...published.assets,
		],
	};
	assert.equal((await download('soundscaper-windows-x64.exe', [poisoned])).headers.get('location'),
		`${RELEASES}/tag/${published.tag_name}`);
	const available = release('soundscaper', '1.0.0-rc.2', ['win-x64.exe']);
	Object.assign(available.assets[0]!, { browser_download_url: 'https://attacker.example/installer.exe' });
	assert.equal((await download('soundscaper-windows-x64.exe', [available])).headers.get('location'),
		`${RELEASES}/download/${available.tag_name}/Soundscaper-1.0.0-rc.2-win-x64.exe`);
});

test('invalid or cross-product aliases are refused without querying GitHub', async () => {
	const fetchImpl: typeof fetch = async () => { throw new Error('must not fetch'); };
	for (const path of ['framescaper-windows-x64.exe', 'soundscaper-windows-x86.exe', 'unknown', 'soundscaper-windows-x64.exe/extra']) {
		const response = await handleDesktopDownloadRequest(new Request(`https://soundscaper.org/download/desktop/${path}`), fetchImpl);
		assert.equal(response.status, 404, path);
	}
});

test('direct links support HEAD and preserve the product fallback when release lookup fails', async () => {
	const url = 'https://soundscaper.org/download/desktop/soundscaper-windows-x64.exe';
	const fetchImpl: typeof fetch = async () => Response.json([release('soundscaper', '1.0.0-rc.1', ['win-x64.exe'])]);
	const response = await handleDesktopDownloadRequest(new Request(url, { method: 'HEAD' }), fetchImpl);
	assert.equal(response.status, 302);
	assert.equal(await response.text(), '');
	assert.equal(response.headers.get('location'),
		`${RELEASES}/download/soundscaper-v1.0.0-rc.1/Soundscaper-1.0.0-rc.1-win-x64.exe`);
	const unavailable: typeof fetch = async () => new Response(null, { status: 503 });
	assert.equal((await handleDesktopDownloadRequest(new Request(url), unavailable)).headers.get('location'), `${RELEASES}?q=soundscaper`);
});
