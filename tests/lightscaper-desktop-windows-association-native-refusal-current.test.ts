/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import type { ClosedDomainRecord } from '../src/common/editor/closed-domain-value.ts';
import { admitLightscaperWindowsJobHelperCurrentV1, launchLightscaperWindowsJobProcessCurrentV1 } from '../scripts/lib/lightscaper-windows-job-driver-current-v1.ts';
import { inspectLightscaperWindowsJobHelperCurrentV1 } from '../scripts/lib/lightscaper-windows-job-helper-current-v1.ts';
import type { LightscaperWindowsManagedProcessReceiptCurrentV1 } from '../scripts/lib/lightscaper-windows-job-contract-current-v1.ts';

const variables = ['LIGHTSCAPER_WINDOWS_ASSOCIATION_HELPER', 'LIGHTSCAPER_WINDOWS_ASSOCIATION_HELPER_SHA256',
	'LIGHTSCAPER_WINDOWS_JOB_HELPER', 'LIGHTSCAPER_WINDOWS_JOB_HELPER_SHA256'] as const;
const required = process.env.LIGHTSCAPER_WINDOWS_ASSOCIATION_NATIVE_REQUIRED === '1';
const requested = required || variables.slice(0, 2).some(name => Boolean(process.env[name]));
const provisioned = variables.every(name => Boolean(process.env[name]));
const skip = process.platform !== 'win32' ? 'Actual Windows native association refusals require Windows; no OS credit.'
	: !requested ? 'Native association diagnostics were not requested; no native execution credit.'
		: !provisioned ? 'Native helper variables were not provisioned; the separate required-input test fails.' : false;
const zeroOperations = { comInitializations: 0, associationQueries: 0, callingJobQueries: 0, shellExecuteCalls: 0 };
const cases = ['schema', 'duplicate', 'target', 'archive-digest', 'existing-result'] as const;
const resultKeys = ['schemaVersion', 'kind', 'nonce', 'target', 'sourceRevision', 'operation', 'status', 'executablePath',
	'archivePath', 'archiveSha256', 'archiveByteLength', 'archiveStable', 'association', 'perUser', 'foreignDefaults',
	'foreignDefaultsUnchanged', 'primary', 'primaryStillLive', 'dispatch', 'returnedProcess', 'sameCallingJob',
	'returnedProcessJoined', 'returnedProcessExitCode', 'returnedProcessNaturalExit', 'returnedProcessHandleClosed',
	'callingJob', 'nativeHandlesClosed', 'operationCounts', 'failure'];

test('Windows association native diagnostics require actual host and explicitly code-built admitted helpers when requested',
	{ skip: !requested }, () => {
		assert.equal(process.platform, 'win32', 'A Linux skip never qualifies Windows native refusal behavior.');
		assert.ok(process.arch === 'x64' || process.arch === 'arm64');
		assert.equal(provisioned, true, `Required native inputs: ${variables.join(', ')}`);
		for (const name of ['LIGHTSCAPER_WINDOWS_ASSOCIATION_HELPER_SHA256', 'LIGHTSCAPER_WINDOWS_JOB_HELPER_SHA256'] as const) {
			assert.match(process.env[name] ?? '', /^[a-f0-9]{64}$/u);
		}
	});

