/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateLocalModelCatalog } from '../desktop/local-model-catalog.ts';
import { SHERPA_ENHANCEMENT_ARTIFACTS } from '../desktop/assistance-sherpa-enhancement-contract.ts';
import { validateLocalModelRealTestCases } from '../scripts/lib/local-model-real-test-cases.mjs';

const json = async (path: string) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8')) as unknown;
interface Publication { checks: string[]; artifacts: { modelId: string; version: string; fileName: string;
	byteLength: number; sha256: string; url: string }[]; }
interface Inspection { models: { fileName: string; byteLength: number; sha256: string;
	metadata: Record<string, string>; inputs: { name: string }[]; outputs: { name: string }[] }[]; }

test('every offered Sherpa enhancement has exact runtime pins, full public readback and an executable nightly case', async () => {
	const matrix = await json('config/production-licensing-matrix.json') as { localModelEvidence: unknown[] };
	const catalog = validateLocalModelCatalog(await json('config/local-model-catalog.json'), { licensingEvidence: matrix.localModelEvidence });
	const publication = await json('evidence/local-model-publication/sherpa-enhancement.json') as Publication;
	const inspection = await json('evidence/sherpa-enhancement-models.json') as Inspection;
	assert.deepEqual(publication.checks, ['public-head', 'byte-range', 'cors', 'full-sha256']);
	const cases = validateLocalModelRealTestCases(await json('config/local-model-real-test-cases.json'), catalog);
	for (const modelId of ['gtcrn', 'dpdfnet2-48khz', 'voxlock'] as const) {
		const entry = catalog.entries.find((candidate) => candidate.modelId === modelId)!;
		assert.ok(entry); assert.equal(entry.task, 'speech-enhancement'); assert.equal(entry.distribution.kind, 'identity-mirrored');
		assert.deepEqual(entry.platforms, ['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']);
		assert.deepEqual(entry.artifacts.map(({ sha256 }) => sha256).sort(), SHERPA_ENHANCEMENT_ARTIFACTS[modelId].map(({ sha256 }) => sha256).sort());
		assert.ok(cases.some((candidate: { modelIds: string[]; operation: string }) => candidate.modelIds.includes(modelId) && candidate.operation === 'speech-enhancement'));
		for (const artifact of entry.artifacts) {
			const receipt = publication.artifacts.find((candidate) => candidate.modelId === modelId && candidate.fileName === artifact.fileName);
			assert.deepEqual(receipt, { modelId, version: entry.version, ...artifact });
			const graph = inspection.models.find((candidate) => candidate.fileName === artifact.fileName)!;
			assert.equal(graph.sha256, artifact.sha256); assert.equal(graph.byteLength, artifact.byteLength);
			assert.equal(graph.metadata.model_type, modelId === 'dpdfnet2-48khz' ? 'dpdfnet' : modelId);
			assert.ok(graph.inputs.length > 0 && graph.outputs.length > 0);
		}
	}
	const voxlock = inspection.models.filter((model) => model.metadata.model_type === 'voxlock');
	assert.deepEqual(voxlock.map((model) => model.metadata.model_role).sort(), ['chunk', 'enroll']);
});

test('retained source evidence pins every upstream license and model card byte', async () => {
	const evidence = await json('evidence/sherpa-enhancement-models.json') as { sourceEvidence: { path: string; byteLength: number; sha256: string }[] };
	assert.equal(evidence.sourceEvidence.length, 6);
	for (const file of evidence.sourceEvidence) {
		const bytes = await readFile(new URL(`../${file.path}`, import.meta.url));
		assert.equal(bytes.length, file.byteLength); assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
	}
});
