/* SPDX-License-Identifier: AGPL-3.0-only */

/** Offline source identity review; this deliberately grants no production model authority. */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

interface SourceArtifact {
	readonly localPath: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly url: string;
}

const SHA256 = /^[a-f\d]{64}$/u;
const COMMIT = /^[a-f\d]{40}$/u;
const ARTIFACT_PATHS = Object.freeze([
	'weights/corridorkey_v2.safetensors', 'weights/foundation_stats.safetensors',
	'vfms/cradio/C-RADIOv4-SO400M/model.safetensors', 'vfms/moge/model.pt',
	'vfms/rvm/pretrain_rvm_small16_256_204031069.npz',
]);
const C_RADIO_SOURCE_PATHS = Object.freeze([
	'.gitattributes', 'README.md', 'adaptor_attn.py', 'adaptor_base.py', 'adaptor_generic.py',
	'adaptor_mlp.py', 'adaptor_module_factory.py', 'adaptor_registry.py', 'cls_token.py',
	'common.py', 'config.json', 'dinov2_arch.py', 'dual_hybrid_vit.py', 'enable_cpe_support.py',
	'enable_damp.py', 'enable_spectral_reparam.py', 'eradio_model.py', 'extra_models.py',
	'extra_timm_models.py', 'feature_normalizer.py', 'forward_intermediates.py', 'hf_model.py',
	'input_conditioner.py', 'open_clip_adaptor.py', 'preprocessor_config.json', 'radio_model.py',
	'siglip2_adaptor.py', 'utils.py', 'vit_patch_generator.py', 'vitdet.py',
].map(name => `vfms/cradio/C-RADIOv4-SO400M/${name}`));

function record(value: unknown, label: string): Record<string, unknown> {
	assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
	return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
	assert.ok(typeof value === 'string' && value.trim() !== '', `${label} must be nonempty text.`);
	return value;
}