test('actual Windows helper refuses malformed/changed inputs and an existing result before COM, default lookup, Job queries or Shell dispatch',
	{ skip, timeout: 120_000 }, async context => {
		const target = process.arch === 'x64' ? 'win-x64' : 'win-arm64';
		const helper = await inspectLightscaperWindowsJobHelperCurrentV1({ path: setting('LIGHTSCAPER_WINDOWS_ASSOCIATION_HELPER'),
			sha256: setting('LIGHTSCAPER_WINDOWS_ASSOCIATION_HELPER_SHA256'), target });
		const admission = await admitLightscaperWindowsJobHelperCurrentV1({ helperPath: setting('LIGHTSCAPER_WINDOWS_JOB_HELPER'),
			helperSha256: setting('LIGHTSCAPER_WINDOWS_JOB_HELPER_SHA256'), executable: helper.path });
		for (const name of cases) await context.test(name, async child => {
			const root = await mkdtemp(join(tmpdir(), 'lightscaper native association ü ')), nonce = randomBytes(16).toString('hex');
			const requestPath = join(root, `${nonce}.windows-association-request.json`), resultPath = join(root, `${nonce}.windows-association-result.json`);
			const archivePath = join(root, 'Owned catalog.liscape'), archive = Buffer.from('actual bounded negative archive bytes\n');
			const sentinel = Buffer.from('existing result sentinel must remain byte-identical\n');
			const request = { schemaVersion: name === 'schema' ? 2 : 1, nonce,
				target: name === 'target' ? target === 'win-x64' ? 'win-arm64' : 'win-x64' : target,
				sourceRevision: 'a'.repeat(40), operation: 'open', executablePath: await realpath(process.execPath),
				archivePath, archiveSha256: name === 'archive-digest' ? '0'.repeat(64) : digest(archive), primaryPid: process.pid };
			let receipt: LightscaperWindowsManagedProcessReceiptCurrentV1 | undefined;
			let noExternalOperations = false;
			try {
				await writeFile(archivePath, archive, { flag: 'wx', mode: 0o600 });
				const json = JSON.stringify(request), bytes = name === 'duplicate' ? `{"nonce":${JSON.stringify(nonce)},${json.slice(1)}` : json;
				await writeFile(requestPath, bytes, { flag: 'wx', mode: 0o600 });
				if (name === 'existing-result') await writeFile(resultPath, sentinel, { flag: 'wx', mode: 0o600 });
				receipt = await launchLightscaperWindowsJobProcessCurrentV1(admission, ['--request', requestPath, '--result', resultPath],
					{ nonce, stage: 1, receiptPath: join(root, `${nonce}.stage-1.windows-job.json`), deadlineMs: 10_000 });
				assert.equal(receipt.launchError, null); assert.equal(receipt.expired, false);
				assert.equal(receipt.readersRetired, true); assert.equal(receipt.forcedGroupRetirement, false);
				assert.equal(receipt.exitCode, name === 'existing-result' ? 2 : 1);
				assert.ok(receipt.processId > 0); assert.notEqual(receipt.processId, receipt.windowsJob.helperProcessId);
				assert.deepEqual(await readFile(archivePath), archive);
				assert.equal(await readFile(requestPath, 'utf8'), bytes);
				if (name === 'existing-result') {
					assert.deepEqual(await readFile(resultPath), sentinel);
					const failure = record(JSON.parse(receipt.stderr.trim()) as unknown, 'native refusal', ['kind', 'operationCounts']);
					assert.equal(field(failure, 'kind', 'native refusal'), 'lightscaper-windows-association-preflight-refusal-current-v1');
					assert.deepEqual(field(failure, 'operationCounts', 'native refusal'), zeroOperations);
					noExternalOperations = true;
				} else {
					const result = await boundedJson(resultPath);
					assert.equal(field(result, 'status', 'native result'), 'refused');
					assert.deepEqual(field(result, 'operationCounts', 'native result'), zeroOperations);
					noExternalOperations = true;
					const expected = name === 'schema' ? 'request-version-operation' : name === 'duplicate' ? 'json-duplicate'
						: name === 'target' ? 'request-target' : 'archive-digest';
					const failure = record(field(result, 'failure', 'native result'), 'native failure', ['stage', 'win32']);
					assert.equal(field(failure, 'stage', 'native failure'), expected);
					if (name === 'archive-digest') assert.equal(field(result, 'archiveByteLength', 'native result'), archive.length);
				}
			} finally {
				if (receipt?.readersRetired && noExternalOperations) await rm(root, { recursive: true, force: false });
				else child.diagnostic(`Native retirement or zero external operations unproved; retained exact fixture: ${root}`);
			}
		});
		context.diagnostic(`Actual ${target} helper ${helper.sha256}: five native refusal cases; this is not default-association dispatch qualification.`);
	});

function setting(name: typeof variables[number]): string {
	const value = process.env[name]; assert.ok(value, `Missing ${name}`); return value;
}
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
async function boundedJson(path: string): Promise<ClosedDomainRecord> {
	const metadata = await lstat(path); assert.equal(metadata.isFile(), true); assert.equal(metadata.isSymbolicLink(), false);
	assert.ok(metadata.size > 0 && metadata.size <= 262144); const bytes = await readFile(path);
	assert.equal(bytes.length, metadata.size); return record(JSON.parse(bytes.toString('utf8')) as unknown, 'native result', resultKeys);
}
