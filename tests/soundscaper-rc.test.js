/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { createSoundscaperRc, nextSoundscaperRcVersion } from '../scripts/create-soundscaper-rc.mjs';

const execute = promisify(execFile);
const TODAY = new Date(2026, 9, 29, 12);
const METADATA_PATHS = ['config/product-release-lines.json', 'package.json', 'package-lock.json', 'desktop/product.json'];

test('RC versions use the local year, English month, day, and next build letter', () => {
	for (const [current, date, expected] of [
		['Soundscaper-rc.2026.Oct.28.f', TODAY, 'Soundscaper-rc.2026.Oct.29.a'],
		['Soundscaper-rc.2026.Oct.29.a', TODAY, 'Soundscaper-rc.2026.Oct.29.b'],
		['Soundscaper-beta.2025.Dec.31.z', new Date(2026, 0, 2), 'Soundscaper-rc.2026.Jan.2.a'],
		['Soundscaper.2026.Dec.31.a', new Date(2027, 0, 1), 'Soundscaper-rc.2027.Jan.1.a'],
		['Soundscaper-rc.2026.Oct.29.z', TODAY, 'Soundscaper-rc.2026.Oct.29.aa'],
		['Soundscaper-rc.2026.Oct.29.az', TODAY, 'Soundscaper-rc.2026.Oct.29.ba'],
	]) assert.equal(nextSoundscaperRcVersion(current, date), expected);
	assert.throws(() => nextSoundscaperRcVersion('invalid', TODAY), /version/iu);
	assert.throws(() => nextSoundscaperRcVersion('Soundscaper.2026.Oct.29.a', new Date(NaN)), /date/iu);
});

test('RC numbering advances past all local channels for this product and calendar date', () => {
	const tags = ['Soundscaper-rc.2026.Oct.29.b', 'Soundscaper-beta.2026.Oct.29.d',
		'Framescaper-rc.2026.Oct.29.z', 'Soundscaper-rc.2025.Oct.29.z',
		'Soundscaper-rc.2026.Oct.28.z', 'Soundscaper-rc.2026.Oct.29.invalid.1'];
	assert.equal(nextSoundscaperRcVersion('Soundscaper-rc.2026.Oct.29.a', TODAY, tags), 'Soundscaper-rc.2026.Oct.29.e');
	assert.equal(nextSoundscaperRcVersion('Soundscaper.2026.Oct.29.f', TODAY, tags), 'Soundscaper-rc.2026.Oct.29.g');
});

test('creating an RC commits all nonignored changes, synchronizes metadata, and annotates the exact commit', async context => {
	const fixture = await repositoryFixture(context);
	const before = JSON.parse(await readFile(join(fixture.root, METADATA_PATHS[0]), 'utf8'));
	await writeFile(join(fixture.root, 'tracked.txt'), 'staged change\n');
	await fixture.git(['add', '--', 'tracked.txt']);
	await writeFile(join(fixture.root, 'tracked.txt'), 'latest unstaged change\n');
	await writeFile(join(fixture.root, 'new file $(literal).txt'), 'new source\n');
	await rm(join(fixture.root, 'removed.txt'));
	await mkdir(join(fixture.root, 'dist'));
	await writeFile(join(fixture.root, 'dist', 'build.js'), 'ignored build\n');
	await mkdir(join(fixture.root, 'private'));
	await writeFile(join(fixture.root, 'private', 'notes.txt'), 'ignored notes\n');
	const output = [];
	const result = await createSoundscaperRc({ repositoryRoot: fixture.root, now: TODAY,
		writeOutput: value => output.push(value) });
	assert.equal(result.version, 'Soundscaper-rc.2026.Oct.29.b');
	assert.equal(result.tag, 'Soundscaper-rc.2026.Oct.29.b');
	assert.equal(await fixture.git(['rev-parse', 'HEAD']), result.commit);
	assert.equal(await fixture.git(['rev-parse', `${result.tag}^{commit}`]), result.commit);
	assert.equal(await fixture.git(['cat-file', '-t', result.tag]), 'tag');
	assert.equal(await fixture.git(['show', 'HEAD:tracked.txt']), 'latest unstaged change');
	assert.equal(await fixture.git(['show', 'HEAD:new file $(literal).txt']), 'new source');
	assert.equal(await fixture.git(['ls-tree', '--name-only', 'HEAD', '--', 'removed.txt', 'dist', 'private']), '');
	assert.equal(await fixture.git(['status', '--porcelain']), '');
	assert.equal(await fixture.git(['rev-list', '--count', 'HEAD']), '2');
	for (const path of METADATA_PATHS) {
		const metadata = JSON.parse(await fixture.git(['show', `HEAD:${path}`]));
		if (path.startsWith('config/')) {
			assert.equal(metadata.products.soundscaper.candidate.version, result.version);
			assert.equal(metadata.products.soundscaper.applicationVersionChannel, 'candidate');
			assert.equal(metadata.products.soundscaper.releaseChannel, 'candidate');
			assert.deepEqual(metadata.products.framescaper, before.products.framescaper);
			assert.deepEqual(metadata.products.soundscaper.stable, before.products.soundscaper.stable);
		} else if (path.startsWith('desktop/')) assert.equal(metadata.applicationVersion, result.version);
		else {
			assert.equal(metadata.version, '2026.1029.6');
			if (path === 'package-lock.json') assert.equal(metadata.packages[''].version, '2026.1029.6');
			else assert.equal(metadata.releaseVersion, result.version);
		}
	}
	assert.match(output.join(''), /git push --atomic origin HEAD refs\/tags\/Soundscaper-rc\.2026\.Oct\.29\.b/u);
	assert.equal(await readFile(join(fixture.root, 'private', 'notes.txt'), 'utf8'), 'ignored notes\n');
	// A second invocation needs no code changes and advances the metadata again.
	const second = await createSoundscaperRc({ repositoryRoot: fixture.root, now: TODAY, writeOutput: () => {} });
	assert.equal(second.version, 'Soundscaper-rc.2026.Oct.29.c');
	assert.equal(await fixture.git(['rev-list', '--count', 'HEAD']), '3');
});

