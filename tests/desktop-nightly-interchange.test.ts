/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { interchangePythonExecutable } from '../scripts/lib/interchange-python.mjs';
import { verifiedNightlyPythonArchive } from '../scripts/provision-nightly-interchange.mjs';
import { createFixture } from './helpers/nightly-tests-staging-fixture.js';
import { stageDesktopNightlyTests } from '../scripts/lib/desktop-nightly-tests-staging.mjs';
import { selectDesktopNightlyTestTargets } from '../scripts/lib/desktop-nightly-tests-target-matrix.mjs';

test('every maintained nightly target pins a reference interpreter and matching upstream license archive', async () => {
	const config = JSON.parse(await readFile(new URL('../config/nightly-interchange-python.json', import.meta.url), 'utf8')) as {
		targets: Record<string, string>;
		archives: Record<string, { filename: string; sha256: string; runtimeFilename: string; runtimeSha256: string }>;
	};
	for (const { platform, arch } of selectDesktopNightlyTestTargets('all')) {
		const triple = config.targets[`${platform}-${arch}`];
		const archive = config.archives[triple];
		assert.ok(archive, `${platform}-${arch} needs a pinned interpreter`);
		assert.match(archive.sha256, /^[a-f0-9]{64}$/u);
		assert.match(archive.runtimeSha256, /^[a-f0-9]{64}$/u);
		assert.ok(archive.filename.includes(triple));
		assert.ok(archive.runtimeFilename.includes(triple));
	}
	assert.equal(config.targets['win-arm64'], 'x86_64-pc-windows-msvc');
});

test('packaged interchange readers select their relocated interpreter without host Python', async (context) => {
	const referenceRoot = await mkdtemp(join(tmpdir(), 'soundscaper-reference-python-'));
	context.after(() => rm(referenceRoot, { recursive: true, force: true }));
	for (const [platform, executable] of [['win32', 'python.exe'], ['linux', 'bin/python3.12'], ['darwin', 'bin/python3.12']] as const) {
		const bundled = join(referenceRoot, 'python/install', executable);
		await mkdir(join(bundled, '..'), { recursive: true });
		await writeFile(bundled, 'bundled interpreter fixture');
		assert.equal(interchangePythonExecutable({ referenceRoot, platform, environment: { SOUNDSCAPER_PYTHON: 'host-python' } }), bundled);
	}
	const absentRoot = join(referenceRoot, 'unprovisioned');
	assert.equal(interchangePythonExecutable({ referenceRoot: absentRoot, environment: { SOUNDSCAPER_PYTHON: 'chosen-python' } }), 'chosen-python');
	assert.equal(interchangePythonExecutable({ referenceRoot: absentRoot, platform: 'win32', environment: {} }), 'python');
});

test('nightly Python archives must match their committed digest before extraction', async () => {
	await assert.rejects(verifiedNightlyPythonArchive({
		url: 'https://github.com/astral-sh/python-build-standalone/releases/download/pin/python.tar.gz',
		sha256: '0'.repeat(64),
	}, async () => new Response('unexpected archive')), /digest/u);
	await assert.rejects(verifiedNightlyPythonArchive({ url: 'https://example.invalid/python', sha256: '0'.repeat(64) },
		async () => new Response('missing', { status: 404 })), /HTTP 404/u);
});

test('nightly staging carries the independent readers, interpreter, and their upstream notices', async (context) => {
	const fixture = await createFixture(context);
	for (const [path, contents] of [
		['opentimelineio/__init__.py', '# reference reader fixture\n'],
		['opentimelineio-0.18.1.dist-info/licenses/LICENSE.txt', 'Apache-2.0 fixture\n'],
		['python/install/bin/python3.12', 'portable interpreter fixture\n'],
		['python/licenses/LICENSE.cpython.txt', 'Python license fixture\n'],
	]) {
		const file = join(fixture.repositoryRoot, 'vendor/interchange-conformance', path);
		await mkdir(join(file, '..'), { recursive: true });
		await writeFile(file, contents);
	}
	await stageDesktopNightlyTests(fixture);
	for (const path of ['opentimelineio/__init__.py', 'opentimelineio-0.18.1.dist-info/licenses/LICENSE.txt', 'python/install/bin/python3.12', 'python/licenses/LICENSE.cpython.txt']) {
		assert.equal(await readFile(join(fixture.outputRoot, 'vendor/interchange-conformance', path), 'utf8'),
			await readFile(join(fixture.repositoryRoot, 'vendor/interchange-conformance', path), 'utf8'));
	}
	await rm(join(fixture.repositoryRoot, 'vendor/interchange-conformance/python/install/bin/python3.12'));
	await assert.rejects(stageDesktopNightlyTests(fixture), /interchange/u);
	await rm(join(fixture.repositoryRoot, 'vendor/interchange-conformance'), { recursive: true });
	await assert.rejects(stageDesktopNightlyTests(fixture), /interchange/u);
	assert.equal(await readFile(join(fixture.outputRoot, 'vendor/interchange-conformance/python/install/bin/python3.12'), 'utf8'), 'portable interpreter fixture\n');
});

test('nightly packaging provisions independent readers before staging and includes their whole tree', async () => {
	const workflow = await readFile(new URL('../.github/workflows/desktop-nightly-tests.yml', import.meta.url), 'utf8');
	const provision = workflow.indexOf('run: node scripts/provision-nightly-interchange.mjs');
	assert.ok(provision > 0);
	assert.ok(provision < workflow.indexOf('run: node scripts/desktop-nightly-tests-prepare.mjs'));
	const builder = await readFile(new URL('../electron-builder.nightly-tests.config.cjs', import.meta.url), 'utf8');
	assert.match(builder, /'vendor\/interchange-conformance\/\*\*\/\*'/u);
});
