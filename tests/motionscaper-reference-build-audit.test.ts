/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { fingerprintFramescaperMediaHostToolchainReceipt } from '../native/framescaper-media-host/build/recipe-driver.mjs';
import { hashMotionReferenceAudit, validateMotionReferenceBuildAudit, type MotionReferenceAuditExpected, type MotionReferenceBuildAudit } from '../scripts/lib/motionscaper-reference-build-audit.ts';
import { createMotionReferenceCompileEnvironment, createMotionReferenceCompilePlan } from '../scripts/lib/motionscaper-reference-build-plan.ts';
import { readMotionReferenceToolchainAudit } from '../scripts/lib/motionscaper-reference-build-toolchain.ts';
import { motionReferenceInstallRoots } from '../scripts/lib/motionscaper-reference-prefix.ts';

const digest = (digit: string) => digit.repeat(64);
function fixture() {
	const target = 'linux-x64' as const;
	const executables = Object.fromEntries(['ar', 'c', 'cmake', 'cxx', 'make', 'ninja', 'pkgConfig', 'ranlib', 'shell']
		.map(role => [role, { path: `/tools/${role}`, sha256: digest('1') }]));
	const body = { schemaVersion: 1, targetId: target, hostRuntime: target, executables, environment: { PATH: '/tools' } };
	const identitySha256 = fingerprintFramescaperMediaHostToolchainReceipt(body) as string;
	const receipt = { ...body, identitySha256 }, bytes = Buffer.from(`${JSON.stringify(receipt, null, '\t')}\n`);
	const encoded = deflateSync(bytes).toString('base64');
	const admitted = readMotionReferenceToolchainAudit(encoded, target, identitySha256);
	const installRoots = motionReferenceInstallRoots('/native');
	const plan = createMotionReferenceCompilePlan({ target, repositoryRoot: '/source', directory: '/owned', installRoots, tools: admitted.tools });
	const decoder = { path: 'motion-reference-decoder', byteLength: 100, sha256: digest('2') };
	const sourceFiles = [{ path: 'scripts/lib/motionscaper-native-reference.cpp', byteLength: 10, sha256: digest('3') }];
	const expected: MotionReferenceAuditExpected = { target, sourceRevision: 'a'.repeat(40), sourceFiles, decoder,
		nativeBuildReceiptSha256: digest('4'), nativeHelperSha256: digest('5'), nativeSourceManifestSha256: digest('6'),
		dependencyRecipeSha256: digest('7'), nativeToolchainIdentity: identitySha256 };
	const audit: MotionReferenceBuildAudit = { schemaVersion: 1, target, sourceRevision: expected.sourceRevision,
		repositoryRoot: '/source', directory: '/owned', sourceFiles, decoder,
		prefixAuthority: { path: '/authority.json', byteLength: 1000, sha256: digest('8'), nativeWorkRoot: '/native', prefix: installRoots[0]!,
			nativeBuildReceiptSha256: expected.nativeBuildReceiptSha256, nativeHelperSha256: expected.nativeHelperSha256,
			nativeSourceManifestSha256: expected.nativeSourceManifestSha256, dependencyRecipeSha256: expected.dependencyRecipeSha256 },
		toolchain: { identitySha256, receiptSha256: hashMotionReferenceAudit(bytes), receiptDeflateBase64: encoded,
			environmentSha256: hashMotionReferenceAudit(JSON.stringify(createMotionReferenceCompileEnvironment(body.environment, installRoots, target))) },
		compileBudgetMs: 60_000, compileElapsedMs: 123,
		commands: plan.commands.map(command => ({ ...command, naturalExitCode: 0, stdoutSha256: digest('9'), stderrSha256: digest('0') })) };
	return { audit, expected, receipt, bytes, identitySha256 };
}

test('reference compiler evidence binds the full native toolchain, standard prefix, exact commands and independent binary', () => {
	const { audit, expected } = fixture();
	assert.deepEqual(validateMotionReferenceBuildAudit(audit, expected), audit);
	for (const change of [
		{ target: 'linux-arm64' }, { sourceRevision: 'b'.repeat(40) }, { sourceFiles: [] },
		{ decoder: { ...audit.decoder, path: 'motion-reference-decoder.exe' } },
		{ compileBudgetMs: 60_001 }, { compileElapsedMs: 60_001 }, { compileElapsedMs: -1 }, { extra: true },
		{ prefixAuthority: { ...audit.prefixAuthority, prefix: '/unapproved-prefix' } },
		{ prefixAuthority: { ...audit.prefixAuthority, nativeBuildReceiptSha256: digest('a') } },
		{ prefixAuthority: { ...audit.prefixAuthority, dependencyRecipeSha256: digest('a') } },
		{ toolchain: { ...audit.toolchain, environmentSha256: digest('a') } },
		{ commands: audit.commands.slice(1) },
		{ commands: audit.commands.map(command => ({ ...command, naturalExitCode: 1 })) },
		{ commands: audit.commands.map(command => ({ ...command, args: [...command.args, '-DUNTRUSTED=ON'] })) },
	]) assert.throws(() => validateMotionReferenceBuildAudit({ ...audit, ...change }, expected), /Reference compiler/u);
});

test('a self-consistent replacement compiler receipt cannot replace the verified native toolchain identity', () => {
	const { audit, expected, receipt } = fixture();
	for (const replacement of [
		{ ...receipt, environment: { PATH: '/other-tools' } },
		{ ...receipt, executables: { ...receipt.executables, cxx: { path: '/tools/other-cxx', sha256: digest('a') } } },
	]) {
		const { identitySha256: _identity, ...body } = replacement;
		const changed = { ...body, identitySha256: fingerprintFramescaperMediaHostToolchainReceipt(body) };
		const bytes = Buffer.from(`${JSON.stringify(changed, null, '\t')}\n`);
		assert.throws(() => validateMotionReferenceBuildAudit({ ...audit, toolchain: { ...audit.toolchain,
			identitySha256: changed.identitySha256, receiptSha256: hashMotionReferenceAudit(bytes), receiptDeflateBase64: deflateSync(bytes).toString('base64') } }, expected), /verified native helper/u);
	}
});

test('toolchain compression stays canonical and bounded and cannot disguise target or source-tool drift', () => {
	const { receipt, identitySha256, bytes } = fixture();
	for (const changed of [{ ...receipt, targetId: 'win-x64' }, { ...receipt, extra: true },
		{ ...receipt, environment: { ...receipt.environment, LD_PRELOAD: '/untrusted.so' } }]) {
		assert.throws(() => readMotionReferenceToolchainAudit(deflateSync(Buffer.from(`${JSON.stringify(changed, null, '\t')}\n`)).toString('base64'), 'linux-x64', identitySha256));
	}
	assert.throws(() => readMotionReferenceToolchainAudit(deflateSync(bytes).toString('base64') + '\n', 'linux-x64', identitySha256), /encoding/u);
	assert.throws(() => readMotionReferenceToolchainAudit(deflateSync(Buffer.alloc(65_537, 32)).toString('base64'), 'linux-x64', identitySha256));
});
