#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { configureCiArtifactFetch } from './lib/ci-artifact-fetch.ts';
import { buildKokoroG2pBundle, describeKokoroG2pBuildInputs,
	kokoroG2pBuildPlan, kokoroG2pCacheIdentity } from './kokoro-g2p/build.mjs';

const [operation] = process.argv.slice(2);
if (process.argv.length !== 3 || !['key', 'prepare'].includes(operation)) throw new Error('Expected key or prepare.');
const targetId = process.env.SCAPE_KOKORO_CACHE_TARGET;
kokoroG2pBuildPlan({ targetId });
const root = resolve(import.meta.dirname, '..');
configureCiArtifactFetch();
if (operation === 'key') {
	const { stdout } = await promisify(execFile)('uv', ['--version'], { windowsHide: true });
	const policyFiles = ['scripts/ci-kokoro-g2p-cache.mjs', 'scripts/setup-ci-native-tooling.mjs',
		'.github/actions/setup-native-tooling/action.yml', '.github/actions/verified-kokoro-g2p/action.yml'];
	const policy = createHash('sha256');
	for (const path of policyFiles) policy.update(await readFile(resolve(root, path)));
	const key = kokoroG2pCacheIdentity({ inputs: await describeKokoroG2pBuildInputs(), targetId,
		platform: process.platform, architecture: process.arch, nodeVersion: process.version,
		uvVersion: stdout.trim(), scope: `${process.env.ImageOS}/${process.env.ImageVersion}/${policy.digest('hex')}` });
	console.log(`key=${key}`);
} else {
	const result = await buildKokoroG2pBundle({ targetId });
	if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `reused=${result.reused}\n`);
	console.log(`${result.reused ? 'Verified cached' : 'Built'} Kokoro G2P bundle: ${result.bundleRoot}`);
}
