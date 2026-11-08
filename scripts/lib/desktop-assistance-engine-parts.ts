/* SPDX-License-Identifier: AGPL-3.0-only */

/** Same-run, source-bound transfers from independent Windows ARM engine builders. */

import { chmod, copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

import {
	describeAssistanceRuntimeFamilyAvailability,
	validateAssistanceRuntimeFamilyManifestV1,
	type AssistanceRuntimeFamilyManifestV1,
} from '../../desktop/assistance-runtime-family-manifest.ts';
import { stageDesktopWhisperCppRuntime } from './desktop-assistance-whisper-runtime.mjs';
import { stageDesktopLlamaCppRuntime } from './desktop-assistance-llama-runtime.mjs';

export type DesktopAssistanceEngineFamily = 'whisper-cpp' | 'llama-cpp';
interface Identity {
	readonly familyId: string;
	readonly targetId: string;
	readonly sourceRevision: string | undefined;
}
interface EngineResult { readonly manifest: unknown; readonly summary?: unknown }
interface BuildOptions { readonly targetId: string; readonly runtimeRoot: string; readonly cacheRoot: string }

function assertIdentity(identity: Identity): asserts identity is Identity & { familyId: DesktopAssistanceEngineFamily } {
	if (!['whisper-cpp', 'llama-cpp'].includes(identity.familyId) || identity.targetId !== 'win-arm64'
		|| !/^[a-f\d]{40}(?:[a-f\d]{24})?$/u.test(identity.sourceRevision ?? '')) {
		throw new Error('Windows ARM engine part identity is invalid.');
	}
}

function absoluteDirectory(path: string): void {
	if (!isAbsolute(path)) throw new TypeError('Engine part directories must be absolute.');
}

async function authenticate(result: EngineResult, identity: Identity, runtimeRoot: string) {
	const manifest = validateAssistanceRuntimeFamilyManifestV1(result.manifest);
	if (manifest.familyId !== identity.familyId) throw new Error('Engine part manifest identity differs.');
	const target = manifest.targets.find(target => target.id === identity.targetId);
	if (target?.status !== 'authenticated' || !target.executionProviders?.includes('vulkan')
		|| !target.executionProviders.includes('cpu') || !target.accelerationEntrypoints?.vulkan) {
		throw new Error('Windows ARM engine parts require authenticated CPU and Vulkan executables.');
	}
	const availability = await describeAssistanceRuntimeFamilyAvailability({
		familyId: manifest.familyId, manifest, runtimeRoot, platform: 'win32', architecture: 'arm64',
		totalMemoryBytes: Number.MAX_SAFE_INTEGER,
	});
	if (availability.status !== 'available') {
		throw new Error(`Engine part failed authentication: ${availability.detail}`);
	}
	return { manifest, target, descriptor: availability.descriptor };
}

export async function buildDesktopAssistanceEnginePart(
	options: Identity & { readonly partRoot: string; readonly cacheRoot: string },
	{ build }: { build?: (options: BuildOptions) => Promise<EngineResult> } = {},
): Promise<void> {
	assertIdentity(options);
	absoluteDirectory(options.partRoot);
	absoluteDirectory(options.cacheRoot);
	await mkdir(options.partRoot, { recursive: true });
	if ((await readdir(options.partRoot)).length !== 0) throw new Error('Engine part destination must be empty.');
	const runtimeRoot = join(options.partRoot, 'runtime');
	const builder = build ?? (options.familyId === 'whisper-cpp'
		? stageDesktopWhisperCppRuntime : stageDesktopLlamaCppRuntime);
	const result = await builder({ targetId: options.targetId, runtimeRoot, cacheRoot: options.cacheRoot });
	const { manifest } = await authenticate(result, options, runtimeRoot);
	await writeFile(join(options.partRoot, 'result.json'), `${JSON.stringify({
		schemaVersion: 1, sourceRevision: options.sourceRevision, targetId: options.targetId, familyId: options.familyId,
		result: { ...result, manifest },
	}, null, '\t')}\n`, { flag: 'wx' });
}

export async function stageDesktopAssistanceEnginePart(
	options: Identity & { readonly partsRoot: string; readonly runtimeRoot: string },
): Promise<{ manifest: AssistanceRuntimeFamilyManifestV1; summary?: unknown }> {
	assertIdentity(options);
	absoluteDirectory(options.partsRoot);
	absoluteDirectory(options.runtimeRoot);
	const partRoot = join(options.partsRoot, options.familyId);
	const receiptPath = join(partRoot, 'result.json');
	const info = await lstat(receiptPath);
	if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 8 * 1024 ** 2) {
		throw new Error('Engine part receipt must be a regular bounded file.');
	}
	const receipt: unknown = JSON.parse(await readFile(receiptPath, 'utf8'));
	if (!receipt || typeof receipt !== 'object' || !('schemaVersion' in receipt) || receipt.schemaVersion !== 1
		|| !('sourceRevision' in receipt) || receipt.sourceRevision !== options.sourceRevision
		|| !('targetId' in receipt) || receipt.targetId !== options.targetId
		|| !('familyId' in receipt) || receipt.familyId !== options.familyId
		|| !('result' in receipt) || !receipt.result || typeof receipt.result !== 'object'
		|| !('manifest' in receipt.result)) {
		throw new Error('Engine part receipt identity differs from this build.');
	}
	const result = receipt.result;
	const { manifest, descriptor } = await authenticate(result, options, join(partRoot, 'runtime'));
	const destination = join(options.runtimeRoot, manifest.runtimePrefix, options.targetId);
	await mkdir(destination, { recursive: true });
	if ((await readdir(destination)).length !== 0) throw new Error('Engine assembly destination must be empty.');
	for (const file of descriptor.files) {
		const output = join(destination, file.relativePath);
		await mkdir(dirname(output), { recursive: true });
		await copyFile(file.path, output);
		await chmod(output, file.executable ? 0o755 : 0o644);
	}
	await authenticate({ manifest }, options, options.runtimeRoot);
	return { manifest, ...('summary' in result ? { summary: result.summary } : {}) };
}
