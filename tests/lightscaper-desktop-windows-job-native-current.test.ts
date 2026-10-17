/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { readLightscaperWindowsJobReceiptCurrentV1 } from '../scripts/lib/lightscaper-windows-job-contract-current-v1.ts';
import { inspectLightscaperWindowsJobHelperCurrentV1 } from '../scripts/lib/lightscaper-windows-job-helper-current-v1.ts';
import { admitLightscaperWindowsJobHelperCurrentV1, launchLightscaperWindowsJobProcessCurrentV1 } from '../scripts/lib/lightscaper-windows-job-driver-current-v1.ts';
import type { LightscaperWindowsManagedProcessReceiptCurrentV1 } from '../scripts/lib/lightscaper-windows-job-contract-current-v1.ts';

const runFile = promisify(execFile);
const names = ['clean', 'nonzero', 'closed-stdio', 'timeout', 'assignment-failure', 'supervisor-death'] as const;
type CaseName = typeof names[number];
const environmentNames = ['LIGHTSCAPER_WINDOWS_JOB_HELPER', 'LIGHTSCAPER_WINDOWS_JOB_HELPER_SHA256',
	'LIGHTSCAPER_WINDOWS_JOB_CANARY', 'LIGHTSCAPER_WINDOWS_JOB_READER_FIXTURE'] as const;
const required = process.env.LIGHTSCAPER_WINDOWS_JOB_NATIVE_REQUIRED === '1';
const requested = required || environmentNames.some(name => process.env[name]);
const provisioned = environmentNames.every(name => Boolean(process.env[name]));
const skip = process.platform !== 'win32' ? 'Requires actual native Windows Job Object execution.'
	: !provisioned ? 'Native fixture/helper paths were not provisioned; no native qualification claimed.' : false;
interface Failure { readonly stage: string; readonly code: number }
interface Canary {
	readonly schemaVersion: 1; readonly caseName: CaseName; readonly nonce: string;
	readonly supervisorProcessId: number; readonly rootProcessId: number; readonly readerProcessId: number;
	readonly supervisorExitCode: number | null; readonly observedOuterEmptyBeforeCleanup: boolean;
	readonly finalOuterActiveProcesses: number | null; readonly totalProcesses: number;
	readonly exclusiveDeniedWhileReaderLive: boolean; readonly deleteDeniedWhileReaderLive: boolean;
	readonly exclusiveReopenAfterEmpty: boolean; readonly deletedAfterEmpty: boolean;
	readonly naturalExitMarker: boolean; readonly firstInstructionMarker: boolean;
	readonly nativeReceiptPresent: boolean; readonly supervisorKilled: boolean; readonly cleanupForced: boolean;
	readonly casePassed: boolean; readonly failures: readonly Failure[]; readonly cleanupFailures: readonly Failure[];
}
const canaryKeys = ['schemaVersion', 'caseName', 'nonce', 'supervisorProcessId', 'rootProcessId', 'readerProcessId',
	'supervisorExitCode', 'observedOuterEmptyBeforeCleanup', 'finalOuterActiveProcesses', 'totalProcesses',
	'exclusiveDeniedWhileReaderLive', 'deleteDeniedWhileReaderLive', 'exclusiveReopenAfterEmpty', 'deletedAfterEmpty',
	'naturalExitMarker', 'firstInstructionMarker', 'nativeReceiptPresent', 'supervisorKilled', 'cleanupForced',
	'casePassed', 'failures', 'cleanupFailures'];

test('Lightscaper native Windows driver preserves empty, quoted and Unicode literal argv', { skip }, async context => {
	const admission = await admitLightscaperWindowsJobHelperCurrentV1({ helperPath: setting('LIGHTSCAPER_WINDOWS_JOB_HELPER'),
		helperSha256: setting('LIGHTSCAPER_WINDOWS_JOB_HELPER_SHA256'), executable: await realpath(process.execPath) });
	const nonce = randomBytes(16).toString('hex'), root = await mkdtemp(join(tmpdir(), 'lightscaper literal argv ü '));
	let receipt: LightscaperWindowsManagedProcessReceiptCurrentV1 | undefined;
	try {
		const literals = ['', 'ordinary', 'white space', 'quote"inside', 'trailing\\', '\\"', 'äΩ😀', '--literal-option'];
		receipt = await launchLightscaperWindowsJobProcessCurrentV1(admission,
			['--eval', 'process.stdout.write(JSON.stringify(process.argv.slice(1)));', '--', ...literals],
			{ nonce, stage: 1, receiptPath: join(root, `${nonce}.stage-1.windows-job.json`), deadlineMs: 10_000 });
		assert.equal(receipt.launchError, null); assert.equal(receipt.exitCode, 0);
		assert.equal(receipt.readersRetired, true); assert.equal(receipt.forcedGroupRetirement, false);
		assert.equal(receipt.expired, false); assert.ok(receipt.processId > 0);
		assert.notEqual(receipt.processId, receipt.windowsJob.helperProcessId);
		assert.deepEqual(JSON.parse(receipt.stdout), literals);
	} finally {
		if (receipt?.readersRetired) await rm(root, { recursive: true, force: false });
		else context.diagnostic(`Literal argv readers unproven; retained fixture root: ${root}`);
	}
});

