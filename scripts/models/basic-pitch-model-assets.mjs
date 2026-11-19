#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BASIC_PITCH_MODEL_ID, BASIC_PITCH_MODEL_VERSION, BASIC_PITCH_MODEL_SHA256,
	BASIC_PITCH_SOURCE_REVISION } from '../../src/common/editor/assistance/basic-pitch-model.ts';
import { localModelEvidenceSha256 } from '../../desktop/local-model-catalog-integrity.ts';
import { validateLocalModelCatalog } from '../../desktop/local-model-catalog.ts';
import { assertPublishable, mirrorLocalModel } from '../lib/local-model-mirror.mjs';
import { validateLocalModelRealTestCases } from '../lib/local-model-real-test-cases.mjs';

const root = resolve(import.meta.dirname, '../..');
const checks = ['public-head', 'byte-range', 'cors', 'full-sha256'];
const receiptPath = 'evidence/local-model-publication/basic-pitch.json';
const platforms = ['darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateBasicPitchSource(source) {
	assert.equal(source.schemaVersion, 1);
	assert.equal(source.modelId, BASIC_PITCH_MODEL_ID);
	assert.equal(source.version, BASIC_PITCH_MODEL_VERSION);
	assert.equal(source.sourceRevision, BASIC_PITCH_SOURCE_REVISION);
	assert.equal(source.task, 'music-transcription');
	assert.equal(source.runtimeFamily, 'onnxruntime-node');
	assert.equal(source.catalogActivation, 'after-public-readback');
	assert.equal(source.sourceRepository, 'https://github.com/spotify/basic-pitch');
	assert.deepEqual(source.platforms, platforms);
	assert.equal(source.minimumMemoryBytes, 2 * 1024 ** 3);
	assert.deepEqual(source.artifact, { fileName: 'nmp.onnx', byteLength: 230444, sha256: BASIC_PITCH_MODEL_SHA256,
		url: `https://raw.githubusercontent.com/spotify/basic-pitch/${BASIC_PITCH_SOURCE_REVISION}/basic_pitch/saved_models/icassp_2022/nmp.onnx` });
	return source;
}

function catalogEntry(source, evidence, catalog) {
	return { modelId: source.modelId, version: source.version, task: source.task,
		platforms: source.platforms, minimumMemoryBytes: source.minimumMemoryBytes,
		licensingEvidence: { id: evidence.id, sha256: localModelEvidenceSha256(evidence) },
		upstream: { source: source.sourceRepository, revision: source.sourceRevision, artifacts: [source.artifact] },
		distribution: { kind: 'identity-mirrored' }, artifacts: [{ ...source.artifact,
			url: `${catalog.publication.publicBaseUrl}${source.modelId}/${source.version}/${source.artifact.fileName}` }] };
}

/** A failed upload/readback cannot turn a candidate into an offered model. */
export function basicPitchCatalogPromotion({ source, catalog, matrix, receipt }) {
	validateBasicPitchSource(source);
	const oldEvidence = assertPublishable(matrix.localModelEvidence, source.modelId);
	assert.equal(receipt.schemaVersion, 1);
	assert.equal(receipt.modelId, source.modelId);
	assert.equal(receipt.version, source.version);
	assert.deepEqual(receipt.checks, checks, 'All public publication checks must pass.');
	const evidence = { ...oldEvidence, distributionStatus: 'permitted', blockedBy: [],
		requirements: { ...oldEvidence.requirements, 'versioned-download-notices-and-hashes': {
			status: 'recorded', summary: `The exact upstream model is identity-mirrored at an immutable versioned product URL. Public HEAD, byte-range, CORS and full SHA-256 readback are retained in ${receiptPath}. Offline notices and the inspected graph are pinned in config/basic-pitch-model-source.json.`,
		} }, evidence: [...new Set([...oldEvidence.evidence, receiptPath])] };
	const entry = catalogEntry(source, evidence, catalog);
	assert.deepEqual(receipt.artifacts, entry.artifacts, 'Published bytes must match the reviewed model and product URL.');
	validateLocalModelRealTestCases({ schemaVersion: 1, cases: [source.realTestCase] }, { entries: [entry] });
	const nextMatrix = { ...matrix, localModelEvidence: matrix.localModelEvidence.map(row => row.id === evidence.id ? evidence : row) };
	const nextCatalog = { ...catalog, entries: [...catalog.entries.filter(row => row.modelId !== entry.modelId), entry] };
	validateLocalModelCatalog(nextCatalog, { licensingEvidence: nextMatrix.localModelEvidence });
	return { evidence, entry, matrix: nextMatrix, catalog: nextCatalog };
}

