/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { reviewCorridorKeyAssetPublication, assertCorridorKeyAssetFile } from '../scripts/models/publish-corridorkey-model-assets.mjs';
import { CORRIDORKEY_GRAPH_ARTIFACTS_V1 } from '../desktop/assistance-corridorkey-model.ts';

async function fixtures() {
	const read = async (path: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8')) as Record<string, unknown>;
	return { register: await read('config/framescaper-corridorkey-asset-publication.json'),
		conversion: await read('evidence/framescaper-corridorkey-conversion-candidate.json') };
}
test('asset publication preserves the five engine pins and notices without claiming a grant or GPU readiness', async () => {
	const { register, conversion } = await fixtures();
	const artifacts = reviewCorridorKeyAssetPublication(register, conversion) as readonly { fileName: string; byteLength: number; sha256: string }[];
	assert.equal(artifacts.length, 8);
	assert.deepEqual(artifacts.slice(0, 5), CORRIDORKEY_GRAPH_ARTIFACTS_V1.map(({ role: _role, ...artifact }) => artifact));
	for (const change of [{ gpuValidation: 'passed' }, { catalogActivationReady: true },
		{ licensingDecision: { status: 'owner-authorized-readme-permission', legalUncertaintyAccepted: false } }]) {
		assert.throws(() => reviewCorridorKeyAssetPublication({ ...register, ...change }, conversion));
	}
});
test('asset file authentication rejects changed bytes before publication', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'corridorkey-publication-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const bytes = Buffer.from('exact reviewed model bytes');
	const artifact = { fileName: 'fixture.onnx', byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
	await writeFile(join(directory, artifact.fileName), bytes);
	assert.equal(await assertCorridorKeyAssetFile(directory, artifact), join(directory, artifact.fileName));
	await writeFile(join(directory, artifact.fileName), Buffer.alloc(bytes.length));
	await assert.rejects(assertCorridorKeyAssetFile(directory, artifact));
});
