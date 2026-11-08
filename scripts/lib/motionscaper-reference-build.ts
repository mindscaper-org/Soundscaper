/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFile } from 'node:child_process';
import { lstat, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { createFramescaperMediaHostToolchainReceipt, writeFramescaperMediaHostToolchainReceipt } from './framescaper-media-host-toolchain.mjs';
import type { MotionNativeTarget } from './motionscaper-native-source.ts';
import { assertSoundscaperNativeBinaryArchitecture } from './soundscaper-native-binary-architecture.mjs';
import { hashMotionReferenceAudit, validateMotionReferenceBuildAudit, type MotionReferenceBuildAudit, type MotionReferenceCompileEvidence } from './motionscaper-reference-build-audit.ts';
import { createMotionReferenceCompileEnvironment, createMotionReferenceCompilePlan } from './motionscaper-reference-build-plan.ts';
import { readMotionReferenceToolchainAudit, type MotionReferenceNativeToolchain } from './motionscaper-reference-build-toolchain.ts';
import { motionReferenceInstallRoots, verifyMotionReferencePrefixAuthority } from './motionscaper-reference-prefix.ts';
import { motionReferencePin, readMotionReferenceFile, readMotionReferenceSources } from './motionscaper-reference-sources.ts';
import { motionReferenceDecoderName, requireMotionReferenceHost } from './motionscaper-reference-target.ts';

export interface MotionReferenceAuditedBuildOptions {
	readonly repositoryRoot: string; readonly target: MotionNativeTarget; readonly directory: string;
	readonly prefix: string; readonly nativeResult: string; readonly prefixAuthority: string; readonly prefixAuthoritySha256: string;
}

/** Actual target-native CMake/Clang/MSVC compilation of the separate decoder, never a production helper invocation. */
export async function buildAuditedMotionReferenceDecoder(options: MotionReferenceAuditedBuildOptions): Promise<Readonly<{ executable: string; build: MotionReferenceBuildAudit }>> {
	requireMotionReferenceHost(options.target);
	if (!isAbsolute(options.directory) || resolve(options.directory) !== options.directory
		|| await realpath(options.directory) !== options.directory || !(await lstat(options.directory)).isDirectory()) throw new Error('Reference compiler directory must be canonical.');
	for (const name of ['reference-build', 'reference-toolchain.json', 'reference-build-audit.json', motionReferenceDecoderName(options.target)]) {
		try { await lstat(join(options.directory, name)); } catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
			throw error;
		}
		throw new Error('Reference compiler output already exists.');
	}
	const authorityOptions = { repositoryRoot: options.repositoryRoot, target: options.target, nativeResult: options.nativeResult,
		prefix: options.prefix, authority: options.prefixAuthority, expectedSha256: options.prefixAuthoritySha256 };
	const approved = await verifyMotionReferencePrefixAuthority(authorityOptions);
	const toolchain = writeFramescaperMediaHostToolchainReceipt({ targetId: options.target,
		path: join(options.directory, 'reference-toolchain.json') }) as unknown as { readonly path: string; readonly receipt: MotionReferenceNativeToolchain };
	if (toolchain.receipt.identitySha256 !== approved.authority.nativeToolchainIdentity) throw new Error('Reference compiler toolchain differs from the standard native build.');
	const toolBytes = await readMotionReferenceFile(toolchain.path, 64 * 1024);
	const encodedTools = deflateSync(toolBytes).toString('base64');
	const parsedTools = readMotionReferenceToolchainAudit(encodedTools, options.target, approved.authority.nativeToolchainIdentity);
	const installRoots = motionReferenceInstallRoots(approved.authority.nativeWorkRoot);
	const plan = createMotionReferenceCompilePlan({ target: options.target, repositoryRoot: options.repositoryRoot,
		directory: options.directory, installRoots, tools: parsedTools.tools });
	const environment = createMotionReferenceCompileEnvironment(parsedTools.receipt.environment, installRoots, options.target);
	const execute = promisify(execFile), commands: MotionReferenceCompileEvidence[] = [];
	const started = performance.now();
	for (const command of plan.commands) {
		const remaining = Math.floor(plan.compileBudgetMs - (performance.now() - started));
		if (remaining <= 0) throw new Error('Reference compiler exceeded its one original compile budget.');
		const result = await execute(command.executable, [...command.args], { cwd: command.cwd, env: environment,
			timeout: remaining, maxBuffer: 65_536, windowsHide: true, shell: false });
		commands.push({ ...command, naturalExitCode: 0, stdoutSha256: hashMotionReferenceAudit(result.stdout), stderrSha256: hashMotionReferenceAudit(result.stderr) });
	}
	const elapsed = performance.now() - started;
	const postAuthority = await verifyMotionReferencePrefixAuthority(authorityOptions);
	if (JSON.stringify(postAuthority) !== JSON.stringify(approved)) throw new Error('Reference prefix/source authority changed during compilation.');
	const postTools = createFramescaperMediaHostToolchainReceipt({ targetId: options.target }) as unknown as MotionReferenceNativeToolchain;
	if (postTools.identitySha256 !== toolchain.receipt.identitySha256) throw new Error('Reference compiler tools or environment changed during compilation.');
	const source = await readMotionReferenceSources(options.repositoryRoot, options.target, true);
	if (source.sourceRevision !== approved.authority.sourceRevision || JSON.stringify(source.sourceFiles) !== JSON.stringify(approved.authority.sourceFiles)) throw new Error('Reference compiler source changed during compilation.');
	const binary = await readMotionReferenceFile(plan.decoder, 64 * 1024 ** 2);
	assertSoundscaperNativeBinaryArchitecture(binary, options.target);
	const decoder = motionReferencePin(motionReferenceDecoderName(options.target), binary);
	const build: MotionReferenceBuildAudit = { schemaVersion: 1, target: options.target, sourceRevision: source.sourceRevision,
		repositoryRoot: options.repositoryRoot, directory: options.directory, sourceFiles: source.sourceFiles,
		prefixAuthority: { ...approved.pin, nativeWorkRoot: approved.authority.nativeWorkRoot, prefix: approved.authority.prefix,
			nativeBuildReceiptSha256: approved.authority.nativeBuildReceiptSha256, nativeHelperSha256: approved.authority.nativeHelperSha256,
			nativeSourceManifestSha256: approved.authority.nativeSourceManifestSha256, dependencyRecipeSha256: approved.authority.dependencyRecipeSha256 },
		toolchain: { identitySha256: toolchain.receipt.identitySha256, receiptSha256: hashMotionReferenceAudit(toolBytes),
			environmentSha256: hashMotionReferenceAudit(JSON.stringify(environment)), receiptDeflateBase64: encodedTools },
		compileBudgetMs: plan.compileBudgetMs, compileElapsedMs: elapsed, commands, decoder };
	validateMotionReferenceBuildAudit(build, { target: options.target, sourceRevision: source.sourceRevision, sourceFiles: source.sourceFiles,
		nativeBuildReceiptSha256: approved.authority.nativeBuildReceiptSha256, nativeHelperSha256: approved.authority.nativeHelperSha256,
		nativeSourceManifestSha256: approved.authority.nativeSourceManifestSha256, dependencyRecipeSha256: approved.authority.dependencyRecipeSha256,
		nativeToolchainIdentity: approved.authority.nativeToolchainIdentity, decoder });
	await writeFile(join(options.directory, 'reference-build-audit.json'), `${JSON.stringify(build, null, '\t')}\n`, { flag: 'wx' });
	return { executable: plan.decoder, build };
}
