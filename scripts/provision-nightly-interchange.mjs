#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';

import { fetchWithTransientRetry } from './provision-interchange-conformance.mjs';
import { assertSafeTree } from './lib/desktop-nightly-tests-staging-filesystem.mjs';

const ROOT = resolve(import.meta.dirname, '..');

export async function verifiedNightlyPythonArchive({ url, sha256 }, fetchImpl = fetchWithTransientRetry) {
	const response = await fetchImpl(url);
	if (!response.ok) throw new Error(`Nightly reference Python download failed: HTTP ${response.status}.`);
	const bytes = Buffer.from(await response.arrayBuffer());
	if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
		throw new Error('Nightly reference Python archive digest does not match its committed pin.');
	}
	return bytes;
}

export async function provisionNightlyInterchange({
	repositoryRoot = ROOT,
	platform = process.env.SOUNDSCAPER_DESKTOP_TARGET_PLATFORM || ({ win32: 'win', darwin: 'mac' }[process.platform] ?? process.platform),
	arch = process.env.SOUNDSCAPER_DESKTOP_TARGET_ARCH || process.arch,
} = {}) {
	const config = JSON.parse(await readFile(join(repositoryRoot, 'config/nightly-interchange-python.json'), 'utf8'));
	const target = `${platform}-${arch}`;
	const triple = config.targets[target];
	const archive = config.archives[triple];
	if (!archive) throw new Error(`No nightly reference Python is pinned for ${target}.`);
	const baseUrl = `https://github.com/astral-sh/python-build-standalone/releases/download/${config.release}/`;
	const buildRoot = join(repositoryRoot, '.desktop-build');
	await mkdir(buildRoot, { recursive: true });
	const temporaryRoot = await mkdtemp(join(buildRoot, 'interchange-python-'));
	const referenceRoot = join(repositoryRoot, 'vendor/interchange-conformance');
	try {
		const bytes = await verifiedNightlyPythonArchive({ url: baseUrl + encodeURIComponent(archive.filename), sha256: archive.sha256 });
		const tar = join(temporaryRoot, 'python.tar');
		await writeFile(tar, zstdDecompressSync(bytes));
		execFileSync('tar', ['-xf', tar, '-C', temporaryRoot, 'python/licenses', 'python/PYTHON.json'], { stdio: 'inherit' });
		const pythonRoot = join(temporaryRoot, 'python');
		const runtime = join(temporaryRoot, 'runtime.tar.gz');
		await writeFile(runtime, await verifiedNightlyPythonArchive({
			url: baseUrl + encodeURIComponent(archive.runtimeFilename), sha256: archive.runtimeSha256,
		}));
		await mkdir(join(pythonRoot, 'install'));
		execFileSync('tar', ['-xzf', runtime, '-C', join(pythonRoot, 'install'), '--strip-components=1'], { stdio: 'inherit' });
		await assertSafeTree(pythonRoot, 'nightly reference Python', { allowContainedSymlinks: true });
		const python = join(pythonRoot, 'install', platform === 'win' ? 'python.exe' : 'bin/python3.12');
		const metadata = JSON.parse(await readFile(join(pythonRoot, 'PYTHON.json'), 'utf8'));
		if (metadata.target_triple !== triple || metadata.python_version !== config.version) {
			throw new Error('Nightly reference Python metadata disagrees with its pinned target or version.');
		}
		execFileSync(process.execPath, [join(repositoryRoot, 'scripts/provision-interchange-conformance.mjs')], {
			cwd: repositoryRoot,
			env: { ...process.env, SOUNDSCAPER_PYTHON: python, PYTHONDONTWRITEBYTECODE: '1' },
			stdio: 'inherit',
		});
		// Preserve the full installation and upstream dependency notices. Build
		// objects stay outside the payload, and no host Python paths are copied.
		await rename(pythonRoot, join(referenceRoot, 'python'));
		await cp(join(repositoryRoot, 'config/nightly-interchange-python.json'), join(referenceRoot, 'nightly-python-source.json'));
		const relocated = join(referenceRoot, 'python/install', platform === 'win' ? 'python.exe' : 'bin/python3.12');
		execFileSync(relocated, ['-c', 'import opentimelineio as otio; assert {"cmx_3600", "fcpx_xml", "otio_json"} <= {a.name for a in otio.plugins.ActiveManifest().adapters}'], {
			env: { ...process.env, PYTHONPATH: referenceRoot, PYTHONDONTWRITEBYTECODE: '1' },
			stdio: 'inherit',
		});
		console.log(`Nightly interchange readers and relocatable Python ${config.version} ready for ${target} (${triple}).`);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	await provisionNightlyInterchange();
}
