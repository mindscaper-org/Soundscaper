/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { LIGHTSCAPER_WINDOWS_JOB_FAILURE_STAGES_CURRENT_V1,
	lightscaperWindowsJobProcessReceiptCurrentV1, readLightscaperWindowsJobReceiptCurrentV1 } from '../scripts/lib/lightscaper-windows-job-contract-current-v1.ts';
import type { LightscaperWindowsJobProofCurrentV1 } from '../scripts/lib/lightscaper-windows-job-contract-current-v1.ts';

const identity = { nonce: '0123456789abcdef0123456789abcdef', stage: 1 as const };
function terminal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { schemaVersion: 1, ...identity, processId: 123, exitCode: 0, expired: false, forcedTermination: false,
		readersRetired: true, activeProcesses: 0, failure: null, cleanupFailures: [], ...overrides };
}
function proof(overrides: Partial<LightscaperWindowsJobProofCurrentV1> = {}): LightscaperWindowsJobProofCurrentV1 {
	return { target: 'win-x64', helperSha256: 'a'.repeat(64), helperProcessId: 456, helperExitCode: 0,
		helperSignal: null, helperClosed: true, outerExpired: false,
		receipt: readLightscaperWindowsJobReceiptCurrentV1(terminal(), identity), ...overrides };
}
const output = { stdout: 'actual child stdout', stderr: '', launchError: null };

test('Lightscaper Windows Job receipt admits exactly the current closed terminal identity', () => {
	const value = readLightscaperWindowsJobReceiptCurrentV1(terminal(), identity);
	assert.equal(value.processId, 123); assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.cleanupFailures));
	for (const changed of [{ nonce: 'f'.repeat(32) }, { stage: 2 }, { schemaVersion: 2 }, { extra: true }]) {
		assert.throws(() => readLightscaperWindowsJobReceiptCurrentV1(terminal(changed), identity));
	}
});

test('Lightscaper Windows Job receipt refuses missing, inherited and accessor authority without invoking getters', () => {
	const missing = terminal(); delete missing.exitCode;
	assert.throws(() => readLightscaperWindowsJobReceiptCurrentV1(missing, identity));
	assert.throws(() => readLightscaperWindowsJobReceiptCurrentV1(Object.create(terminal()) as unknown, identity));
	let called = false;
	const accessor = terminal(); Object.defineProperty(accessor, 'processId', { enumerable: true, get() { called = true; return 123; } });
	assert.throws(() => readLightscaperWindowsJobReceiptCurrentV1(accessor, identity)); assert.equal(called, false);
	const symbol = terminal(); Object.defineProperty(symbol, Symbol('authority'), { value: true });
	assert.throws(() => readLightscaperWindowsJobReceiptCurrentV1(symbol, identity));
	const revoked = Proxy.revocable({}, {}); revoked.revoke();
	assert.throws(() => readLightscaperWindowsJobReceiptCurrentV1(revoked.proxy, identity));
});

test('Lightscaper Windows Job receipt bounds DWORDs, booleans and cleanup entries', () => {
	for (const changed of [{ processId: -1 }, { processId: 0x1_0000_0000 }, { exitCode: 0.5 }, { exitCode: -1 },
		{ activeProcesses: NaN }, { activeProcesses: 0x1_0000_0000 }, { readersRetired: 1 }, { expired: null },
		{ cleanupFailures: Array.from({ length: 17 }, () => ({ stage: 'close-job', code: 5 })) },
		{ failure: { stage: 'foreign', code: 5 } }, { failure: { stage: 'wait-main', code: -1 } },
		{ failure: { stage: 'wait-main', code: 5, extra: true } }, { cleanupFailures: new Array(1) }]) {
		assert.throws(() => readLightscaperWindowsJobReceiptCurrentV1(terminal(changed), identity));
	}
	const value = readLightscaperWindowsJobReceiptCurrentV1(terminal({ exitCode: 0xffff_ffff }), identity);
	assert.equal(value.exitCode, 0xffff_ffff);
});

