/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import type { MotionNativeTarget } from './motionscaper-native-source.ts';
import { createMotionReferenceCompileEnvironment, createMotionReferenceCompilePlan, type MotionReferenceCompileCommand } from './motionscaper-reference-build-plan.ts';
import { motionReferenceInstallRoots } from './motionscaper-reference-prefix.ts';
import type { MotionReferenceFilePin } from './motionscaper-reference-sources.ts';
import { readMotionReferenceToolchainAudit } from './motionscaper-reference-build-toolchain.ts';

export interface MotionReferenceCompileEvidence extends MotionReferenceCompileCommand {
	readonly naturalExitCode: 0; readonly stdoutSha256: string; readonly stderrSha256: string;
}
export interface MotionReferenceBuildAudit {
	readonly schemaVersion: 1; readonly target: MotionNativeTarget; readonly sourceRevision: string;
	readonly repositoryRoot: string; readonly directory: string; readonly sourceFiles: readonly MotionReferenceFilePin[];
	readonly prefixAuthority: MotionReferenceFilePin & {
		readonly nativeWorkRoot: string; readonly prefix: string; readonly nativeBuildReceiptSha256: string;
		readonly nativeHelperSha256: string; readonly nativeSourceManifestSha256: string; readonly dependencyRecipeSha256: string;
	};
	readonly toolchain: { readonly identitySha256: string; readonly receiptSha256: string; readonly environmentSha256: string; readonly receiptDeflateBase64: string };
	readonly compileBudgetMs: 60_000; readonly compileElapsedMs: number; readonly commands: readonly MotionReferenceCompileEvidence[];
	readonly decoder: MotionReferenceFilePin;
}
export interface MotionReferenceAuditExpected {
	readonly target: MotionNativeTarget; readonly sourceRevision: string; readonly sourceFiles: readonly MotionReferenceFilePin[];
	readonly nativeBuildReceiptSha256: string; readonly nativeHelperSha256: string;
	readonly nativeSourceManifestSha256: string; readonly dependencyRecipeSha256: string; readonly decoder: MotionReferenceFilePin;
	readonly nativeToolchainIdentity: string;
}

/** The compiler audit is producer evidence. Consumers rebind its exact source/helper/binary and closed argv. */
export function validateMotionReferenceBuildAudit(input: unknown, expected: MotionReferenceAuditExpected): MotionReferenceBuildAudit {
	const value = record(input, ['schemaVersion', 'target', 'sourceRevision', 'repositoryRoot', 'directory', 'sourceFiles', 'prefixAuthority', 'toolchain', 'compileBudgetMs', 'compileElapsedMs', 'commands', 'decoder']);
	if (value.schemaVersion !== 1 || value.target !== expected.target || value.sourceRevision !== expected.sourceRevision
		|| JSON.stringify(value.sourceFiles) !== JSON.stringify(expected.sourceFiles) || JSON.stringify(value.decoder) !== JSON.stringify(expected.decoder)
		|| value.compileBudgetMs !== 60_000 || typeof value.compileElapsedMs !== 'number' || !Number.isFinite(value.compileElapsedMs)
		|| value.compileElapsedMs < 0 || value.compileElapsedMs > 60_000) throw new Error('Reference compiler audit source, target, binary or deadline differs.');
	const path = expected.target.startsWith('win-') ? win32 : posix;
	const absolute = (input: unknown): string => {
		if (typeof input !== 'string' || !path.isAbsolute(input) || path.resolve(input) !== input || /[\0\r\n;]/u.test(input)) throw new Error('Reference compiler audit path is invalid.');
		return input;
	};
	const root = absolute(value.repositoryRoot), directory = absolute(value.directory);
	const prefix = record(value.prefixAuthority, ['path', 'byteLength', 'sha256', 'nativeWorkRoot', 'prefix', 'nativeBuildReceiptSha256', 'nativeHelperSha256', 'nativeSourceManifestSha256', 'dependencyRecipeSha256']);
	absolute(prefix.path); digest(prefix.sha256);
	if (typeof prefix.byteLength !== 'number' || !Number.isSafeInteger(prefix.byteLength) || prefix.byteLength < 1 || prefix.byteLength > 4 * 1024 ** 2
		|| prefix.nativeBuildReceiptSha256 !== expected.nativeBuildReceiptSha256 || prefix.nativeHelperSha256 !== expected.nativeHelperSha256
		|| prefix.nativeSourceManifestSha256 !== expected.nativeSourceManifestSha256 || prefix.dependencyRecipeSha256 !== expected.dependencyRecipeSha256) throw new Error('Reference compiler prefix authority differs from its native build.');
	const nativeWorkRoot = absolute(prefix.nativeWorkRoot), installRoots = motionReferenceInstallRoots(nativeWorkRoot);
	if (prefix.prefix !== installRoots[0]) throw new Error('Reference compiler prefix escaped the standard native recipe.');
	const toolchain = record(value.toolchain, ['identitySha256', 'receiptSha256', 'environmentSha256', 'receiptDeflateBase64']);
	for (const key of ['identitySha256', 'receiptSha256', 'environmentSha256']) digest(toolchain[key]);
	if (toolchain.identitySha256 !== expected.nativeToolchainIdentity) throw new Error('Reference compiler toolchain differs from the verified native helper build.');
	const admittedTools = readMotionReferenceToolchainAudit(toolchain.receiptDeflateBase64, expected.target, expected.nativeToolchainIdentity);
	const environment = createMotionReferenceCompileEnvironment(admittedTools.receipt.environment, installRoots, expected.target);
	if (toolchain.receiptSha256 !== hashMotionReferenceAudit(admittedTools.bytes) || toolchain.environmentSha256 !== hashMotionReferenceAudit(JSON.stringify(environment))) throw new Error('Reference compiler toolchain bytes or environment differ.');
	const plan = createMotionReferenceCompilePlan({ target: expected.target, repositoryRoot: root, directory, installRoots, tools: admittedTools.tools });
	if (!Array.isArray(value.commands) || value.commands.length !== plan.commands.length) throw new Error('Reference compiler commands are incomplete.');
	for (const [index, input] of value.commands.entries()) {
		const command = record(input, ['phase', 'executable', 'args', 'cwd', 'naturalExitCode', 'stdoutSha256', 'stderrSha256']);
		const observed = { phase: command.phase, executable: command.executable, args: command.args, cwd: command.cwd };
		if (JSON.stringify(observed) !== JSON.stringify(plan.commands[index]) || command.naturalExitCode !== 0) throw new Error('Reference compiler command differs from its closed native argv.');
		digest(command.stdoutSha256); digest(command.stderrSha256);
	}
	if (expected.decoder.path !== path.basename(plan.decoder)) throw new Error('Reference compiler executable suffix differs.');
	return value as unknown as MotionReferenceBuildAudit;
}

export function hashMotionReferenceAudit(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(Object.keys(input).sort()) !== JSON.stringify([...keys].sort())) throw new Error('Reference compiler audit fields are not closed.');
	return input as Record<string, unknown>;
}
function digest(input: unknown): string {
	if (typeof input !== 'string' || !/^[a-f\d]{64}$/u.test(input)) throw new Error('Reference compiler audit digest is invalid.'); return input;
}
