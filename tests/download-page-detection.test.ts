/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { handleDownloadPageRequest } from '../functions/download/index.ts';

const TARGETS = ['win-x64.exe', 'win-arm64.exe', 'win-x64.zip', 'mac-arm64.dmg', 'linux-x64.AppImage', 'linux-arm64.AppImage'];
const VERSION = '1.0.0-rc.Oct.29.b';
const published = {
	tag_name: `soundscaper-v${VERSION}`, published_at: '2026-10-30T12:00:00Z', draft: false,
	assets: [...TARGETS.map(target => `Soundscaper-${VERSION}-${target}`), 'SHA256SUMS']
		.map(name => ({ name, state: 'uploaded' })),
};

async function page(headers: HeadersInit = {}): Promise<Response> {
	return handleDownloadPageRequest(new Request('https://soundscaper.org/download/', { headers }),
		async () => Response.json([published]));
}

test('version and date live in the heading eyebrow and release notes sit beside checksums', async () => {
	const html = await (await page()).text();
	const intro = /<div class="intro">([\s\S]*?)<\/div>/u.exec(html)?.[1] ?? '';
	assert.match(intro, /class="eyebrow">[\s\S]*1\.0\.0-rc\.Oct\.29\.b[\s\S]*<time[^>]*>October 30, 2026<\/time>[\s\S]*<h1>Download Soundscaper<\/h1>/u);
	assert.equal(html.split('October 30, 2026').length, 2);
	const resources = /<nav class="release-resources"[\s\S]*?<\/nav>/u.exec(html)?.[0] ?? '';
	assert.match(resources, />Release notes<\/a>[\s\S]*>Checksums<\/a>/u);
});

const cases: readonly [string, HeadersInit, readonly string[]][] = [
	['Windows x64 user agent', { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, ['win-x64.exe', 'win-x64.zip']],
	['ARM64 hints overriding a Windows x64 user agent', {
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
		'Sec-CH-UA-Platform': '"Windows"', 'Sec-CH-UA-Arch': '"arm"', 'Sec-CH-UA-Bitness': '"64"',
	}, ['win-arm64.exe']],
	['Linux ARM64 user agent', { 'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64)' }, ['linux-arm64.AppImage']],
	['Apple silicon hints', { 'Sec-CH-UA-Platform': '"macOS"', 'Sec-CH-UA-Arch': '"arm"', 'Sec-CH-UA-Bitness': '"64"' }, ['mac-arm64.dmg']],
	['Mac with unknown processor', { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }, ['mac-arm64.dmg']],
	['Windows with unknown processor', { 'Sec-CH-UA-Platform': '"Windows"' }, ['win-x64.exe', 'win-arm64.exe', 'win-x64.zip']],
	['Intel Mac with no matching build', { 'Sec-CH-UA-Platform': '"macOS"', 'Sec-CH-UA-Arch': '"x86"', 'Sec-CH-UA-Bitness': '"64"' }, []],
	['unsupported 32-bit processor', { 'Sec-CH-UA-Platform': '"Linux"', 'Sec-CH-UA-Arch': '"arm"', 'Sec-CH-UA-Bitness': '"32"' }, []],
	['Android device', { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; arm64) Mobile' }, []],
	['unknown device', {}, []],
];

for (const [name, headers, visible] of cases) {
	test(`${name} keeps every nonmatching package inside closed Other downloads`, async () => {
		const html = await (await page(headers)).text();
		const details = /<details\b[\s\S]*?<\/details>/u.exec(html)?.[0];
		assert.ok(details);
		assert.match(details, /<summary>Other downloads<\/summary>/u);
		assert.doesNotMatch(details, /^<details[^>]*\sopen(?:\s|>|=)/u);
		const main = html.replace(details, '');
		for (const target of TARGETS) {
			const name = `Soundscaper-${VERSION}-${target}`;
			assert.equal(main.includes(name), visible.includes(target), `main downloads: ${target}`);
			assert.equal(details.includes(name), !visible.includes(target), `other downloads: ${target}`);
		}
	});
}

test('download pages request architecture hints and vary on the browser information used', async () => {
	const response = await page();
	for (const name of ['Sec-CH-UA-Arch', 'Sec-CH-UA-Bitness']) {
		assert.ok(response.headers.get('accept-ch')?.includes(name));
		assert.ok(response.headers.get('critical-ch')?.includes(name));
		assert.ok(response.headers.get('vary')?.includes(name));
	}
	assert.ok(response.headers.get('vary')?.includes('User-Agent'));
});