test('Lightscaper Windows Job receipt admits every pinned native failure stage including atomic Job creation', () => {
	for (const stage of LIGHTSCAPER_WINDOWS_JOB_FAILURE_STAGES_CURRENT_V1) {
		const value = readLightscaperWindowsJobReceiptCurrentV1(terminal({ failure: { stage, code: 1460 } }), identity);
		assert.equal(value.failure?.stage, stage); assert.ok(Object.isFrozen(value.failure));
	}
	assert.ok(LIGHTSCAPER_WINDOWS_JOB_FAILURE_STAGES_CURRENT_V1.includes('job-list'));
	assert.ok(LIGHTSCAPER_WINDOWS_JOB_FAILURE_STAGES_CURRENT_V1.includes('verify-job'));
});

test('Lightscaper Windows Job receipt requires actual main retirement and empty Job for a created process', () => {
	for (const changed of [{ activeProcesses: 1 }, { activeProcesses: null }, { exitCode: null },
		{ processId: 0 }, { processId: 0, exitCode: null, activeProcesses: null }]) {
		assert.throws(() => readLightscaperWindowsJobReceiptCurrentV1(terminal(changed), identity));
	}
	const precreate = readLightscaperWindowsJobReceiptCurrentV1(terminal({ processId: 0, exitCode: null, activeProcesses: null,
		failure: { stage: 'create-process', code: 5 } }), identity);
	assert.equal(precreate.readersRetired, true); assert.equal(precreate.processId, 0);
	const live = readLightscaperWindowsJobReceiptCurrentV1(terminal({ readersRetired: false, activeProcesses: 2,
		exitCode: null, failure: { stage: 'wait-main', code: 1460 } }), identity);
	assert.equal(live.readersRetired, false);
	const unknownExit = readLightscaperWindowsJobReceiptCurrentV1(terminal({ exitCode: null,
		failure: { stage: 'get-exit-code', code: 5 } }), identity);
	const mapped = lightscaperWindowsJobProcessReceiptCurrentV1(proof({ receipt: unknownExit }), output);
	assert.equal(mapped.readersRetired, true); assert.equal(mapped.exitCode, null); assert.ok(mapped.launchError);
});

test('Lightscaper Windows adapter publishes actual application PID and exit rather than helper identity', () => {
	const actual = lightscaperWindowsJobProcessReceiptCurrentV1(proof(), output);
	assert.equal(actual.processId, 123); assert.equal(actual.exitCode, 0);
	assert.equal(actual.windowsJob.helperProcessId, 456); assert.equal(actual.readersRetired, true);
	assert.equal(actual.forcedGroupRetirement, false); assert.equal(actual.launchError, null);
	const nonzero = lightscaperWindowsJobProcessReceiptCurrentV1(proof({
		receipt: readLightscaperWindowsJobReceiptCurrentV1(terminal({ exitCode: 7 }), identity),
	}), output);
	assert.equal(nonzero.exitCode, 7); assert.equal(nonzero.readersRetired, true);
});

test('Lightscaper Windows adapter refuses retirement on missing evidence or unjoined supervisor', () => {
	for (const changed of [{ helperClosed: false }, { helperExitCode: 125 }, { helperSignal: 'SIGKILL' },
		{ outerExpired: true }, { receipt: null }]) {
		const value = lightscaperWindowsJobProcessReceiptCurrentV1(proof(changed), output);
		assert.equal(value.readersRetired, false); assert.ok(value.launchError);
	}
	assert.equal(lightscaperWindowsJobProcessReceiptCurrentV1(proof(), { ...output, launchError: 'spawn failed' }).readersRetired, false);
});

test('Lightscaper Windows adapter distinguishes safely retired forced cleanup from qualification success', () => {
	const forced = readLightscaperWindowsJobReceiptCurrentV1(terminal({ forcedTermination: true, expired: true }), identity);
	const value = lightscaperWindowsJobProcessReceiptCurrentV1(proof({ receipt: forced }), output);
	assert.equal(value.readersRetired, true); assert.equal(value.forcedGroupRetirement, true); assert.equal(value.expired, true);
	for (const changed of [{ failure: { stage: 'verify-job', code: 5 } }, { cleanupFailures: [{ stage: 'close-job', code: 5 }] }]) {
		const failed = lightscaperWindowsJobProcessReceiptCurrentV1(proof({
			receipt: readLightscaperWindowsJobReceiptCurrentV1(terminal(changed), identity),
		}), output);
		assert.equal(failed.readersRetired, true); assert.match(failed.launchError ?? '', /native failure/u);
	}
});
