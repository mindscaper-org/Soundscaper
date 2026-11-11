/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import test from 'node:test';

import {
	assertSoundscaperReleaseMetadataSynchronized,
	createSoundscaperReleasePreparation,
	parseSoundscaperReleasePrepareArguments,
	prepareSoundscaperRelease,
} from '../scripts/prepare-soundscaper-release.mjs';

function documents() {
	return {
		releaseLines: { schemaVersion: 3, products: {
			soundscaper: { productId: 'soundscaper', applicationVersionChannel: 'candidate', releaseChannel: 'candidate',
				candidate: { version: 'Soundscaper-rc.2026.Oct.28.a', tagPrefix: 'Soundscaper' }, stable: { version: 'Soundscaper.2026.Oct.28.a', tagPrefix: 'Soundscaper' } },
			framescaper: { productId: 'framescaper', applicationVersionChannel: 'candidate', releaseChannel: 'deferred',
				candidate: { version: 'Framescaper-rc.2026.Oct.28.a', tagPrefix: 'Framescaper' }, stable: { version: 'Framescaper.2026.Oct.28.a', tagPrefix: 'Framescaper' } },
		} },
		packageMetadata: { name: 'soundscaper', version: '2026.1028.2', releaseVersion: 'Soundscaper-rc.2026.Oct.28.a', private: true },
		packageLock: { name: 'soundscaper', version: '2026.1028.2', lockfileVersion: 3, packages: { '': { name: 'soundscaper', version: '2026.1028.2' } } },
		desktopProduct: { schemaVersion: 2, id: 'soundscaper', applicationVersion: 'Soundscaper-rc.2026.Oct.28.a', packageVersion: '2026.1028.2',
			applicationVersionChannel: 'candidate', releaseChannel: 'candidate', updateTagPrefix: 'Soundscaper' },
	};
}

test('release preparation selects the stable line and synchronizes version metadata', () => {
	const prepared = createSoundscaperReleasePreparation(documents(), 'Soundscaper.2026.Oct.28.a');
	assert.equal(prepared.releaseLines.products.soundscaper.applicationVersionChannel, 'stable');
	assert.equal(prepared.releaseLines.products.soundscaper.releaseChannel, 'stable');
	assert.equal(prepared.releaseLines.products.soundscaper.stable.version, 'Soundscaper.2026.Oct.28.a');
	assert.equal(prepared.packageMetadata.version, '2026.1028.3');
	assert.equal(prepared.packageLock.version, '2026.1028.3');
	assert.equal(prepared.packageLock.packages[''].version, '2026.1028.3');
	assert.deepEqual(prepared.desktopProduct, {
		schemaVersion: 2, id: 'soundscaper', applicationVersion: 'Soundscaper.2026.Oct.28.a', packageVersion: '2026.1028.3',
		applicationVersionChannel: 'stable', releaseChannel: 'stable', updateTagPrefix: 'Soundscaper',
	});
});

test('stable release verification binds the tag to every synchronized metadata surface without mutation', () => {
	const prepared = createSoundscaperReleasePreparation(documents(), 'Soundscaper.2026.Oct.28.a');
	const before = structuredClone(prepared);
	assert.deepEqual(assertSoundscaperReleaseMetadataSynchronized(prepared, 'Soundscaper.2026.Oct.28.a'), {
		productId: 'soundscaper', channel: 'stable', version: 'Soundscaper.2026.Oct.28.a',
	});
	assert.deepEqual(prepared, before);

	for (const [label, mutate] of [
		['release line', (value) => { value.releaseLines.products.soundscaper.releaseChannel = 'candidate'; }],
		['package metadata', (value) => { value.packageMetadata.version = '1.0.1'; }],
		['package-lock root', (value) => { value.packageLock.version = '1.0.1'; }],
		['package-lock package', (value) => { value.packageLock.packages[''].version = '1.0.1'; }],
		['desktop metadata', (value) => { value.desktopProduct.applicationVersion = '1.0.1'; }],
	]) {
		const drifted = structuredClone(prepared);
		mutate(drifted);
		assert.throws(
			() => assertSoundscaperReleaseMetadataSynchronized(drifted, 'Soundscaper.2026.Oct.28.a'),
			/release|synchron|metadata/iu,
			label,
		);
	}
	assert.throws(
		() => assertSoundscaperReleaseMetadataSynchronized(prepared, 'v1.0.1'),
		/release tag/iu,
	);
});

