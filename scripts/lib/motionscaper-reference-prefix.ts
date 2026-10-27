/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { framescaperMediaHostBuildPaths } from '../../native/framescaper-media-host/build/media-build-commands.mjs';
import { verifyMotionscaperNativeBuildResult } from './motionscaper-native-build-result.ts';
import type { MotionNativeTarget } from './motionscaper-native-source.ts';
import { motionReferencePin, readMotionReferenceFile, readMotionReferenceSources, type MotionReferenceFilePin } from './motionscaper-reference-sources.ts';
import { requireMotionReferenceHost } from './motionscaper-reference-target.ts';

interface PrefixFile { readonly path: string; readonly byteLength: number; readonly sha256: string }
export interface MotionReferencePrefixRoot { readonly directory: string; readonly directories: readonly string[]; readonly files: readonly PrefixFile[] }
export interface MotionReferencePrefixAuthority {
	readonly schemaVersion: 1; readonly artifactKind: 'motionscaper-reference-prefix-authority';
	readonly target: MotionNativeTarget; readonly repositoryRoot: string; readonly sourceRevision: string;
	readonly nativeBuildReceiptSha256: string; readonly nativeHelperSha256: string;
	readonly nativeSourceManifestSha256: string; readonly dependencySourceSha256: string; readonly dependencyRecipeSha256: string;
	readonly nativeToolchainIdentity: string;
	readonly nativeWorkRoot: string; readonly prefix: string; readonly sourceFiles: readonly MotionReferenceFilePin[];
	readonly roots: readonly MotionReferencePrefixRoot[];
}
interface AuthorityInputs { readonly repositoryRoot: string; readonly target: MotionNativeTarget; readonly nativeResult: string; readonly nativeWorkRoot: string }
const MAXIMUM_FILES = 16_384, MAXIMUM_FILE_BYTES = 1024 ** 3, MAXIMUM_AUTHORITY_BYTES = 4 * 1024 ** 2;

/** Exact source-owned recipe outputs, including headers, static libraries and pkg-config metadata. */
export function motionReferenceInstallRoots(nativeWorkRoot: string): readonly string[] {
	const paths = framescaperMediaHostBuildPaths(join(nativeWorkRoot, 'media-build')) as Readonly<Record<string, string>>;
	return ['ffmpegInstall', 'x264Install', 'x265Install', 'libvpxInstall', 'libopusInstall', 'zlibInstall'].map(key => {
		const path = paths[key]; if (!path) throw new Error('Reference prefix recipe omitted an install root.'); return path;
	});
}

/** No subtree or file exclusions; every symlink and special file refuses the authority. */
export async function captureMotionReferencePrefixClosure(roots: readonly string[]): Promise<readonly MotionReferencePrefixRoot[]> {
	if (roots.length < 1 || roots.length > 6 || new Set(roots).size !== roots.length) throw new Error('Reference prefix roots are not closed.');
	const result: MotionReferencePrefixRoot[] = []; let count = 0, members = 0, totalBytes = 0;
	for (const directory of roots) {
		await canonicalDirectory(directory);
		const files: PrefixFile[] = [], directories: string[] = ['.'];
		const visit = async (path: string): Promise<void> => {
			const before = await lstat(path, { bigint: true });
			if (!before.isDirectory() || before.isSymbolicLink()) throw new Error('Reference prefix rejects symlink or nonregular directories.');
			for (const name of (await readdir(path)).sort()) {
				if (++members > 32_768) throw new Error('Reference prefix membership exceeds its admission.');
				const child = join(path, name), item = await lstat(child, { bigint: true });
				if (item.isSymbolicLink()) throw new Error('Reference prefix rejects symlinks.');
				const nameFromRoot = relative(directory, child).split(sep).join('/');
				if (item.isDirectory()) { directories.push(nameFromRoot); await visit(child); }
				else {
					if (!item.isFile() || item.size > BigInt(MAXIMUM_FILE_BYTES)) throw new Error('Reference prefix requires bounded regular files.');
					const digest = createHash('sha256');
					for await (const block of createReadStream(child)) digest.update(block as Buffer);
					const after = await lstat(child, { bigint: true });
					if (item.dev !== after.dev || item.ino !== after.ino || item.size !== after.size || item.mtimeNs !== after.mtimeNs || item.ctimeNs !== after.ctimeNs) throw new Error('Reference prefix file changed during capture.');
					files.push({ path: nameFromRoot, byteLength: Number(item.size), sha256: digest.digest('hex') });
					count++; totalBytes += Number(item.size);
					if (count > MAXIMUM_FILES || totalBytes > 8 * 1024 ** 3) throw new Error('Reference prefix closure exceeds its body admission.');
				}
			}
			const after = await lstat(path, { bigint: true });
			if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error('Reference prefix membership changed during capture.');
		};
		await visit(directory);
		if (!files.length) throw new Error('Reference prefix install root is empty.');
		result.push({ directory, directories: directories.sort(), files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) });
	}
	return result;
}

