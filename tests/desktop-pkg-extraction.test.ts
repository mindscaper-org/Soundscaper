/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { extractPkgApplication } from '../scripts/lib/desktop-pkg-extraction.mjs';
import { writeDesktopPkgFixture } from './helpers/desktop-pkg-fixture.ts';

const portableInspectorAvailable = process.platform === 'linux'
	&& spawnSync('7z', ['i'], { stdio: 'ignore', timeout: 5000 }).status === 0;
const portableInspectorSkip = portableInspectorAvailable ? false
	: 'The portable package-audit fixture requires Linux and the CI 7-Zip inspector.';

test('PKG content auditing expands without executing installer scripts and authenticates /Applications layout', async context => {
	const root = await mkdtemp(join(tmpdir(), 'desktop-pkg-extraction-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const extractedRoot = join(root, 'content');
	const artifact = join(root, 'Soundscaper-1.0.0-mac-arm64.pkg');
	const calls: [string, readonly string[]][] = [];
	const result = await extractPkgApplication({ artifact, extractedRoot,
		productId: 'soundscaper', targetId: 'mac-arm64' }, {
		platform: 'darwin',
		execute: async (command: string, args: readonly string[]) => {
			calls.push([command, args]);
			await packageFixture(extractedRoot);
			return { stdout: '', stderr: '' };
		},
	});
	assert.equal(result, join(extractedRoot, 'org.soundscaper.desktop.pkg', 'Payload'));
	assert.deepEqual(calls, [['pkgutil', ['--expand-full', artifact, extractedRoot]]]);
});

test('PKG content auditing rejects relocated, symlinked, foreign or extra payloads', async context => {
	const root = await mkdtemp(join(tmpdir(), 'desktop-pkg-invalid-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const mutations = ['location', 'identity', 'extra-file', 'extra-component', 'symlink', 'optional-payload'] as const;
	for (const mutation of mutations) {
		const extractedRoot = join(root, mutation);
		await assert.rejects(extractPkgApplication({
			artifact: join(root, 'Soundscaper-1.0.0-mac-arm64.pkg'), extractedRoot,
			productId: 'soundscaper', targetId: 'mac-arm64',
		}, {
			platform: 'darwin',
			execute: async () => {
				await packageFixture(extractedRoot, mutation === 'location' ? '/tmp' : '/Applications',
					mutation === 'identity' ? 'org.foreign.desktop' : 'org.soundscaper.desktop');
				const payload = join(extractedRoot, 'org.soundscaper.desktop.pkg', 'Payload');
				if (mutation === 'extra-file') await writeFile(join(payload, 'unexpected'), 'extra');
				if (mutation === 'extra-component') await mkdir(join(extractedRoot, 'foreign.pkg'));
				if (mutation === 'optional-payload') {
					const optionalPayload = join(extractedRoot, 'org.soundscaper.desktop.ffmpeg.pkg', 'Payload');
					await mkdir(optionalPayload);
					await writeFile(join(optionalPayload, 'unexpected'), 'extra');
				}
				if (mutation === 'symlink') {
					await rm(join(payload, 'Soundscaper.app'), { recursive: true });
					await symlink(root, join(payload, 'Soundscaper.app'));
				}
				return { stdout: '', stderr: '' };
			},
		}), /PKG/u, mutation);
	}
});

test('portable PKG auditing extracts a real XAR, gzip and CPIO without running installer scripts', {
	skip: portableInspectorSkip,
}, async context => {
	const root = await mkdtemp(join(tmpdir(), 'desktop-pkg-portable-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const artifact = join(root, 'Soundscaper-1.0.0-mac-arm64.pkg');
	await writeDesktopPkgFixture(artifact);
	const payload = await extractPkgApplication({ artifact, extractedRoot: join(root, 'content'),
		productId: 'soundscaper', targetId: 'mac-arm64', sevenZip: '7z' }, { platform: 'linux' });
	const executable = join(payload, 'Soundscaper.app/Contents/MacOS/Soundscaper');
	assert.equal(await readFile(executable, 'utf8'), 'application fixture');
	assert.equal((await lstat(executable)).mode & 0o777, 0o755);
	assert.equal(await readlink(join(payload, 'Soundscaper.app/current')), 'Contents');
});

test('portable PKG auditing refuses extra payloads, components, relocation and escaping paths or links', {
	skip: portableInspectorSkip,
}, async context => {
	const root = await mkdtemp(join(tmpdir(), 'desktop-pkg-portable-invalid-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const scenarios = [{ optionalPayload: true }, { extraComponent: true }, { installLocation: '/tmp' },
		{ symlinkTarget: '/tmp' }, { symlinkTarget: '../../outside' }, { payloadEscape: true }];
	for (const [index, options] of scenarios.entries()) {
		const artifact = join(root, `${index}`, 'Soundscaper-1.0.0-mac-arm64.pkg');
		await mkdir(join(root, `${index}`));
		await writeDesktopPkgFixture(artifact, options);
		await assert.rejects(extractPkgApplication({ artifact, extractedRoot: join(root, `${index}`, 'content'),
			productId: 'soundscaper', targetId: 'mac-arm64', sevenZip: '7z' }, { platform: 'linux' }), /PKG/u);
	}
});

async function packageFixture(root: string, location = '/Applications', identity = 'org.soundscaper.desktop'): Promise<void> {
	const component = join(root, 'org.soundscaper.desktop.pkg');
	await mkdir(join(component, 'Payload', 'Soundscaper.app'), { recursive: true });
	await writeFile(join(component, 'PackageInfo'), `<pkg-info identifier="${identity}" install-location="${location}"/>`);
	await mkdir(join(root, 'org.soundscaper.desktop.ffmpeg.pkg'));
}
