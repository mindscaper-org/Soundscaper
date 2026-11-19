/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create as createTar } from 'tar';
import { materializeMilestone5SourceArchive } from '../scripts/lib/milestone-5-source-archive-extraction.mjs';
import { collectExtractedSourceTree } from '../native/framescaper-media-host/build/source-authentication.mjs';

for (const wrapped of [false, true]) test(`preferred source tar accepts a uniform dot prefix with ${wrapped ? 'a common directory' : 'root entries'}`, async context => {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'source-dot-prefix-')));
	context.after(() => rm(root, { recursive: true, force: true }));
	const source = join(root, 'source'); await mkdir(source);
	await writeFile(join(source, 'README.txt'), 'preferred source\n');
	const { algorithm, fileCount, sha256 } = collectExtractedSourceTree(source);
	const archive = join(root, 'source.tar.gz');
	createTar({ cwd: wrapped ? root : source, file: archive, gzip: true, sync: true }, [wrapped ? './source' : '.']);
	await materializeMilestone5SourceArchive({ archiveBytes: await readFile(archive), archiveName: 'source.tar.gz',
		expectedTree: { algorithm, fileCount, sha256 }, destinationRoot: join(root, 'extracted') });
	assert.equal(await readFile(join(root, 'extracted/README.txt'), 'utf8'), 'preferred source\n');
});

test('mixed tar prefixes are refused before publishing an extracted source tree', async context => {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'source-mixed-prefix-')));
	context.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, 'one.txt'), 'one'); await writeFile(join(root, 'two.txt'), 'two');
	const { algorithm, fileCount, sha256 } = collectExtractedSourceTree(root);
	const archive = join(root, 'mixed.tar.gz');
	createTar({ cwd: root, file: archive, gzip: true, sync: true }, ['./one.txt', 'two.txt']);
	await assert.rejects(materializeMilestone5SourceArchive({ archiveBytes: await readFile(archive), archiveName: 'mixed.tar.gz',
		expectedTree: { algorithm, fileCount, sha256 }, destinationRoot: join(root, 'extracted') }), /uniform dot prefix/u);
});
