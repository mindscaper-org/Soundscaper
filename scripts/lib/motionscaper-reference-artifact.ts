/* SPDX-License-Identifier: AGPL-3.0-only */
import { chmod, copyFile, lstat, mkdir, readdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { verifyMotionscaperNativeBuildResult } from './motionscaper-native-build-result.ts';
import type { MotionNativeTarget } from './motionscaper-native-source.ts';
import { assertSoundscaperNativeBinaryArchitecture } from './soundscaper-native-binary-architecture.mjs';
import { validateMotionReferenceBuildAudit, type MotionReferenceBuildAudit } from './motionscaper-reference-build-audit.ts';
import { motionReferencePin, readMotionReferenceFile, readMotionReferenceSources } from './motionscaper-reference-sources.ts';
import { motionReferenceDecoderName, requireMotionReferenceHost } from './motionscaper-reference-target.ts';

const NOTICES = 'THIRD_PARTY_NOTICES.md', RECEIPT = 'reference-receipt.json';
interface Options { readonly repositoryRoot: string; readonly nativeResult: string; readonly target: MotionNativeTarget }

/** A closed expected record is assembled from independently verified source/helper and actual files. */
export function validateMotionReferenceReceipt(value: unknown, expected: Readonly<Record<string, unknown>>): void {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Reflect.get(value, 'schemaVersion') === 1 && !String(Reflect.get(value, 'target')).startsWith('linux-'))
		|| JSON.stringify(value) !== JSON.stringify(expected)) throw new Error('Motion reference receipt differs from its exact source, helper or file closure.');
}

export async function createMotionReferenceArtifact(options: Options & { readonly decoder: string; readonly output: string; readonly build?: MotionReferenceBuildAudit }): Promise<void> {
	requireMotionReferenceHost(options.target);
	if (!options.build && !options.target.startsWith('linux-')) throw new Error('Non-Linux reference artifacts require an audited native compiler build.');
	const decoderName = motionReferenceDecoderName(options.target);
	await mkdir(options.output, { recursive: false });
	await copyFile(options.decoder, join(options.output, decoderName), 1);
	const native = await verifyMotionscaperNativeBuildResult({ repositoryRoot: options.repositoryRoot, resultRoot: options.nativeResult, target: options.target });
	await copyFile(join(native.resultRoot, native.receipt.notices.path), join(options.output, NOTICES), 1);
	const receipt = await expectedReceipt(options, options.output, options.build);
	const bytes = Buffer.from(`${JSON.stringify(receipt, null, '\t')}\n`);
	if (bytes.length > 16384) throw new Error('Motion reference receipt exceeds its bounded JSON admission.');
	await writeFile(join(options.output, RECEIPT), bytes, { flag: 'wx' });
	await verifyMotionReferenceArtifact({ ...options, artifact: options.output });
}

export async function verifyMotionReferenceArtifact(options: Options & { readonly artifact: string }): Promise<string> {
	requireMotionReferenceHost(options.target);
	const decoderName = motionReferenceDecoderName(options.target);
	const root = resolve(options.artifact), stat = await lstat(root);
	if (!isAbsolute(options.artifact) || options.artifact !== root || !stat.isDirectory() || stat.isSymbolicLink() || await realpath(root) !== root) throw new Error('Motion reference artifact path must be a canonical directory.');
	if (JSON.stringify((await readdir(root)).sort()) !== JSON.stringify([decoderName, NOTICES, RECEIPT].sort())) throw new Error('Motion reference artifact inventory differs.');
	const bytes = await readMotionReferenceFile(join(root, RECEIPT), 16384);
	const receipt: unknown = JSON.parse(bytes.toString('utf8'));
	if (!receipt || typeof receipt !== 'object' || ![1, 2].includes(Number(Reflect.get(receipt, 'schemaVersion')))) throw new Error('Motion reference receipt schema is unsupported.');
	const audited = Reflect.get(receipt, 'schemaVersion') === 2;
	if ((!audited && !options.target.startsWith('linux-')) || (audited && !Reflect.get(receipt, 'build'))) throw new Error('Motion reference receipt lacks a native compiler audit.');
	const expected = await expectedReceipt(options, root, audited ? Reflect.get(receipt, 'build') as unknown : undefined);
	validateMotionReferenceReceipt(receipt, expected);
	if (!bytes.equals(Buffer.from(`${JSON.stringify(receipt, null, '\t')}\n`))) throw new Error('Motion reference receipt is not canonical JSON.');
	// Artifact transport does not preserve executable bits. Grant execution only after verification.
	await chmod(join(root, decoderName), 0o755); return join(root, decoderName);
}

async function expectedReceipt(options: Options, directory: string, inputBuild?: unknown): Promise<Readonly<Record<string, unknown>>> {
	requireMotionReferenceHost(options.target);
	const native = await verifyMotionscaperNativeBuildResult({ repositoryRoot: options.repositoryRoot, resultRoot: options.nativeResult, target: options.target });
	const audited = inputBuild !== undefined;
	const { sourceRevision, sourceFiles } = await readMotionReferenceSources(options.repositoryRoot, options.target, audited);
	const decoderName = motionReferenceDecoderName(options.target);
	const decoder = await readMotionReferenceFile(join(directory, decoderName), 64 * 1024 * 1024); assertSoundscaperNativeBinaryArchitecture(decoder, options.target);
	const decoderPin = motionReferencePin(decoderName, decoder);
	const notices = await readMotionReferenceFile(join(directory, NOTICES), 2 * 1024 * 1024);
	if (!notices.equals(await readMotionReferenceFile(join(native.resultRoot, native.receipt.notices.path), 2 * 1024 * 1024))) throw new Error('Reference notices differ from the pinned static codec closure.');
	let build: MotionReferenceBuildAudit | undefined;
	if (audited) {
		if (native.receipt.sourceRevision !== sourceRevision) throw new Error('Reference compiler and native helper require the same current source revision.');
		build = validateMotionReferenceBuildAudit(inputBuild, { target: options.target, sourceRevision, sourceFiles, decoder: decoderPin,
			nativeBuildReceiptSha256: native.receiptSha256, nativeHelperSha256: native.receipt.payload.sha256,
			nativeSourceManifestSha256: native.receipt.sourceManifestSha256, dependencyRecipeSha256: native.receipt.dependencyRecipeSha256,
			nativeToolchainIdentity: native.receipt.toolchainIdentity });
	}
	return { schemaVersion: audited ? 2 : 1, artifactKind: 'motionscaper-reference-decoder', target: options.target, sourceRevision,
		nativeBuildReceiptSha256: native.receiptSha256, nativeHelperSha256: native.receipt.payload.sha256, nativeSourceManifestSha256: native.receipt.sourceManifestSha256,
		sourceFiles, decoder: decoderPin, notices: motionReferencePin(NOTICES, notices), ...(build ? { build } : {}) };
}
