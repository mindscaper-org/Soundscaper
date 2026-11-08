/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CODEQL_TOOLS, prepareCodeqlTools } from '../scripts/ci-codeql-tools.mjs';

const bytes = Buffer.from('authenticated CodeQL archive fixture');
const pin = { ...CODEQL_TOOLS, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const filename = 'codeql-bundle-linux64.tar.zst';

test('CodeQL provisioning recovers the observed 504 through the asset API and reuses verified bytes offline', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-codeql-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const requests: string[] = [];
	const fetchImpl: typeof fetch = async input => {
		const address = String(input);
		requests.push(address);
		if (address === pin.url) return new Response(null, { status: 504 });
		if (address.includes('/releases/tags/')) return Response.json({ tag_name: `codeql-bundle-v${pin.version}`,
			assets: [{ id: 123, name: filename, browser_download_url: pin.url }] });
		assert.equal(address, 'https://api.github.com/repos/github/codeql-action/releases/assets/123');
		return new Response(bytes);
	};
	const archive = await prepareCodeqlTools({ directory, pin, fetchImpl });
	assert.equal(archive, join(directory, filename));
	assert.deepEqual(await readFile(archive), bytes);
	assert.equal(requests.length, 3);
	assert.equal(await prepareCodeqlTools({ directory, pin, fetchImpl: async () => {
		throw new Error('A verified cache must not access the network');
	} }), archive);
	assert.deepEqual(await readdir(directory), [filename]);
});

test('CodeQL provisioning replaces a corrupted cached bundle before handing it to init', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-codeql-damaged-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	await writeFile(join(directory, filename), Buffer.alloc(bytes.length));
	let downloads = 0;
	const archive = await prepareCodeqlTools({ directory, pin, fetchImpl: async () => {
		downloads += 1;
		return new Response(bytes);
	} });
	assert.equal(downloads, 1);
	assert.deepEqual(await readFile(archive), bytes);
});

test('CodeQL provisioning never publishes a bundle with a mismatched digest or length', async context => {
	for (const body of [Buffer.alloc(bytes.length), bytes.subarray(1)]) {
		const directory = await mkdtemp(join(tmpdir(), 'scape-codeql-refused-'));
		context.after(() => rm(directory, { recursive: true, force: true }));
		await assert.rejects(prepareCodeqlTools({ directory, pin, fetchImpl: async () => new Response(body) }), /integrity/u);
		assert.deepEqual(await readdir(directory), []);
	}
});

test('every CodeQL language initializes from the verified local bundle tied to the pinned action', async () => {
	const require = createRequire(import.meta.url);
	const { load } = require('js-yaml') as { load: (source: string) => { jobs: { analyze: {
		strategy: { matrix: { language: string[] } };
		steps: { id?: string; uses?: string; run?: string; with?: Record<string, string> }[];
	} } } };
	const workflow = load(await readFile(new URL('../.github/workflows/codeql.yml', import.meta.url), 'utf8'));
	const { steps, strategy } = workflow.jobs.analyze;
	assert.deepEqual(strategy.matrix.language, ['actions', 'c-cpp', 'javascript-typescript', 'python']);
	const prepare = steps.findIndex(step => step.id === 'codeql-tools');
	const init = steps.findIndex(step => step.uses?.startsWith('github/codeql-action/init@'));
	assert.ok(prepare >= 0 && prepare < init);
	assert.equal(steps[prepare]?.run, 'node scripts/ci-codeql-tools.mjs');
	assert.equal(steps[init]?.with?.tools, '${{ steps.codeql-tools.outputs.archive }}');
	assert.equal(steps[init]?.with?.['build-mode'], 'none');
	for (const step of steps.filter(step => step.uses?.startsWith('github/codeql-action/'))) {
		assert.equal(step.uses?.split('@')[1], CODEQL_TOOLS.actionRevision);
	}
	assert.ok(steps.some(step => step.uses?.startsWith('actions/cache/restore@') && step.with?.path === '.wrangler/ci-input-cache/codeql'));
});
