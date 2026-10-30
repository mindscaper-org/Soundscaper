#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fetchPinnedArtifact } from '../lib/local-model-mirror.mjs';
import { validateAssistanceRuntimeDistribution } from '../../desktop/assistance-runtime-distribution.ts';

assert.ok(process.argv.length === 4 && process.argv[2] === '--output', 'Usage: --output <directory>');
const directory = resolve(process.argv[3]);
const snapshot = JSON.parse(gunzipSync(await readFile(new URL('../../config/desktop-test-assistance-runtime-snapshots/linux-x64.json.gz', import.meta.url))).toString('utf8'));
const distribution = validateAssistanceRuntimeDistribution(JSON.parse(snapshot.files['config/assistance-runtime-distribution.json']), 'linux-x64');
const bundle = distribution.bundles.find(row => row.familyId === 'onnxruntime-node');
assert.ok(bundle);
const archive = await fetchPinnedArtifact({ artifact: { ...bundle.archive, fileName: 'onnxruntime.tar.gz' },
	modelId: 'production-onnxruntime', stagingRoot: directory });
const runtimeRoot = join(directory, 'production-onnxruntime', 'extracted');
await mkdir(runtimeRoot, { recursive: true });
const result = spawnSync('tar', ['-xzf', archive.path, '-C', runtimeRoot, '--no-same-owner', '--no-same-permissions'], { stdio: 'inherit' });
assert.equal(result.status, 0, 'Production runtime archive extraction failed.');
console.log(JSON.stringify({ runtimeRoot, archive: archive.path, expectedFiles: bundle.files.length }));
