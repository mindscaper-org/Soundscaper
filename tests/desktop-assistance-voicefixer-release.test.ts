/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { voiceFixerCatalogPromotion } from '../scripts/models/voicefixer-model-assets.mjs';

test('VoiceFixer activation requires complete public readback for all three exact artifacts', async () => {
	const source = JSON.parse(await readFile(new URL('../config/voicefixer-model-source.json', import.meta.url), 'utf8'));
	const catalog = JSON.parse(await readFile(new URL('../config/local-model-catalog.json', import.meta.url), 'utf8'));
	const matrix = JSON.parse(await readFile(new URL('../config/production-licensing-matrix.json', import.meta.url), 'utf8'));
	const receipt = { schemaVersion: 1, modelId: source.modelId, version: source.version,
		checks: ['public-head', 'byte-range', 'cors', 'full-sha256'], artifacts: source.artifacts.map((artifact: { fileName: string }) =>
			({ ...artifact, url: `${catalog.publication.publicBaseUrl}${source.modelId}/${source.version}/${artifact.fileName}` })) };
	const promoted = voiceFixerCatalogPromotion({ source, catalog, matrix, receipt });
	assert.equal(promoted.entry.modelId, 'voicefixer');
	assert.equal(promoted.entry.distribution.kind, 'identity-mirrored');
	assert.deepEqual(promoted.entry.platforms, ['darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']);
	assert.deepEqual(promoted.evidence.blockedBy, []);
	assert.equal(promoted.evidence.distributionStatus, 'permitted');
	assert.throws(() => voiceFixerCatalogPromotion({ source, catalog, matrix, receipt: { ...receipt, checks: ['public-head'] } }));
	assert.throws(() => voiceFixerCatalogPromotion({ source, catalog, matrix, receipt: { ...receipt, artifacts: receipt.artifacts.slice(1) } }));
	assert.throws(() => voiceFixerCatalogPromotion({ source, catalog, matrix, receipt: { ...receipt, version: '2.0.0' } }));
	assert.throws(() => voiceFixerCatalogPromotion({ source, catalog, matrix, receipt: { ...receipt,
		artifacts: receipt.artifacts.map((a: object) => ({ ...a, sha256: 'a'.repeat(64) })) } }));
});