test('creating an RC skips existing local tags without replacing them', async context => {
	const fixture = await repositoryFixture(context);
	await fixture.git(['tag', 'Soundscaper-rc.2026.Oct.29.c']);
	const oldCommit = await fixture.git(['rev-parse', 'HEAD']);
	const result = await createSoundscaperRc({ repositoryRoot: fixture.root, now: TODAY, writeOutput: () => {} });
	assert.equal(result.version, 'Soundscaper-rc.2026.Oct.29.d');
	assert.equal(await fixture.git(['rev-parse', 'Soundscaper-rc.2026.Oct.29.c']), oldCommit);
});

test('detached HEAD and unfinished Git operations fail before changing files or the index', async context => {
	for (const state of ['detached', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'rebase-merge']) {
		const fixture = await repositoryFixture(context);
		if (state === 'detached') await fixture.git(['checkout', '--detach', '--quiet']);
		else if (state === 'rebase-merge') await mkdir(join(fixture.root, '.git', state));
		else await writeFile(join(fixture.root, '.git', state), `${await fixture.git(['rev-parse', 'HEAD'])}\n`);
		await assertUnchangedAfterFailure(fixture, /branch|unfinished|progress/iu);
	}
});

test('missing commit identity fails before changing files or the index', async context => {
	const fixture = await repositoryFixture(context);
	await fixture.git(['config', 'user.name', '']);
	await fixture.git(['config', 'user.email', '']);
	await assertUnchangedAfterFailure(fixture, /identity|ident|empty/iu);
});