/** Preserve the surrounding reviewed register's formatting when changing one owned row. */
function replaceEvidenceRow(text, before, after) {
	const serialize = row => JSON.stringify(row, null, '\t').split('\n').map(line => '\t\t' + line).join('\n');
	assert.ok(text.includes(serialize(before)), 'The Basic Pitch evidence row must retain its canonical formatting.');
	return text.replace(serialize(before), serialize(after));
}
function appendRecord(text, key, entry) {
	const marker = `\t"${key}": [\n`;
	assert.ok(text.includes(marker));
	const serialized = JSON.stringify(entry, null, '\t').split('\n').map(line => '\t\t' + line).join('\n');
	return text.replace(marker, marker + serialized + ',\n');
}

async function main() {
	const args = process.argv.slice(2);
	assert.ok(args.every(arg => ['--publish', '--write-catalog'].includes(arg)), 'Only --publish and --write-catalog are supported.');
	const publish = args.includes('--publish'), writeCatalog = args.includes('--write-catalog');
	assert.ok(!writeCatalog || publish, '--write-catalog requires verified publication.');
	const read = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
	const source = validateBasicPitchSource(await read('config/basic-pitch-model-source.json'));
	for (const notice of source.notices) {
		assert.ok(/^LICENSES\/local-models\/basic-pitch-[A-Za-z.]+$/u.test(notice.path));
		assert.equal(digest(await readFile(resolve(root, notice.path))), notice.sha256, notice.path);
	}
	const inspection = await read('evidence/basic-pitch-model-inspection.json');
	assert.equal(inspection.artifactSha256, source.artifact.sha256);
	assert.equal(inspection.sourceRevision, source.sourceRevision);
	const catalog = await read('config/local-model-catalog.json');
	const matrixPath = resolve(root, 'config/production-licensing-matrix.json');
	const matrixText = await readFile(matrixPath, 'utf8'), matrix = JSON.parse(matrixText);
	const oldEvidence = assertPublishable(matrix.localModelEvidence, source.modelId);
	const entry = catalogEntry(source, oldEvidence, catalog);
	const result = await mirrorLocalModel({ catalog: { ...catalog, entries: [...catalog.entries.filter(row => row.modelId !== entry.modelId), entry] },
		evidence: matrix.localModelEvidence, modelId: source.modelId, stagingRoot: resolve(root, 'private/basic-pitch-assets'), publish });
	if (!publish) { console.log('Verified the pinned Basic Pitch model locally; no assets published and no catalog changed.'); return; }
	const receipt = { schemaVersion: 1, modelId: source.modelId, version: source.version, checkedAt: new Date().toISOString(),
		checks, artifacts: result.artifacts };
	const promoted = basicPitchCatalogPromotion({ source, catalog, matrix, receipt });
	await mkdir(resolve(root, 'evidence/local-model-publication'), { recursive: true });
	await writeFile(resolve(root, receiptPath), JSON.stringify(receipt, null, '\t') + '\n');
	if (writeCatalog) {
		const catalogPath = resolve(root, 'config/local-model-catalog.json');
		const existing = catalog.entries.find(row => row.modelId === source.modelId);
		if (existing) assert.deepEqual(existing, promoted.entry, 'An existing catalog entry cannot be silently replaced.');
		const nextCatalogText = existing ? null : appendRecord(await readFile(catalogPath, 'utf8'), 'entries', promoted.entry);
		const casesPath = resolve(root, 'config/local-model-real-test-cases.json');
		const caseText = await readFile(casesPath, 'utf8');
		const cases = JSON.parse(caseText), existingCase = cases.cases.find(row => row.id === source.realTestCase.id);
		if (existingCase) assert.deepEqual(existingCase, source.realTestCase, 'An existing execution case cannot be silently replaced.');
		const nextCaseText = existingCase ? null : appendRecord(caseText, 'cases', source.realTestCase);
		validateLocalModelRealTestCases(nextCaseText ? JSON.parse(nextCaseText) : cases, promoted.catalog);
		const nextMatrixText = replaceEvidenceRow(matrixText, oldEvidence, promoted.evidence);
		await writeFile(matrixPath, nextMatrixText);
		if (nextCatalogText) await writeFile(catalogPath, nextCatalogText);
		if (nextCaseText) await writeFile(casesPath, nextCaseText);
	}
	console.log('Published Basic Pitch with verified public readback. Review and commit the generated catalog, evidence and model instructions together.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