test('release preparation selects candidates and preserves the other release lines and package fields', () => {
	for (const [version, numeric] of [['Soundscaper-rc.2027.Apr.2.b', '2027.402.6'], ['Soundscaper-beta.2027.Apr.2.a', '2027.402.1']]) {
		const current = createSoundscaperReleasePreparation(documents(), 'Soundscaper.2026.Oct.28.a');
		current.packageMetadata.dependencies = { example: '3.0.0' };
		current.packageLock.packages['node_modules/example'] = { version: '3.0.0' };
		const before = structuredClone(current);
		const prepared = createSoundscaperReleasePreparation(current, version);
		assert.equal(prepared.releaseLines.products.soundscaper.candidate.version, version);
		assert.equal(prepared.releaseLines.products.soundscaper.applicationVersionChannel, 'candidate');
		assert.equal(prepared.releaseLines.products.soundscaper.releaseChannel, 'candidate');
		assert.deepEqual(prepared.releaseLines.products.soundscaper.stable,
			current.releaseLines.products.soundscaper.stable);
		assert.deepEqual(prepared.releaseLines.products.framescaper, current.releaseLines.products.framescaper);
		assert.equal(prepared.packageMetadata.version, numeric);
		assert.equal(prepared.packageLock.version, numeric);
		assert.equal(prepared.packageLock.packages[''].version, numeric);
		assert.equal(prepared.desktopProduct.applicationVersion, version);
		assert.equal(prepared.desktopProduct.updateTagPrefix, 'Soundscaper');
		assert.equal(prepared.desktopProduct.releaseChannel, 'candidate');
		assert.deepEqual(prepared.packageMetadata.dependencies, current.packageMetadata.dependencies);
		assert.deepEqual(prepared.packageLock.packages['node_modules/example'],
			current.packageLock.packages['node_modules/example']);
		assert.deepEqual(current, before);
	}
});

test('preparation repairs generated metadata from an edited release register without a version argument', () => {
	const current = documents();
	current.releaseLines.products.soundscaper.candidate.version = 'Soundscaper-rc.2027.Apr.2.b';
	current.packageMetadata.version = '0.0.1';
	current.packageLock.version = '0.0.2';
	current.packageLock.packages[''].version = '0.0.3';
	current.desktopProduct.applicationVersion = '0.0.4';
	const before = structuredClone(current);
	const prepared = createSoundscaperReleasePreparation(current);
	assert.deepEqual(prepared.releaseLines, before.releaseLines);
	assert.equal(prepared.packageMetadata.version, '2027.402.6');
	assert.equal(prepared.packageLock.version, '2027.402.6');
	assert.equal(prepared.packageLock.packages[''].version, '2027.402.6');
	assert.equal(prepared.desktopProduct.applicationVersion, 'Soundscaper-rc.2027.Apr.2.b');
	assert.deepEqual(current, before);
});

test('release preparation refuses invalid versions and malformed package identities', () => {
	for (const version of ['1.0.0', '1.0.0-rc.01', '1.0.0-preview.1', 'latest', '']) {
		assert.throws(() => createSoundscaperReleasePreparation(documents(), version), /version/iu);
	}
	for (const mutate of [
		(value) => { value.packageMetadata.name = 'foreign'; },
		(value) => { value.packageLock.name = 'foreign'; },
		(value) => { value.packageLock.packages = {}; },
		(value) => { value.packageLock.packages[''].name = 'foreign'; },
		(value) => { value.releaseLines.products.soundscaper.candidate.version = 'invalid'; },
	]) {
		const current = documents();
		mutate(current);
		assert.throws(() => createSoundscaperReleasePreparation(current), /Soundscaper|version/iu);
	}
});

