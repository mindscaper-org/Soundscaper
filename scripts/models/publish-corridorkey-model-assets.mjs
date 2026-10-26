#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Publish pinned model files and notices without asserting catalog or GPU readiness. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchPinnedArtifact, uploadImmutableR2File, verifyMirroredArtifact } from '../lib/local-model-mirror.mjs';
import { R2Client } from '../lib/r2-client.mjs';

const root = resolve(import.meta.dirname, '../..');
const registerPath = 'config/framescaper-corridorkey-asset-publication.json';
const conversionPath = 'evidence/framescaper-corridorkey-conversion-candidate.json';
const json = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));

export function reviewCorridorKeyAssetPublication(register, conversion) {
	assert.equal(register.schemaVersion, 1);
	assert.equal(register.modelId, 'corridorkey-2.0');
	assert.equal(register.version, '2.0.0');
	assert.equal(register.sourceRevision, conversion.sourceRevision);
	assert.equal(register.licensingDecision.status, 'owner-authorized-readme-permission');
	assert.equal(register.licensingDecision.legalUncertaintyAccepted, true);
	assert.equal(register.licensingDecision.separateIntegrationGrant, false);
	assert.equal(register.licensingDecision.basisUrl,
		`https://github.com/nikopueringer/CorridorKey2.0/blob/${register.sourceRevision}/README.md#licensing-and-permissions`);
	assert.equal(register.catalogActivationReady, false);
	assert.equal(register.gpuValidation, 'pending');
	assert.deepEqual(register.publication, { bucket: 'soundscaper-assets',
		prefix: 'models/corridorkey-2.0/2.0.0', publicBaseUrl: 'https://assets.soundscaper.org/models/corridorkey-2.0/2.0.0/' });
	assert.equal(conversion.allFiveGraphsValidated, true);
	assert.deepEqual(conversion.graphs.map(graph => graph.role), ['cradio', 'moge', 'rvm', 'stage1', 'stage2']);
	const graphs = conversion.graphs.map(graph => {
		assert.equal(graph.status, 'candidate-cpu-parity-passed');
		assert.equal(graph.storage, 'embedded-single-blob');
		assert.equal(graph.artifacts.length, 1);
		assert.equal(graph.artifacts[0].fileName, `${graph.role}.onnx`);
		return graph.artifacts[0];
	});
	assert.deepEqual(register.notices.map(notice => notice.fileName), ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']);
	const artifacts = [...graphs, ...register.notices];
	for (const artifact of artifacts) {
		assert.equal(basename(artifact.fileName), artifact.fileName);
		assert.ok(Number.isSafeInteger(artifact.byteLength) && artifact.byteLength > 0 && artifact.byteLength <= 8 * 1024 ** 3);
		assert.match(artifact.sha256, /^[a-f\d]{64}$/u);
	}
	return Object.freeze(artifacts);
}

export async function assertCorridorKeyAssetFile(directory, artifact) {
	const path = resolve(directory, artifact.fileName);
	const metadata = await lstat(path);
	assert.ok(metadata.isFile() && !metadata.isSymbolicLink() && await realpath(path) === path, artifact.fileName);
	assert.equal(metadata.size, artifact.byteLength, artifact.fileName);
	const digest = createHash('sha256');
	for await (const chunk of createReadStream(path)) digest.update(chunk);
	assert.equal(digest.digest('hex'), artifact.sha256, artifact.fileName);
	return path;
}

async function main(args) {
	const register = await json(registerPath), conversion = await json(conversionPath);
	const artifacts = reviewCorridorKeyAssetPublication(register, conversion);
	if (args.length === 2 && args[0] === '--prepare-source') {
		const sourceRoot = resolve(args[1]);
		const { source } = await json('config/framescaper-corridorkey-model-source-candidate.json');
		const fetchArtifact = async artifact => {
			await fetchPinnedArtifact({ artifact: { ...artifact, fileName: artifact.localPath },
				modelId: basename(sourceRoot), stagingRoot: dirname(sourceRoot) });
			console.log(`Authenticated ${artifact.localPath}`);
		};
		await Promise.all(source.artifacts.map(fetchArtifact));
		for (const artifact of [...source.notices, ...source.cradioCodeSnapshot.files]) await fetchArtifact(artifact);
		return;
	}
	if (args.length === 3 && args[0] === '--stage-notices') {
		const directory = resolve(args[2]); await mkdir(directory, { recursive: true });
		for (const artifact of register.notices) {
			await assertCorridorKeyAssetFile(resolve(args[1]), artifact);
			await copyFile(join(resolve(args[1]), artifact.fileName), join(directory, artifact.fileName));
		}
		return;
	}
	assert.ok(args.length === 5 && args[0] === '--publish' && args[1] === '--model-root' && args[3] === '--receipt',
		'Usage: --prepare-source <checkout> | --stage-notices <checkout> <model-root> | --publish --model-root <directory> --receipt <file>');
	const modelRoot = resolve(args[2]);
	// Authenticate the complete inventory before the first public write.
	const paths = [];
	for (const artifact of artifacts) paths.push(await assertCorridorKeyAssetFile(modelRoot, artifact));
	const client = new R2Client({ environmentPrefix: 'R2_MODELS', defaultBucket: register.publication.bucket, label: 'CorridorKey assets' });
	assert.equal(client.bucket, register.publication.bucket);
	assert.match(client.endpoint.hostname, /\.eu\.r2\.cloudflarestorage\.com$/u);
	const published = [];
	for (const [index, artifact] of artifacts.entries()) {
		const key = `${register.publication.prefix}/${artifact.fileName}`;
		await uploadImmutableR2File({ client, key, file: paths[index], artifact,
			contentType: artifact.fileName.endsWith('.onnx') ? 'application/octet-stream' : 'text/plain; charset=utf-8' });
		const url = `${register.publication.publicBaseUrl}${artifact.fileName}`;
		published.push({ fileName: artifact.fileName, ...await verifyMirroredArtifact({ url, artifact }) });
		console.log(`Published and verified ${url}`);
	}
	const pin = async path => { const bytes = await readFile(resolve(root, path)); return {
		path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }; };
	const receipt = { schemaVersion: 1, modelId: register.modelId, version: register.version,
		status: 'assets-published-and-public-readback-verified', measuredAt: new Date().toISOString(),
		catalogActivationReady: false, gpuValidated: false,
		publicationDecision: await pin(registerPath), conversionEvidence: await pin(conversionPath), artifacts: published };
	await mkdir(dirname(resolve(args[4])), { recursive: true });
	await writeFile(resolve(args[4]), `${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2));
