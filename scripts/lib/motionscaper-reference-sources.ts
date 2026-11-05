/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MOTION_NATIVE_TARGETS, type MotionNativeTarget } from './motionscaper-native-source.ts';

export interface MotionReferenceFilePin { readonly path: string; readonly byteLength: number; readonly sha256: string }
const LEGACY_SOURCES = ['scripts/lib/motionscaper-native-reference.cpp', 'desktop/motionscaper-native-reference.ts'] as const;

export function motionReferenceSourcePaths(target: MotionNativeTarget, audited: boolean): readonly string[] {
	if (!MOTION_NATIVE_TARGETS.includes(target)) throw new Error('Reference decoder target is unsupported.');
	if (!audited) {
		if (!target.startsWith('linux-')) throw new Error('A legacy reference receipt is Linux-only.');
		return LEGACY_SOURCES;
	}
	return [...LEGACY_SOURCES,
		'scripts/motionscaper-reference-artifact-build.ts', 'scripts/motionscaper-reference-prefix-authority.ts',
		'scripts/lib/motionscaper-reference-artifact.ts', 'scripts/lib/motionscaper-reference-target.ts',
		'scripts/lib/motionscaper-reference-sources.ts', 'scripts/lib/motionscaper-reference-prefix.ts',
		'scripts/lib/motionscaper-reference-build.ts', 'scripts/lib/motionscaper-reference-build-plan.ts',
		'scripts/lib/motionscaper-reference-build-audit.ts', 'scripts/lib/motionscaper-reference-native/CMakeLists.txt',
		'scripts/lib/motionscaper-reference-build-toolchain.ts',
		'scripts/lib/framescaper-media-host-toolchain.mjs',
		'native/motionscaper-media-host/src/windows.manifest',
		`native/framescaper-media-host/build/toolchains/${target}.cmake`,
	];
}

export async function readMotionReferenceSources(root: string, target: MotionNativeTarget, audited: boolean) {
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, maxBuffer: 1024 * 1024 });
	const sourceRevision = git('rev-parse', '--verify', 'HEAD^{commit}').toString('utf8').trim();
	if (!/^[a-f\d]{40}$/u.test(sourceRevision)) throw new Error('Reference source revision is invalid.');
	if (audited && git('status', '--porcelain=v1', '--untracked-files=normal').toString('utf8').trim()) throw new Error('Audited reference source must be clean and committed.');
	const sourceFiles: MotionReferenceFilePin[] = [];
	for (const path of motionReferenceSourcePaths(target, audited)) {
		const bytes = await readMotionReferenceFile(join(root, path), 1024 * 1024);
		if (!git('show', `${sourceRevision}:${path}`).equals(bytes)) throw new Error('Reference source differs from its committed revision.');
		sourceFiles.push(motionReferencePin(path, bytes));
	}
	return { sourceRevision, sourceFiles };
}

export function motionReferencePin(path: string, bytes: Uint8Array): MotionReferenceFilePin {
	return { path, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function readMotionReferenceFile(path: string, maximum: number): Promise<Buffer> {
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximum) throw new Error('Motion reference file exceeds regular bounded admission.');
	const bytes = await readFile(path), after = await lstat(path);
	if (bytes.length !== before.size || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
		|| before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Motion reference file changed while reading.');
	return bytes;
}