test('release preparation CLI accepts a version, synchronization, or a read-only check', () => {
	assert.deepEqual(parseSoundscaperReleasePrepareArguments(['1.2.3']), { version: '1.2.3' });
	assert.deepEqual(parseSoundscaperReleasePrepareArguments(['1.2.3-rc.2']), { version: '1.2.3-rc.2' });
	assert.deepEqual(parseSoundscaperReleasePrepareArguments([]), {});
	assert.deepEqual(parseSoundscaperReleasePrepareArguments(['--check']), { checkOnly: true });
	for (const args of [['Soundscaper.2026.Oct.28.a', 'extra'], ['--version=1.0.0'], ['--check', 'Soundscaper.2026.Oct.28.a']]) {
		assert.throws(() => parseSoundscaperReleasePrepareArguments(args), /version|check/iu);
	}
});

const DOCUMENT_PATHS = {
	releaseLines: 'config/product-release-lines.json', packageMetadata: 'package.json',
	packageLock: 'package-lock.json', desktopProduct: 'desktop/product.json',
};

async function fixture(context, current) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-release-prepare-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	for (const [name, path] of Object.entries(DOCUMENT_PATHS)) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), `${JSON.stringify(current[name], null, '\t')}\n`);
	}
	for (const name of ['production-capabilities', 'production-security-matrix', 'ffmpeg-runtime-manifest']) {
		await writeFile(join(root, 'config', `${name}.json`), '{"sentinel":"unchanged"}\n');
	}
	return root;
}

async function contents(root) {
	const files = await readdir(root, { recursive: true, withFileTypes: true });
	return Object.fromEntries(await Promise.all(files.filter(entry => entry.isFile()).map(async entry => {
		const path = join(entry.parentPath, entry.name);
		return [relative(root, path).split(sep).join('/'), await readFile(path, 'utf8')];
	})));
}

test('candidate preparation changes only the authority and derived packaging documents and is idempotent', async context => {
	const root = await fixture(context, documents());
	const before = await contents(root);
	const output = [];
	const options = { repositoryRoot: root, version: 'Soundscaper-rc.2027.Apr.2.b', writeOutput: value => output.push(value) };
	const prepared = await prepareSoundscaperRelease(options);
	const after = await contents(root);
	assert.deepEqual(Object.keys(after).filter(path => before[path] !== after[path]).sort(),
		Object.values(DOCUMENT_PATHS).sort());
	for (const [name, path] of Object.entries(DOCUMENT_PATHS)) {
		assert.deepEqual(JSON.parse(after[path]), prepared[name]);
	}
	assert.match(output.join(''), /Soundscaper-rc\.2027\.Apr\.2\.b/u);
	await prepareSoundscaperRelease({ repositoryRoot: root, writeOutput: () => {} });
	assert.deepEqual(await contents(root), after);
});

test('a read-only release check rejects drift without repairing or rewriting any files', async context => {
	const root = await fixture(context, documents());
	const options = { repositoryRoot: root, checkOnly: true, writeOutput: () => {} };
	const before = await contents(root);
	const metadataStat = await stat(join(root, 'package.json'), { bigint: true });
	await prepareSoundscaperRelease(options);
	assert.deepEqual(await contents(root), before);
	const checkedStat = await stat(join(root, 'package.json'), { bigint: true });
	assert.equal(checkedStat.ino, metadataStat.ino);
	assert.equal(checkedStat.mtimeNs, metadataStat.mtimeNs);
	const drifted = documents().releaseLines;
	drifted.products.soundscaper.candidate.version = 'Soundscaper-rc.2027.Apr.2.c';
	await writeFile(join(root, DOCUMENT_PATHS.releaseLines), `${JSON.stringify(drifted, null, '\t')}\n`);
	const stale = await contents(root);
	await assert.rejects(prepareSoundscaperRelease(options), /synchronized/iu);
	assert.deepEqual(await contents(root), stale);
	await prepareSoundscaperRelease({ repositoryRoot: root, writeOutput: () => {} });
	await prepareSoundscaperRelease(options);
	assert.equal(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version, '2027.402.10');
});

test('invalid release versions fail before changing any checked-in file', async context => {
	const root = await fixture(context, documents());
	const before = await contents(root);
	await assert.rejects(prepareSoundscaperRelease({ repositoryRoot: root, version: 'bad' }), /version/iu);
	assert.deepEqual(await contents(root), before);
});
