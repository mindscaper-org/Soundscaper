/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { basicPitchCatalogPromotion, validateBasicPitchSource } from '../scripts/models/basic-pitch-model-assets.mjs';
const json = async (path: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(new URL('../' + path, import.meta.url), 'utf8')) as Record<string, unknown>;

test('Basic Pitch stays unoffered until verified publication and promotion binds the final licensing row', async () => {
	const [source, catalog, matrix] = await Promise.all(['config/basic-pitch-model-source.json', 'config/local-model-catalog.json', 'config/production-licensing-matrix.json'].map(json));
	validateBasicPitchSource(source);
	const evidence = (matrix!.localModelEvidence as { id: string; distributionStatus: string }[]).find(row => row.id === 'basic-pitch');
	assert.equal((catalog!.entries as { modelId: string }[]).some(row => row.modelId === 'basic-pitch'), evidence?.distributionStatus === 'permitted');
	const artifact = source!.artifact as { fileName: string; sha256: string; byteLength: number };
	const receipt = { schemaVersion: 1, modelId: 'basic-pitch', version: '1.0.0', checks: ['public-head', 'byte-range', 'cors', 'full-sha256'],
		artifacts: [{ ...artifact, url: 'https://assets.soundscaper.org/models/basic-pitch/1.0.0/nmp.onnx' }] };
	assert.throws(() => basicPitchCatalogPromotion({ source, catalog, matrix, receipt: { ...receipt, checks: [] } }), /checks/iu);
	assert.throws(() => basicPitchCatalogPromotion({ source: { ...source, realTestCase: {
		...(source!.realTestCase as Record<string, unknown>), fixtureId: 'speech-16khz',
	} }, catalog, matrix, receipt }), /fixture/iu);
	const result = basicPitchCatalogPromotion({ source, catalog, matrix, receipt });
	assert.equal(result.entry.modelId, 'basic-pitch');
	assert.equal(result.evidence.distributionStatus, 'permitted');
	assert.deepEqual(result.entry.platforms, ['darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']);
	assert.deepEqual(result.evidence.blockedBy, []);
	assert.notEqual(result.entry.licensingEvidence.sha256, '0'.repeat(64));
});

test('Basic Pitch publication refuses substituted model bytes or source revisions', async () => {
	const source = await json('config/basic-pitch-model-source.json');
	assert.throws(() => validateBasicPitchSource({ ...source, sourceRevision: 'f'.repeat(40) }));
	const artifact = source.artifact as Record<string, unknown>;
	assert.throws(() => validateBasicPitchSource({ ...source, artifact: { ...artifact, sha256: 'f'.repeat(64) } }));
});
