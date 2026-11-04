/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import candidates from '../config/assistance-runtime-family-supply-candidates.json' with { type: 'json' };
import { validateAssistanceRuntimeFamilyManifestV1,
	type AssistanceRuntimeFamilyFileV1 } from '../desktop/assistance-runtime-family-manifest.ts';
import {
	buildDesktopAssistanceEnginePart,
	stageDesktopAssistanceEnginePart,
	type DesktopAssistanceEngineFamily,
} from '../scripts/lib/desktop-assistance-engine-parts.ts';
import { stageDesktopAssistanceRuntimeFamilies } from '../scripts/lib/desktop-assistance-runtime-families.mjs';

const sourceRevision = 'a'.repeat(40);
const targetId = 'win-arm64';

async function fixture(context: { after: (cleanup: () => Promise<void>) => void }) {
	const root = await mkdtemp(join(tmpdir(), 'assistance-engine-parts-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const partsRoot = join(root, 'parts');
	const runtimeRoot = join(root, 'runtime');
	async function payload(familyId: DesktopAssistanceEngineFamily | 'onnxruntime-node', outputRoot: string) {
		const manifest = validateAssistanceRuntimeFamilyManifestV1(candidates.manifests[familyId]);
		const entrypoint = familyId === 'whisper-cpp' ? 'whisper-cli.exe'
			: familyId === 'llama-cpp' ? 'llama-completion.exe' : 'index.js';
		const paths = familyId === 'onnxruntime-node' ? [entrypoint]
			: [entrypoint, `gpu/${entrypoint}`, 'LICENSE', 'build-provenance.json', 'VULKAN_NOTICES.txt'];
		const files: AssistanceRuntimeFamilyFileV1[] = [];
		for (const path of paths) {
			const bytes = Buffer.from(`${familyId} ${path} fixture`);
			const destination = join(outputRoot, manifest.runtimePrefix, targetId, path);
			await mkdir(dirname(destination), { recursive: true });
			await writeFile(destination, bytes);
			files.push({ path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
				executable: path.endsWith('.exe') });
		}
		return { manifest: { ...manifest, targets: manifest.targets.map(target => target.id !== targetId ? target : {
			id: targetId, status: 'authenticated', entrypoint, files,
			...(familyId === 'onnxruntime-node' ? {} : {
				executionProviders: ['vulkan', 'cpu'], accelerationEntrypoints: { vulkan: `gpu/${entrypoint}` },
			}),
		}) }, summary: { familyId, compiler: 'fixture', notices: 'retained' } };
	}
	async function build(familyId: DesktopAssistanceEngineFamily) {
		return buildDesktopAssistanceEnginePart({ familyId, targetId, sourceRevision,
			partRoot: join(partsRoot, familyId), cacheRoot: join(root, 'cache') }, {
			build: options => payload(familyId, options.runtimeRoot),
		});
	}
	return { root, partsRoot, runtimeRoot, payload, build,
		stage: (familyId: DesktopAssistanceEngineFamily, revision = sourceRevision) =>
			stageDesktopAssistanceEnginePart({ familyId, targetId, sourceRevision: revision, partsRoot, runtimeRoot }) };
}

test('independent Windows ARM engines retain CPU, Vulkan, notices and provenance through assembly', async context => {
	const f = await fixture(context);
	await Promise.all([f.build('whisper-cpp'), f.build('llama-cpp')]);
	const result = await stageDesktopAssistanceRuntimeFamilies({
		targetId, runtimeRoot: f.runtimeRoot, enginePartsRoot: f.partsRoot, sourceRevision,
		stageOnnx: () => f.payload('onnxruntime-node', f.runtimeRoot),
		stageWhisper: async () => { throw new Error('Whisper must not be rebuilt'); },
		stageLlama: async () => { throw new Error('llama must not be rebuilt'); },
	});
	const packaged = JSON.parse(result.manifestBytes.toString()) as { manifests: Record<string, unknown> };
	for (const familyId of ['whisper-cpp', 'llama-cpp'] as const) {
		const manifest = validateAssistanceRuntimeFamilyManifestV1(packaged.manifests[familyId]);
		const target = manifest.targets.find(target => target.id === targetId);
		assert.equal(target?.status, 'authenticated');
		if (target?.status !== 'authenticated') throw new Error('Expected an authenticated engine');
		assert.deepEqual(target.executionProviders, ['vulkan', 'cpu']);
		assert.equal(target.accelerationEntrypoints?.vulkan, `gpu/${target.entrypoint}`);
		for (const file of target.files) {
			const bytes = await readFile(join(f.runtimeRoot, manifest.runtimePrefix, targetId, file.path));
			assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
		}
		const summary = result.summary.families.find((entry: { familyId: string }) => entry.familyId === familyId);
		assert.deepEqual(summary?.provenance, { familyId, compiler: 'fixture', notices: 'retained' });
	}
});

test('engine assembly rejects stale revisions, wrong identities and CPU-only parts', async context => {
	const f = await fixture(context);
	await f.build('whisper-cpp');
	await assert.rejects(f.stage('whisper-cpp', 'b'.repeat(40)), /identity/u);
	const receiptPath = join(f.partsRoot, 'whisper-cpp', 'result.json');
	const original = await readFile(receiptPath, 'utf8');
	for (const changed of [{ targetId: 'win-x64' }, { familyId: 'llama-cpp' }, { schemaVersion: 2 }]) {
		await writeFile(receiptPath, JSON.stringify({ ...JSON.parse(original), ...changed }));
		await assert.rejects(f.stage('whisper-cpp'), /identity/u);
	}
	const receipt = JSON.parse(original) as { result: { manifest: { targets: Record<string, unknown>[] } } };
	const selected = receipt.result.manifest.targets.find(target => target.id === targetId);
	assert.ok(selected);
	selected.executionProviders = ['cpu'];
	delete selected.accelerationEntrypoints;
	await writeFile(receiptPath, JSON.stringify(receipt));
	await assert.rejects(f.stage('whisper-cpp'), /Vulkan/u);
});

test('engine assembly authenticates exact payloads before accepting an artifact', async context => {
	for (const damage of ['changed', 'extra', 'missing', 'symlink'] as const) {
		const f = await fixture(context);
		await f.build('whisper-cpp');
		const binary = join(f.partsRoot, 'whisper-cpp/runtime/assistance/whisper-cpp/v1.9.3/win-arm64/gpu/whisper-cli.exe');
		if (damage === 'changed') await writeFile(binary, 'changed');
		if (damage === 'extra') await writeFile(join(dirname(binary), 'unlisted'), 'extra');
		if (damage === 'missing' || damage === 'symlink') await rm(binary);
		if (damage === 'symlink') await symlink(join(dirname(dirname(binary)), 'whisper-cli.exe'), binary);
		await assert.rejects(f.stage('whisper-cpp'), /authentication/u);
	}
});

test('an explicitly selected engine handoff never falls back to rebuilding a missing part', async context => {
	const f = await fixture(context);
	await f.build('whisper-cpp');
	await assert.rejects(stageDesktopAssistanceRuntimeFamilies({
		targetId, runtimeRoot: f.runtimeRoot, enginePartsRoot: f.partsRoot, sourceRevision,
		stageOnnx: () => f.payload('onnxruntime-node', f.runtimeRoot),
		stageLlama: async () => { throw new Error('must not rebuild missing llama'); },
	}), /ENOENT/u);
});
