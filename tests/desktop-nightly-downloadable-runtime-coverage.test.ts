/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { preserveDesktopNightlyProductCoverageEvidence } from '../scripts/lib/desktop-nightly-product-coverage-evidence.mjs';
import { createCoverageFixture, REVISION } from './helpers/desktop-nightly-product-coverage-fixture.ts';

async function write(path: string, value: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, value);
}

async function preserve(buildRoot: string, productOutput: string) {
	return preserveDesktopNightlyProductCoverageEvidence({
		buildRoot, productId: 'soundscaper', productOutput, sourceRevision: REVISION,
	});
}

test('nightly coverage binds downloadable runtime authority without packaging AI files', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-downloadable-runtime-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const { buildRoot, productOutput } = await createCoverageFixture(workspace);
	const manifest = await preserve(buildRoot, productOutput);
	assert.deepEqual(manifest.excludedRuntimeScripts, []);
	const stagePath = join(buildRoot, 'stage-manifest.json');
	const stage = JSON.parse(await readFile(stagePath, 'utf8'));
	stage.assistanceRuntimeDistribution.manifest.sha256 = '0'.repeat(64);
	await writeFile(stagePath, `${JSON.stringify(stage, null, 2)}\n`);
	await assert.rejects(preserve(buildRoot, productOutput), /assistance runtime distribution/iu);
});

test('nightly coverage rejects AI files staged beside a downloadable runtime manifest', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-embedded-ai-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const { buildRoot, productOutput } = await createCoverageFixture(workspace);
	await write(join(buildRoot, 'runtime/assistance/sherpa-onnx/1.13.5/forbidden.js'), 'void 0;\n');
	await assert.rejects(preserve(buildRoot, productOutput), /preinstalled assistance runtime/iu);
});
