/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assetLabel, currentDownloadReleases, matchingDownload, parseAudacityRelease,
	type DownloadAsset } from '../src/common/site/audacity-download/releases.ts';

const releaseUrl = 'https://github.com/audacity/audacity/releases/download/Audacity-4.9.1/';
const literal = (entries: string): string => `export const audacityReleases = { version: '4.9.1', ${entries} };`;
const entry = (name: string, filename: string): string => `{ name: '${name}', browser_download_url: '${releaseUrl}${filename}' }`;
const asset = (name: string, properties: Partial<DownloadAsset> = {}): DownloadAsset => ({
	name, url: `${releaseUrl}${name}`, platform: 'win', architecture: 'x64', format: 'msi', ...properties,
});

test('Audacity release parsing admits desktop packages across platform and architecture spellings', () => {
	const release = parseAudacityRelease(literal(`
		win: [${entry('Windows', 'audacity-win-4.9.1-x86_64.msi')}],
		mac: [${entry('Mac', 'audacity-macOS-4.9.1-universal.dmg')}],
		lin: [${entry('Linux', 'audacity-linux-4.9.1-aarch64.AppImage')}]
	`));
	assert.equal(release.version, '4.9.1');
	assert.deepEqual(release.assets.map(({ platform, architecture, format }) => ({ platform, architecture, format })), [
		{ platform: 'win', architecture: 'x64', format: 'msi' },
		{ platform: 'mac', architecture: 'universal', format: 'dmg' },
		{ platform: 'linux', architecture: 'arm64', format: 'AppImage' },
	]);
});

test('Audacity release parsing rejects incomplete, malformed and non-package entries', () => {
	assert.throws(() => parseAudacityRelease('export const unrelated = {};'), /release data is unavailable/u);
	assert.throws(() => parseAudacityRelease('export const audacityReleases = { version: \'3.7.9\' };'), /release data is unavailable/u);
	assert.throws(() => parseAudacityRelease(literal(`win: [
		{ name: 'missing URL' }, { browser_download_url: '${releaseUrl}audacity-x64.msi' },
		{ name: 'malformed URL', browser_download_url: '::invalid' },
		${entry('Source', 'audacity-source-x64.zip')},
		${entry('Unsupported format', 'audacity-x64.txt')},
		${entry('Unknown architecture', 'audacity.msi')}
	]`)), /no desktop downloads/u);
	for (const address of [
		`http://github.com/audacity/audacity/releases/download/Audacity-4.9.1/audacity-x64.msi`,
		`https://user@github.com/audacity/audacity/releases/download/Audacity-4.9.1/audacity-x64.msi`,
		`https://:password@github.com/audacity/audacity/releases/download/Audacity-4.9.1/audacity-x64.msi`,
		`${releaseUrl}audacity-x64.msi?download=1`, `${releaseUrl}audacity-x64.msi#download`,
	]) assert.throws(() => parseAudacityRelease(literal(`win: [{ name: 'Unsafe', browser_download_url: '${address}' }]`)), /no desktop downloads/u);
});

test('package matching prioritizes native installers, universal fallbacks and Ubuntu variants', () => {
	const headers = new Headers({ 'Sec-CH-UA-Platform': '"Windows"', 'Sec-CH-UA-Arch': '"x86"', 'Sec-CH-UA-Bitness': '"64"' });
	const installer = asset('installer');
	assert.equal(matchingDownload([asset('unknown', { format: 'other' }), asset('portable', { format: 'zip' }), installer], headers), installer);
	const x86 = asset('32-bit', { architecture: 'x86' });
	assert.equal(matchingDownload([installer, x86], new Headers({ 'Sec-CH-UA-Platform': '"Windows"', 'Sec-CH-UA-Arch': '"x86"', 'Sec-CH-UA-Bitness': '"32"' })), x86);
	const native = asset('native', { platform: 'mac', architecture: 'arm64', format: 'dmg' });
	const universal = asset('universal', { platform: 'mac', architecture: 'universal', format: 'dmg' });
	assert.equal(matchingDownload([universal, native], new Headers({ 'Sec-CH-UA-Platform': '"macOS"', 'Sec-CH-UA-Arch': '"arm"', 'Sec-CH-UA-Bitness': '"64"' })), native);
	assert.equal(matchingDownload([universal], new Headers({ 'Sec-CH-UA-Platform': '"macOS"' })), universal);
	const generic = asset('generic', { platform: 'linux', format: 'deb' });
	assert.equal(matchingDownload([asset('Ubuntu 24', { platform: 'linux', format: 'deb', variant: '24' }), asset('Ubuntu 22', { platform: 'linux', format: 'deb', variant: '22' }), generic],
		new Headers({ 'Sec-CH-UA-Platform': '"Linux"', 'Sec-CH-UA-Arch': '"x86"', 'Sec-CH-UA-Bitness': '"64"' })), generic);
	assert.equal(matchingDownload([installer], new Headers()), undefined);
});

test('asset labels localize 32-bit and universal packages and retain unknown platform labels', () => {
	const copy = { universal: 'Universal package', bits32: '32-bit processor' };
	assert.equal(assetLabel(asset('old', { architecture: 'x86' }), copy), 'Windows · 32-bit processor · msi');
	assert.equal(assetLabel(asset('Mac', { platform: 'mac', architecture: 'universal', format: 'dmg' }), copy), 'macOS · Universal package · dmg');
	assert.equal(assetLabel(asset('future', { platform: 'future OS', architecture: 'future CPU', format: 'deb', variant: '24' }), copy), 'future OS · future CPU · deb (Ubuntu 24+)');
});

test('independent release lookups keep committed fallbacks when Soundscaper is empty or upstream rejects', async context => {
	const warnings: string[] = [];
	context.mock.method(console, 'warn', (message: string) => warnings.push(message));
	const releases = await currentDownloadReleases(async url => {
		if (String(url).includes('raw.githubusercontent.com')) return Promise.reject('upstream unavailable');
		return Response.json([]);
	});
	assert.ok(releases.soundscaper.assets.length > 0);
	assert.ok(releases.audacity4.assets.length > 0);
	assert.ok(releases.audacity3.assets.length > 0);
	assert.deepEqual(warnings.map(message => JSON.parse(message) as unknown), [
		{ event: 'audacity_download_fallback', product: 'soundscaper', reason: 'No Soundscaper release candidate.' },
		{ event: 'audacity_download_fallback', product: 'audacity4', reason: 'upstream unavailable' },
	]);
});