test('a rejected commit preserves the changes and creates no release tag', async context => {
	const fixture = await repositoryFixture(context);
	const oldCommit = await fixture.git(['rev-parse', 'HEAD']);
	await mkdir(join(fixture.root, 'hooks'));
	await writeFile(join(fixture.root, 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
	await fixture.git(['config', 'core.hooksPath', 'hooks']);
	await writeFile(join(fixture.root, 'tracked.txt'), 'keep my changes\n');
	await assert.rejects(createSoundscaperRc({ repositoryRoot: fixture.root, now: TODAY, writeOutput: () => {} }),
		/commit.*failed|failed.*commit/iu);
	assert.equal(await fixture.git(['rev-parse', 'HEAD']), oldCommit);
	assert.equal(await fixture.git(['tag', '--list']), '');
	assert.equal(await readFile(join(fixture.root, 'tracked.txt'), 'utf8'), 'keep my changes\n');
	assert.equal(JSON.parse(await readFile(join(fixture.root, 'package.json'), 'utf8')).releaseVersion, 'Soundscaper-rc.2026.Oct.29.b');
});

test('a tag failure retains the release commit and reports how to tag it', async context => {
	const fixture = await repositoryFixture(context);
	await fixture.git(['config', 'tag.gpgSign', 'true']);
	await fixture.git(['config', 'gpg.program', join(fixture.root, 'missing-signing-program')]);
	await assert.rejects(createSoundscaperRc({ repositoryRoot: fixture.root, now: TODAY, writeOutput: () => {} }),
		/tagging failed[\s\S]+git tag --annotate Soundscaper-rc\.2026\.Oct\.29\.b/iu);
	assert.equal(await fixture.git(['rev-list', '--count', 'HEAD']), '2');
	assert.equal(await fixture.git(['tag', '--list']), '');
	assert.equal(JSON.parse(await fixture.git(['show', 'HEAD:package.json'])).releaseVersion, 'Soundscaper-rc.2026.Oct.29.b');
	assert.equal(await fixture.git(['status', '--porcelain']), '');
});

test('the CLI offers read-only help, rejects arguments, and creates an RC without a remote', async context => {
	const fixture = await repositoryFixture(context);
	await mkdir(join(fixture.root, 'scripts', 'lib'), { recursive: true });
	for (const path of ['scripts/create-soundscaper-rc.mjs', 'scripts/prepare-soundscaper-release.mjs', 'scripts/lib/product-release-lines.mjs', 'src/common/release/release-version.ts', 'src/common/release/release-packaging.ts']) {
		await mkdir(dirname(join(fixture.root, path)), { recursive: true });
		await writeFile(join(fixture.root, path), await readFile(new URL(`../${path}`, import.meta.url)));
	}
	const script = join(fixture.root, 'scripts', 'create-soundscaper-rc.mjs');
	const status = await fixture.git(['status', '--porcelain']);
	const help = await execute(process.execPath, [script, '--help'], { cwd: fixture.root });
	assert.match(help.stdout, /Usage: npm run release:soundscaper:rc/u);
	await assert.rejects(execute(process.execPath, [script, '--push'], { cwd: fixture.root }), /no arguments/u);
	assert.equal(await fixture.git(['status', '--porcelain']), status);
	assert.equal(await fixture.git(['rev-list', '--count', 'HEAD']), '1');
	const result = await execute(process.execPath, [script], { cwd: fixture.root });
	const version = JSON.parse(await fixture.git(['show', 'HEAD:package.json'])).releaseVersion;
	assert.match(version, /^Soundscaper-rc\.\d{4}\.[A-Z][a-z]{2}\.\d{1,2}\.[a-z]+$/u);
	assert.equal(await fixture.git(['rev-parse', `${version}^{commit}`]), await fixture.git(['rev-parse', 'HEAD']));
	assert.match(result.stdout, /Push when ready:/u);
	assert.equal(await fixture.git(['remote']), '');
});

async function assertUnchangedAfterFailure(fixture, pattern) {
	await writeFile(join(fixture.root, 'tracked.txt'), 'staged work\n');
	await fixture.git(['add', '--', 'tracked.txt']);
	await writeFile(join(fixture.root, 'tracked.txt'), 'unstaged work\n');
	const before = await Promise.all(METADATA_PATHS.map(path => readFile(join(fixture.root, path), 'utf8')));
	const index = await fixture.git(['diff', '--cached']);
	await assert.rejects(createSoundscaperRc({ repositoryRoot: fixture.root, now: TODAY, writeOutput: () => {} }), pattern);
	assert.deepEqual(await Promise.all(METADATA_PATHS.map(path => readFile(join(fixture.root, path), 'utf8'))), before);
	assert.equal(await fixture.git(['diff', '--cached']), index);
	assert.equal(await fixture.git(['tag', '--list']), '');
}

async function repositoryFixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-rc-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const git = async args => (await execute('git', args, { cwd: root })).stdout.trim();
	await git(['init', '--quiet']);
	for (const [key, value] of Object.entries({ 'user.name': 'RC Test', 'user.email': 'rc@example.test',
		'commit.gpgSign': 'false', 'tag.gpgSign': 'false', 'core.hooksPath': 'disabled-hooks' })) {
		await git(['config', key, value]);
	}
	const releaseLines = JSON.parse(await readFile(new URL('../config/product-release-lines.json', import.meta.url), 'utf8'));
	releaseLines.products.soundscaper.applicationVersionChannel = 'candidate';
	releaseLines.products.soundscaper.releaseChannel = 'candidate';
	releaseLines.products.soundscaper.candidate.version = 'Soundscaper-rc.2026.Oct.29.a';
	const documents = {
		'config/product-release-lines.json': releaseLines,
		'package.json': { name: 'soundscaper', version: 'Soundscaper-rc.2026.Oct.29.a' },
		'package-lock.json': { name: 'soundscaper', version: 'Soundscaper-rc.2026.Oct.29.a',
			packages: { '': { name: 'soundscaper', version: 'Soundscaper-rc.2026.Oct.29.a' } } },
		'desktop/product.json': { schemaVersion: 1, id: 'soundscaper', applicationVersion: 'Soundscaper-rc.2026.Oct.29.a',
			applicationVersionChannel: 'candidate', releaseChannel: 'candidate', updateTagPrefix: 'Soundscaper' },
	};
	await mkdir(join(root, 'config'));
	await mkdir(join(root, 'desktop'));
	for (const [path, value] of Object.entries(documents)) await writeFile(join(root, path), `${JSON.stringify(value, null, '\t')}\n`);
	await writeFile(join(root, '.gitignore'), 'dist/\nprivate/\n');
	await writeFile(join(root, 'tracked.txt'), 'original\n');
	await writeFile(join(root, 'removed.txt'), 'original\n');
	await git(['add', '--all', '--', '.']);
	await git(['commit', '--quiet', '-m', 'Initial fixture']);
	return { root, git };
}