function artifacts(value: unknown, paths: readonly string[]): readonly SourceArtifact[] {
	assert.ok(Array.isArray(value), 'Source artifact inventory is missing.');
	assert.deepEqual(value.map((item: unknown) => record(item, 'Artifact').localPath), paths,
		'The complete source inventory must retain its exact ordered paths.');
	return Object.freeze(value.map((item: unknown) => {
		const row = record(item, 'Artifact');
		const localPath = text(row.localPath, 'Source artifact path');
		assert.ok(!localPath.split('/').some((part) => part === '..' || part === '.' || part === ''), 'Source path must be relative.');
		assert.ok(Number.isSafeInteger(row.byteLength) && Number(row.byteLength) > 0, 'Source byte length must be positive.');
		const sha256 = text(row.sha256, 'Source digest');
		assert.match(sha256, SHA256, 'Every source object requires a SHA-256.');
		const url = new URL(text(row.url, 'Source URL'));
		assert.equal(url.protocol, 'https:');
		assert.equal(url.username + url.password + url.search + url.hash, '', 'Source URLs must be clean HTTPS.');
		if (url.hostname === 'huggingface.co') {
			assert.match(url.pathname, /\/resolve\/[a-f\d]{40}\//u, 'Hugging Face downloads require an immutable revision.');
		} else if (url.hostname === 'raw.githubusercontent.com') {
			assert.match(url.pathname, /\/[a-f\d]{40}\//u, 'GitHub downloads require an immutable revision.');
		} else {
			assert.equal(url.href, 'https://storage.googleapis.com/representations4d/checkpoints/pretrain_rvm_small16_256_204031069.npz',
				'Only the digest-pinned official RVM object has no source revision URL.');
		}
		return Object.freeze({ localPath, byteLength: Number(row.byteLength), sha256, url: url.href });
	}));
}

export function verifyCorridorKeyModelSourceCandidate(value: unknown) {
	const candidate = record(value, 'CorridorKey candidate');
	assert.equal(candidate.schemaVersion, 1);
	assert.equal(candidate.modelId, 'corridorkey-2.0');
	assert.equal(candidate.version, '2.0.0');
	assert.equal(candidate.productId, 'framescaper');
	assert.equal(candidate.status, 'source-pinned', 'This candidate is not a published model.');
	assert.equal(candidate.publicationReady, false, 'Source pins alone do not grant publication authority.');
	const licensing = record(candidate.licensing, 'CorridorKey licensing');
	assert.equal(licensing.codeLicense, 'CC-BY-NC-SA-4.0');
	assert.equal(licensing.weightsLicense, 'CC-BY-NC-SA-4.0');
	assert.equal(licensing.status, 'pending-grant-reference');
	assert.equal(licensing.integrationGrantReference, null);
	assert.match(text(licensing.publishedLicenseName, 'Published license'), /additional terms/u);
	assert.match(text(licensing.additionalTerms, 'Additional terms notice'), /redistribution/u);
	assert.ok(Array.isArray(licensing.foundationLicenses));
	assert.deepEqual(licensing.foundationLicenses, [
		{ id: 'cradio', codeLicense: 'NVIDIA Open Model License', weightsLicense: 'NVIDIA Open Model License' },
		{ id: 'moge', codeLicense: 'MIT AND Apache-2.0', weightsLicense: 'MIT' },
		{ id: 'rvm', codeLicense: 'Apache-2.0', weightsLicense: 'CC-BY-4.0' },
	]);
	const source = record(candidate.source, 'CorridorKey source');
	assert.equal(source.repository, 'https://github.com/nikopueringer/CorridorKey2.0');
	assert.match(text(source.revision, 'Code revision'), COMMIT);
	assert.equal(source.modelRepository, 'nikopueringer/CorridorKey2.0');
	assert.match(text(source.modelRevision, 'Weight revision'), COMMIT);
	assert.match(text(source.mogeRevision, 'MoGe revision'), COMMIT);
	const pinned = artifacts(source.artifacts, ARTIFACT_PATHS);
	for (const [index, name] of ['corridorkey_v2.safetensors', 'foundation_stats.safetensors'].entries()) {
		assert.equal(pinned[index]?.url,
			`https://huggingface.co/nikopueringer/CorridorKey2.0/resolve/${String(source.modelRevision)}/${name}`);
	}
	const notices = artifacts(source.notices, ['LICENSE', 'THIRD_PARTY_NOTICES.md']);
	for (const notice of notices) assert.equal(notice.url,
		`https://raw.githubusercontent.com/nikopueringer/CorridorKey2.0/${String(source.revision)}/${notice.localPath}`);
	const snapshot = record(source.cradioCodeSnapshot, 'C-RADIO code snapshot');
	assert.equal(snapshot.repository, 'nvidia/C-RADIOv4-SO400M');
	assert.match(text(snapshot.revision, 'C-RADIO revision'), COMMIT);
	assert.equal(snapshot.status, 'source-pinned');
	assert.ok(Array.isArray(snapshot.files) && snapshot.files.length > 0, 'C-RADIO executable source inventory is missing.');
	const codeArtifacts = artifacts(snapshot.files, C_RADIO_SOURCE_PATHS);
	for (const artifact of codeArtifacts) {
		assert.ok(artifact.localPath.startsWith('vfms/cradio/C-RADIOv4-SO400M/'), 'C-RADIO source path is foreign.');
		const name = artifact.localPath.slice('vfms/cradio/C-RADIOv4-SO400M/'.length);
		assert.equal(artifact.url, `https://huggingface.co/nvidia/C-RADIOv4-SO400M/resolve/${String(snapshot.revision)}/${name}`);
	}
	assert.equal(pinned[2]?.url,
		`https://huggingface.co/nvidia/C-RADIOv4-SO400M/resolve/${String(snapshot.revision)}/model.safetensors`);
	assert.equal(pinned[3]?.url,
		`https://huggingface.co/Ruicheng/moge-2-vitb-normal/resolve/${String(source.mogeRevision)}/model.pt`);
	assert.equal(pinned[4]?.url,
		'https://storage.googleapis.com/representations4d/checkpoints/pretrain_rvm_small16_256_204031069.npz');
	const conversion = record(candidate.conversion, 'CorridorKey conversion');
	assert.equal(conversion.status, 'pending');
	assert.equal(conversion.runtimeFormat, 'onnx');
	assert.equal(conversion.runtimeFamily, 'onnxruntime-node');
	assert.deepEqual(conversion.graphRoles, ['cradio', 'moge', 'rvm', 'stage1', 'stage2']);
	assert.deepEqual(conversion.outputs, [], 'Unverified graph exports must not become download identities.');
	assert.ok(Array.isArray(candidate.releaseBlockers) && candidate.releaseBlockers.length > 0);
	return Object.freeze({ modelId: 'corridorkey-2.0' as const,
		codeLicense: 'CC-BY-NC-SA-4.0' as const, weightsLicense: 'CC-BY-NC-SA-4.0' as const,
		licensingStatus: 'pending-grant-reference' as const, publicationReady: false as const,
		artifacts: pinned, notices, codeArtifacts,
		totalBytes: pinned.reduce((sum, artifact) => sum + artifact.byteLength, 0) });
}

/** Streams complete local objects; an upstream advertised digest is not a successful readback. */
export async function verifyCorridorKeySourceFiles(candidate: unknown, directory: string): Promise<void> {
	const reviewed = verifyCorridorKeyModelSourceCandidate(candidate);
	const root = await realpath(directory);
	const snapshotPrefix = 'vfms/cradio/C-RADIOv4-SO400M/';
	const expectedSnapshot = [...reviewed.artifacts, ...reviewed.codeArtifacts]
		.map(({ localPath }) => localPath).filter(path => path.startsWith(snapshotPrefix)).sort();
	assert.deepEqual((await snapshotFiles(root, snapshotPrefix)).sort(), expectedSnapshot,
		'C-RADIO source directory must contain the complete pinned inventory and no extra code.');
	for (const artifact of [...reviewed.artifacts, ...reviewed.notices, ...reviewed.codeArtifacts]) {
		const path = resolve(root, artifact.localPath);
		assert.ok(path.startsWith(`${root}${sep}`), 'Source artifact escaped its directory.');
		assert.equal(await realpath(path), path, `${artifact.localPath} source path must not traverse a symlink.`);
		const metadata = await lstat(path);
		assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), `${artifact.localPath} must be a regular file.`);
		assert.equal(metadata.size, artifact.byteLength, `${artifact.localPath} source byte length changed.`);
		const hash = createHash('sha256');
		for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
		assert.equal(hash.digest('hex'), artifact.sha256, `${artifact.localPath} source SHA-256 changed.`);
	}
}