export function requireMotionReferencePrefixClosure(expected: readonly MotionReferencePrefixRoot[], actual: readonly MotionReferencePrefixRoot[]): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Reference prefix body or membership closure changed.');
}

async function expectedAuthority(options: AuthorityInputs): Promise<MotionReferencePrefixAuthority> {
	requireMotionReferenceHost(options.target);
	await canonicalDirectory(options.repositoryRoot); await canonicalDirectory(options.nativeWorkRoot);
	const source = await readMotionReferenceSources(options.repositoryRoot, options.target, true);
	const native = await verifyMotionscaperNativeBuildResult({ repositoryRoot: options.repositoryRoot, resultRoot: options.nativeResult, target: options.target });
	if (native.receipt.sourceRevision !== source.sourceRevision) throw new Error('Reference prefix native receipt differs from the current checkout.');
	const roots = motionReferenceInstallRoots(options.nativeWorkRoot);
	return { schemaVersion: 1, artifactKind: 'motionscaper-reference-prefix-authority', target: options.target,
		repositoryRoot: options.repositoryRoot, sourceRevision: source.sourceRevision,
		nativeBuildReceiptSha256: native.receiptSha256, nativeHelperSha256: native.receipt.payload.sha256,
		nativeSourceManifestSha256: native.receipt.sourceManifestSha256, dependencySourceSha256: native.receipt.dependencySourceSha256,
		dependencyRecipeSha256: native.receipt.dependencyRecipeSha256, nativeToolchainIdentity: native.receipt.toolchainIdentity,
		nativeWorkRoot: options.nativeWorkRoot, prefix: roots[0]!, sourceFiles: source.sourceFiles,
		roots: await captureMotionReferencePrefixClosure(roots) };
}

export async function createMotionReferencePrefixAuthority(options: AuthorityInputs & { readonly output: string }): Promise<MotionReferenceFilePin> {
	if (!isAbsolute(options.output) || resolve(options.output) !== options.output) throw new Error('Reference prefix output must be an absolute normalized path.');
	await canonicalDirectory(dirname(options.output));
	if (motionReferenceInstallRoots(options.nativeWorkRoot).some(root => options.output === root || options.output.startsWith(root + sep))) throw new Error('Reference authority output must stay outside its immutable prefix roots.');
	const authority = await expectedAuthority(options);
	const bytes = Buffer.from(`${JSON.stringify(authority, null, '\t')}\n`);
	if (bytes.length > MAXIMUM_AUTHORITY_BYTES) throw new Error('Reference authority exceeds its bounded JSON admission.');
	await writeFile(options.output, bytes, { flag: 'wx' });
	return motionReferencePin(options.output, bytes);
}

export async function verifyMotionReferencePrefixAuthority(options: Omit<AuthorityInputs, 'nativeWorkRoot'> & {
	readonly prefix: string; readonly authority: string; readonly expectedSha256: string;
}): Promise<Readonly<{ authority: MotionReferencePrefixAuthority; pin: MotionReferenceFilePin }>> {
	requireMotionReferenceHost(options.target);
	if (!/^[a-f\d]{64}$/u.test(options.expectedSha256)) throw new Error('An independent expected reference-prefix digest is required.');
	const bytes = await readMotionReferenceFile(options.authority, MAXIMUM_AUTHORITY_BYTES);
	const actualPin = motionReferencePin(options.authority, bytes);
	if (actualPin.sha256 !== options.expectedSha256) throw new Error('Reference prefix authority differs from its independent expected digest.');
	const input: unknown = JSON.parse(bytes.toString('utf8'));
	if (!input || typeof input !== 'object' || !('nativeWorkRoot' in input) || typeof input.nativeWorkRoot !== 'string') throw new Error('Reference prefix authority lacks its exact native recipe root.');
	if (!('target' in input) || input.target !== options.target || !('repositoryRoot' in input) || input.repositoryRoot !== options.repositoryRoot
		|| !('prefix' in input) || input.prefix !== options.prefix || motionReferenceInstallRoots(input.nativeWorkRoot)[0] !== options.prefix) throw new Error('Reference prefix authority target or recipe path differs.');
	const expected = await expectedAuthority({ ...options, nativeWorkRoot: input.nativeWorkRoot });
	if (expected.prefix !== options.prefix || JSON.stringify(input) !== JSON.stringify(expected)
		|| !bytes.equals(Buffer.from(`${JSON.stringify(expected, null, '\t')}\n`))) throw new Error('Reference prefix authority source, target, helper, recipe or complete closure differs.');
	return { authority: expected, pin: actualPin };
}

async function canonicalDirectory(path: string): Promise<void> {
	if (!isAbsolute(path) || resolve(path) !== path || /[\0\r\n;]/u.test(path)) throw new Error('Reference prefix path must be absolute and normalized.');
	const stat = await lstat(path);
	if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) throw new Error('Reference prefix directory is not canonical.');
}