test('Lightscaper native Windows Job qualification explicitly requires its actual target and provisioned binaries',
	{ skip: !requested }, () => {
		assert.equal(process.platform, 'win32', 'Linux file/schema checks do not qualify Windows kernel retirement.');
		assert.ok(process.arch === 'x64' || process.arch === 'arm64');
		assert.equal(provisioned, true, `Required native variables: ${environmentNames.join(', ')}`);
		assert.match(process.env.LIGHTSCAPER_WINDOWS_JOB_HELPER_SHA256 ?? '', /^[a-f0-9]{64}$/u);
	});

for (const caseName of names) {
	test(`Lightscaper native Windows Job ${caseName} joins real descendants before exclusive reopen and deletion`,
		{ skip, timeout: 90_000 }, async context => {
			const target = process.arch === 'x64' ? 'win-x64' : 'win-arm64';
			const helper = await inspectLightscaperWindowsJobHelperCurrentV1({
				path: setting('LIGHTSCAPER_WINDOWS_JOB_HELPER'), sha256: setting('LIGHTSCAPER_WINDOWS_JOB_HELPER_SHA256'), target,
			});
			const canaryPath = await binary(setting('LIGHTSCAPER_WINDOWS_JOB_CANARY'));
			const fixturePath = await binary(setting('LIGHTSCAPER_WINDOWS_JOB_READER_FIXTURE'));
			const canarySha256 = await digest(canaryPath), fixtureSha256 = await digest(fixturePath);
			await inspectLightscaperWindowsJobHelperCurrentV1({ path: canaryPath, sha256: canarySha256, target });
			await inspectLightscaperWindowsJobHelperCurrentV1({ path: fixturePath, sha256: fixtureSha256, target });
			const nonce = randomBytes(16).toString('hex');
			const root = await mkdtemp(join(tmpdir(), 'lightscaper native job ü '));
			let witness: Canary | undefined;
			let launchFailure: unknown;
			try {
				try {
					await runFile(canaryPath, ['--case', caseName, '--helper', helper.path, '--fixture', fixturePath,
						'--root', root, '--nonce', nonce], { timeout: 70_000, maxBuffer: 1024 * 1024, windowsHide: true });
				} catch (error) { launchFailure = error; }
				witness = await readCanary(join(root, 'canary.json'), caseName, nonce);
				await retainEvidence(root, caseName, nonce, { helper, canarySha256, fixtureSha256, target, witness });
				assert.equal(launchFailure, undefined, 'The native canary must close successfully after joined cleanup.');
				assert.equal(witness.casePassed, true, JSON.stringify(witness));
				assert.deepEqual(witness.failures, []); assert.deepEqual(witness.cleanupFailures, []);
				assert.equal(witness.observedOuterEmptyBeforeCleanup, true);
				assert.equal(witness.finalOuterActiveProcesses, 0); assert.equal(witness.cleanupForced, false);
				assert.equal(witness.exclusiveReopenAfterEmpty, true); assert.equal(witness.deletedAfterEmpty, true);
				assert.equal(witness.naturalExitMarker, caseName === 'clean' || caseName === 'nonzero');
				assert.ok(witness.supervisorProcessId > 0);
				if (caseName === 'assignment-failure') {
					assert.equal(witness.firstInstructionMarker, false); assert.equal(witness.rootProcessId, 0);
					assert.equal(witness.readerProcessId, 0);
				} else {
					assert.equal(witness.firstInstructionMarker, true); assert.ok(witness.rootProcessId > 0);
					assert.ok(witness.readerProcessId > 0); assert.notEqual(witness.rootProcessId, witness.readerProcessId);
					assert.ok(witness.totalProcesses >= 4, 'Actual supervisor → root → child → reader process chain.');
					assert.equal(witness.exclusiveDeniedWhileReaderLive, true); assert.equal(witness.deleteDeniedWhileReaderLive, true);
				}
				if (caseName === 'supervisor-death') {
					assert.equal(witness.supervisorKilled, true); assert.equal(witness.supervisorExitCode, 137);
					await assertNoTerminalReceipt(join(root, 'native-receipt.json'), nonce);
					return; // Crash containment is not authenticated product qualification.
				}
				assert.equal(witness.supervisorExitCode, 0); assert.equal(witness.nativeReceiptPresent, true);
				const native = readLightscaperWindowsJobReceiptCurrentV1(await jsonFile(join(root, 'native-receipt.json')), { nonce, stage: 1 });
				assert.equal(native.readersRetired, true); assert.deepEqual(native.cleanupFailures, []);
				if (caseName === 'assignment-failure') {
					assert.ok(native.failure); assert.equal(native.failure.stage, 'create-process');
					assert.notEqual(native.failure.code, 0); assert.equal(native.expired, false);
					assert.equal(native.processId, 0); assert.equal(native.activeProcesses, null); assert.equal(native.exitCode, null);
					assert.equal(native.forcedTermination, false);
				} else {
					assert.equal(native.processId, witness.rootProcessId); assert.notEqual(native.processId, witness.supervisorProcessId);
					assert.equal(native.activeProcesses, 0);
					assert.equal(native.failure, null); assert.equal(native.expired, caseName === 'timeout');
					assert.equal(native.forcedTermination, caseName === 'timeout' || caseName === 'closed-stdio');
					assert.equal(native.exitCode, caseName === 'timeout' ? 125 : caseName === 'nonzero' ? 7 : 0);
				}
			} finally {
				// execFile has observed driver close. Only its actual native empty-job
				// witness permits removing this fixture root. A timeout/missing receipt
				// retains the files; Node kill/taskkill is never retirement proof.
				if (witness?.finalOuterActiveProcesses === 0 && witness.exclusiveReopenAfterEmpty && witness.deletedAfterEmpty) {
					await rm(root, { recursive: true, force: false });
				}
				else context.diagnostic(`Native reader retirement unproven; retained fixture root: ${root}`);
			}
		});
}
function setting(name: typeof environmentNames[number]): string {
	const value = process.env[name]; assert.ok(value, `Missing ${name}`); return value;
}
async function binary(path: string): Promise<string> {
	assert.equal(isAbsolute(path), true); const metadata = await lstat(path);
	assert.equal(metadata.isFile(), true); assert.equal(metadata.isSymbolicLink(), false);
	return realpath(path);
}
async function digest(path: string): Promise<string> { return createHash('sha256').update(await readFile(path)).digest('hex'); }
async function jsonFile(path: string): Promise<unknown> {
	const metadata = await lstat(path); assert.equal(metadata.isFile(), true); assert.equal(metadata.isSymbolicLink(), false);
	assert.ok(metadata.size > 0 && metadata.size <= 16 * 1024);
	return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
async function readCanary(path: string, caseName: CaseName, nonce: string): Promise<Canary> {
	const value = await jsonFile(path);
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	assert.deepEqual(Object.keys(value).sort(), [...canaryKeys].sort());
	const fields = value as Record<string, unknown>;
	assert.equal(fields.schemaVersion, 1); assert.equal(fields.caseName, caseName); assert.equal(fields.nonce, nonce);
	for (const name of ['supervisorProcessId', 'rootProcessId', 'readerProcessId', 'totalProcesses']) assert.ok(uint32(fields[name]));
	for (const name of ['supervisorExitCode', 'finalOuterActiveProcesses']) assert.ok(fields[name] === null || uint32(fields[name]));
	for (const name of canaryKeys.filter(name => !['schemaVersion', 'caseName', 'nonce', 'supervisorProcessId', 'rootProcessId',
		'readerProcessId', 'supervisorExitCode', 'finalOuterActiveProcesses', 'totalProcesses', 'failures', 'cleanupFailures'].includes(name))) {
		assert.equal(typeof fields[name], 'boolean');
	}
	for (const name of ['failures', 'cleanupFailures']) {
		const entries = fields[name]; assert.ok(Array.isArray(entries)); assert.ok(entries.length <= 32);
		for (const entry of entries as unknown[]) {
			assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry));
			assert.deepEqual(Object.keys(entry).sort(), ['code', 'stage']); const failure = entry as Record<string, unknown>;
			assert.equal(typeof failure.stage, 'string'); assert.ok(uint32(failure.code));
		}
	}
	return value as Canary;
}
function uint32(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff; }
async function retainEvidence(root: string, caseName: CaseName, nonce: string, metadata: unknown): Promise<void> {
	const evidence = process.env.LIGHTSCAPER_WINDOWS_JOB_CANARY_EVIDENCE;
	if (!evidence) return;
	assert.equal(isAbsolute(evidence), true); await mkdir(evidence, { recursive: true });
	const output = await mkdtemp(join(await realpath(evidence), `${caseName}-`));
	await copyFile(join(root, 'canary.json'), join(output, 'canary.json'), constants.COPYFILE_EXCL);
	try { await copyFile(join(root, 'native-receipt.json'), join(output, 'native-receipt.json'), constants.COPYFILE_EXCL); }
	catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error; }
	await writeFile(join(output, 'identity.json'), `${JSON.stringify({ nonce, ...metadataObject(metadata) }, null, '\t')}\n`, { flag: 'wx' });
}
function metadataObject(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>;
}

/** Receipt reservation precedes app launch; supervisor death may retain an
 * empty/truncated file. Its existence grants no terminal retirement authority. */
async function assertNoTerminalReceipt(path: string, nonce: string): Promise<void> {
	let value: unknown;
	try {
		const metadata = await lstat(path); assert.equal(metadata.isFile(), true); assert.equal(metadata.isSymbolicLink(), false);
		assert.ok(metadata.size <= 16 * 1024);
		const bytes = await readFile(path, 'utf8');
		try { value = JSON.parse(bytes) as unknown; }
		catch (error) { if (!(error instanceof SyntaxError)) throw error; }
	} catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error; }
	assert.throws(() => readLightscaperWindowsJobReceiptCurrentV1(value, { nonce, stage: 1 }));
}
