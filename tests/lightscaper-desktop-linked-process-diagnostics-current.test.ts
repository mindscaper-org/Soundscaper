/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as owner from '../scripts/lib/lightscaper-desktop-managed-smoke-process-current-v1.ts';
import type { LightscaperManagedProcessReceiptCurrentV1 as Receipt } from '../scripts/lib/lightscaper-desktop-managed-smoke-process-current-v1.ts';

const options = { timeout: 10_000, skip: process.platform === 'win32' ? 'Actual POSIX owner refuses Windows; separate native Job tests own that platform.' : false };

function diagnostic(receipt: Receipt): Record<string, unknown> {
	const format: unknown = Reflect.get(owner, 'lightscaperManagedProcessDiagnosticCurrentV1');
	assert.equal(typeof format, 'function', 'The actual process owner must expose its bounded failure diagnostic.');
	if (typeof format !== 'function') throw new Error('Missing actual process diagnostic formatter.');
	const encoded: unknown = Reflect.apply(format, undefined, [receipt]);
	assert.equal(typeof encoded, 'string'); if (typeof encoded !== 'string') throw new Error('Diagnostic must be JSON text.');
	assert.ok(Buffer.byteLength(encoded) <= 1024 * 1024);
	const value: unknown = JSON.parse(encoded);
	assert.ok(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>;
}
function sameActualRetirement(value: Record<string, unknown>, receipt: Receipt): void {
	for (const field of ['processId', 'exitCode', 'signal', 'expired', 'readersRetired', 'forcedGroupRetirement', 'unretiredOwnedGroupId'] as const) {
		assert.equal(value[field], receipt[field], `Actual ${field} must not be reclassified.`);
	}
	assert.deepEqual(value.liveReaderIds, receipt.liveReaderIds); assert.equal(value.liveReaderCount, receipt.liveReaderIds.length);
	assert.equal(value.liveReaderIdsTruncated, false);
	assert.equal(value.launchError, receipt.launchError);
	assert.equal(value.schemaVersion, 1); assert.equal(value.kind, 'lightscaper-managed-process-diagnostic-current-v1');
	assert.equal(Object.hasOwn(value, 'status'), false, 'Diagnostic text grants no process success or retirement authority.');
}

void test('actual joined nonzero child preserves separate exit, retirement and both bounded stream tails in a serializable diagnostic', options, async () => {
	const receipt = await owner.launchLightscaperManagedSmokeProcessCurrentV1(process.execPath, ['--eval',
		'process.stdout.write("o".repeat(40000)+" actual stdout tail"+String.fromCharCode(10));process.stderr.write("e".repeat(40000)+" actual stderr cause"+String.fromCharCode(10));process.exitCode=7;']);
	assert.equal(receipt.exitCode, 7); assert.equal(receipt.signal, null); assert.equal(receipt.expired, false);
	assert.equal(receipt.readersRetired, true); assert.equal(receipt.forcedGroupRetirement, false);
	const value = diagnostic(receipt); sameActualRetirement(value, receipt);
	assert.equal(value.stdout, receipt.stdout); assert.equal(value.stderr, receipt.stderr);
	assert.ok(String(value.stdout).endsWith(' actual stdout tail\n')); assert.ok(String(value.stderr).endsWith(' actual stderr cause\n'));
	assert.equal(value.capturedStdoutCodeUnits, receipt.stdout.length); assert.equal(value.capturedStderrCodeUnits, receipt.stderr.length);
	assert.ok(String(value.stdout).length <= 32768 && String(value.stderr).length <= 32768);
	assert.doesNotThrow(() => JSON.stringify({ message: 'Actual linked process did not retire its complete owned group.\n' + JSON.stringify(value) }));
});

void test('actual natural zero child remains a raw observation without an invented failure or success verdict', options, async () => {
	const receipt = await owner.launchLightscaperManagedSmokeProcessCurrentV1(process.execPath, ['--eval', 'process.stdout.write("ordinary output");']);
	assert.equal(receipt.exitCode, 0); assert.equal(receipt.readersRetired, true); assert.equal(receipt.expired, false);
	const value = diagnostic(receipt); sameActualRetirement(value, receipt);
	assert.equal(value.stdout, 'ordinary output'); assert.equal(value.stderr, '');
});

void test('actual deadline termination remains expired and signalled even after its real owned group and streams retire', options, async () => {
	const receipt = await owner.launchLightscaperManagedSmokeProcessCurrentV1(process.execPath,
		['--eval', 'setInterval(()=>{},1000);'], { deadlineMs: 150, retirementGraceMs: 1_000 });
	assert.equal(receipt.expired, true); assert.equal(receipt.exitCode, null); assert.equal(receipt.signal, 'SIGTERM');
	assert.equal(receipt.readersRetired, true);
	const value = diagnostic(receipt); sameActualRetirement(value, receipt);
});