async function snapshotFiles(root: string, prefix: string): Promise<string[]> {
	const path = resolve(root, prefix);
	assert.equal(await realpath(path), path, `${prefix} source path must not traverse a symlink.`);
	const result: string[] = [];
	for (const entry of await readdir(path, { withFileTypes: true })) {
		if (entry.name === '.cache' || entry.name === '__pycache__') continue;
		const relative = `${prefix}${entry.name}`;
		assert.ok(!entry.isSymbolicLink(), `${relative} must not be a symlink.`);
		if (entry.isDirectory()) result.push(...await snapshotFiles(root, `${relative}/`));
		else {
			assert.ok(entry.isFile(), `${relative} must be a regular file.`);
			result.push(relative);
		}
	}
	return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	assert.ok(process.argv.length === 2 || process.argv.length === 4 && process.argv[2] === '--source-directory',
		'Usage: node scripts/models/verify-corridorkey-model-source.ts [--source-directory <checkout>]');
	const candidate: unknown = JSON.parse(await readFile(new URL('../../config/framescaper-corridorkey-model-source-candidate.json', import.meta.url), 'utf8'));
	const reviewed = verifyCorridorKeyModelSourceCandidate(candidate);
	if (process.argv[3]) await verifyCorridorKeySourceFiles(candidate, process.argv[3]);
	process.stdout.write(`${JSON.stringify({ modelId: reviewed.modelId,
		sourceArtifacts: reviewed.artifacts.length, sourceCodeFiles: reviewed.codeArtifacts.length, totalSourceBytes: reviewed.totalBytes,
		localBytesVerified: Boolean(process.argv[3]), publicationReady: reviewed.publicationReady })}\n`);
}
