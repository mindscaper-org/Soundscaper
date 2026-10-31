/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { desktopReleaseTargetPackageInventory } from '../scripts/desktop-release-assets.mjs';
import verifyReleaseArtifacts from '../scripts/desktop-verify-release-artifacts.mjs';
import { handleDesktopDownloadRequest } from '../functions/download/desktop/index.ts';
import { handleDownloadPageRequest } from '../functions/download/index.ts';

const SIGNING_ENVIRONMENT = {
	SCAPE_MAC_SIGNING: 'true', APPLE_TEAM_ID: 'ABCDEFGHIJ',
	APPLE_ID: 'account', APPLE_APP_SPECIFIC_PASSWORD: 'secret',
	CSC_INSTALLER_NAME: 'Developer ID Installer: Example (ABCDEFGHIJ)',
};

test('macOS release inventory requires the optional-codec PKG alongside the DMG', () => {
	const inventory = desktopReleaseTargetPackageInventory('soundscaper', 'mac-arm64', '1.0.0');
	assert.deepEqual(inventory.map(({ label }: { label: string }) => label), [
		'macOS Apple silicon PKG installer', 'macOS Apple silicon DMG',
	]);
	assert.equal(inventory[0]?.pattern.test('Soundscaper-1.0.0-mac-arm64.pkg'), true);
});

test('macOS direct downloads prefer PKG and retain explicit DMG links', async () => {
	const release = {
		tag_name: 'soundscaper-v1.0.0-rc.1', draft: false, published_at: '2026-10-31T00:00:00Z',
		assets: ['dmg', 'pkg'].map(extension => ({
			name: `Soundscaper-1.0.0-rc.1-mac-arm64.${extension}`, state: 'uploaded',
		})),
	};
	const fetchImpl: typeof fetch = async () => Response.json([release]);
	const response = await handleDesktopDownloadRequest(new Request('https://soundscaper.org/download/desktop/', {
		headers: { 'Sec-CH-UA-Platform': '"macOS"', 'Sec-CH-UA-Arch': '"arm"', 'Sec-CH-UA-Bitness': '"64"' },
	}), fetchImpl);
	assert.match(response.headers.get('location') ?? '', /-mac-arm64\.pkg$/u);
	for (const extension of ['pkg', 'dmg']) {
		const direct = await handleDesktopDownloadRequest(new Request(
			`https://soundscaper.org/download/desktop/soundscaper-mac-arm64.${extension}`,
		), fetchImpl);
		assert.match(direct.headers.get('location') ?? '', new RegExp(`-mac-arm64\\.${extension}$`, 'u'));
	}
	const page = await handleDownloadPageRequest(new Request('https://soundscaper.org/download/'), fetchImpl);
	const html = await page.text();
	assert.match(html, /macOS Apple silicon PKG installer/u);
	assert.ok(html.indexOf('-mac-arm64.pkg') < html.indexOf('-mac-arm64.dmg'));
});

test('signed PKG uses Installer certificate verification and is notarized and stapled', async () => {
	const calls: [string, readonly string[]][] = [];
	await verifyReleaseArtifacts({ artifactPaths: ['/tmp/release.pkg', '/tmp/release.dmg'] }, {
		platform: 'darwin', env: SIGNING_ENVIRONMENT,
		executeFile: async (command: string, args: readonly string[]) => {
			calls.push([command, args]);
			return { stdout: command === 'pkgutil'
				? 'Status: signed by a developer certificate issued by Apple for distribution\n    1. Developer ID Installer: Example (ABCDEFGHIJ)\n'
				: JSON.stringify({ status: 'Accepted' }) };
		},
	});
	assert.ok(calls.some(([command, args]) => command === 'pkgutil'
		&& args.join(' ') === '--check-signature /tmp/release.pkg'));
	assert.ok(!calls.some(([command, args]) => command === 'codesign' && args.includes('/tmp/release.pkg')));
	for (const artifact of ['/tmp/release.pkg', '/tmp/release.dmg']) {
		for (const operation of ['submit', 'staple', 'validate']) {
			assert.ok(calls.some(([command, args]) => command === 'xcrun'
				&& args.includes(operation) && args.includes(artifact)));
		}
	}
	assert.ok(calls.some(([command, args]) => command === 'spctl'
		&& args.includes('install') && args.includes('/tmp/release.pkg')));
});

test('signed PKG rejects an unsigned or different Installer identity before notarizing', async () => {
	for (const stdout of ['no signature',
		'Developer ID Installer: Other (OTHERTEAM)',
		'Developer ID Application: Example (ABCDEFGHIJ)',
	]) {
		await assert.rejects(verifyReleaseArtifacts({ artifactPaths: ['/tmp/release.pkg'] }, {
			platform: 'darwin', env: SIGNING_ENVIRONMENT,
			executeFile: async (command: string) => {
				assert.equal(command, 'pkgutil');
				return { stdout };
			},
		}), /Installer signature/iu);
	}
});
