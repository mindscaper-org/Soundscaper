/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DesktopUpdateInstallation, replaceUpdateAppImage, selectUpdateInstaller } from '../desktop/update-installation.ts';

const body = Buffer.from('verified installer fixture');
const sha256 = createHash('sha256').update(body).digest('hex');
const version = '1.0.0-rc.Nov.11.a';
function release(product = 'Soundscaper', platform = 'win', extension = 'exe', arch = 'x64') {
	const name = `${product}-${version}-${platform}-${arch}.${extension}`;
	return { tag_name: `${product.toLowerCase()}-v${version}`, assets: [{
		name, size: body.length, digest: `sha256:${sha256}`,
		browser_download_url: `https://github.com/LeoWattenberg/Soundscaper/releases/download/${product.toLowerCase()}-v${version}/${name}`,
	}] };
}
function installer() {
	return selectUpdateInstaller(release(), { productName: 'Soundscaper', tagPrefix: 'soundscaper-v', version, platform: 'win32', arch: 'x64' });
}

test('update installers match the exact product, release, platform and architecture', () => {
	for (const productName of ['Soundscaper', 'Framescaper']) {
		for (const [platform, os, extension, appImage] of [
			['win32', 'win', 'exe', false], ['darwin', 'mac', 'pkg', false],
			['linux', 'linux', 'deb', false], ['linux', 'linux', 'AppImage', true],
		] as const) for (const arch of ['x64', 'arm64']) {
			const result = selectUpdateInstaller(release(productName, os, extension, arch), {
				productName, tagPrefix: `${productName.toLowerCase()}-v`, version, platform, arch, appImage,
			});
			assert.equal(result.name, `${productName}-${version}-${os}-${arch}.${extension}`);
			assert.equal(result.sha256, sha256);
		}
	}
	assert.throws(() => selectUpdateInstaller(release('Framescaper'), {
		productName: 'Soundscaper', tagPrefix: 'soundscaper-v', version, platform: 'win32', arch: 'x64',
	}), /installer/iu);
	for (const patch of [{ digest: null }, { size: 0 }, { browser_download_url: 'https://example.com/installer.exe' }]) {
		const value = release(); Object.assign(value.assets[0]!, patch);
		assert.throws(() => selectUpdateInstaller(value, {
			productName: 'Soundscaper', tagPrefix: 'soundscaper-v', version, platform: 'win32', arch: 'x64',
		}), /installer/iu);
	}
});

async function fixture(t: test.TestContext, fetchImpl: typeof fetch = async () => new Response(body)) {
	const root = await mkdtemp(join(tmpdir(), 'scape-update-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const opened: string[] = [];
	const create = (currentVersion = '1.0.0-rc.Nov.9.a') => new DesktopUpdateInstallation({
		root, currentVersion, isNewer: (candidate, current) => candidate === version && current !== version,
		fetchImpl, openInstaller: async path => { opened.push(path); },
	});
	return { root, opened, create };
}

test('install now verifies and opens the installer without leaving a deferred installation', async t => {
	const f = await fixture(t);
	await f.create().install(installer(), 'now');
	assert.equal(f.opened.length, 1);
	assert.deepEqual(await readFile(f.opened[0]!), body);
	assert.equal(await f.create().installPending(), false);
});

test('install on next launch stages once, survives restart, and opens without another download', async t => {
	let downloads = 0;
	const f = await fixture(t, async () => { downloads++; return new Response(body); });
	await f.create().install(installer(), 'next-launch');
	assert.deepEqual(f.opened, []);
	assert.equal(await f.create().installPending(), true);
	assert.equal(downloads, 1);
	assert.equal(f.opened.length, 1);
	assert.equal(await f.create().installPending(), false);
});

test('corrupt downloads and staged installers never launch', async t => {
	const bad = await fixture(t, async () => new Response('corrupt'));
	await assert.rejects(bad.create().install(installer(), 'now'), /installer/iu);
	assert.deepEqual(bad.opened, []);
	assert.equal(await bad.create().installPending(), false);
	const f = await fixture(t);
	await f.create().install(installer(), 'next-launch');
	await writeFile(join(f.root, installer().name), 'corrupt');
	await assert.rejects(f.create().installPending(), /installer/iu);
	assert.deepEqual(f.opened, []);
});

test('already installed releases clear deferred installation instead of running an old installer', async t => {
	const f = await fixture(t);
	await f.create().install(installer(), 'next-launch');
	assert.equal(await f.create(version).installPending(), false);
	assert.deepEqual(f.opened, []);
});

test('stable Soundscaper releases use the stable v tag namespace', () => {
	const stable = release();
	stable.tag_name = `v${version}`;
	stable.assets[0]!.browser_download_url = stable.assets[0]!.browser_download_url.replace(`/soundscaper-v${version}/`, `/v${version}/`);
	assert.equal(selectUpdateInstaller(stable, { productName: 'Soundscaper', tagPrefix: 'v', version, platform: 'win32', arch: 'x64' }).sha256, sha256);
});

test('AppImage updates replace the old executable and retain its executable mode', async t => {
	const f = await fixture(t);
	const source = join(f.root, 'new.AppImage'), destination = join(f.root, 'current.AppImage');
	await writeFile(source, body); await writeFile(destination, 'old');
	await chmod(destination, 0o755);
	await replaceUpdateAppImage(source, destination);
	assert.deepEqual(await readFile(destination), body);
	if (process.platform !== 'win32') assert.equal((await lstat(destination)).mode & 0o777, 0o755);
});
