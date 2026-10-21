/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runPhotoNativeToolCurrentV1 as run } from '../scripts/lib/lightscaper-photo-native-tool-current-v1.ts';

void test('failed trusted native tool preserves separately bounded actual stdout and stderr tails after joining', { timeout: 10_000 }, async () => {
	const program = `process.stdout.write('DROP_STDOUT_START' + 'o'.repeat(9000) + 'ACTUAL_COMPILER_STDOUT_FAILURE');
process.stderr.write('DROP_STDERR_START' + 'e'.repeat(9000) + 'ACTUAL_COMPILER_STDERR_FAILURE'); process.exitCode = 7;`;
	await assert.rejects(run(process.execPath, ['--input-type=module', '-e', program]), (error: unknown) => {
		assert.ok(error instanceof Error); assert.match(error.message, /Photo native tool failed \(7, null\)/u);
		assert.match(error.message, /stdout[^\n]*:\n/u); assert.match(error.message, /ACTUAL_COMPILER_STDOUT_FAILURE/u);
		assert.match(error.message, /stderr[^\n]*:\n/u); assert.match(error.message, /ACTUAL_COMPILER_STDERR_FAILURE/u);
		assert.doesNotMatch(error.message, /DROP_STDOUT_START|DROP_STDERR_START/u);
		assert.ok(error.message.length <= 16_600); return true;
	});
});
void test('successful trusted native tool still returns its complete stdout after draining both streams', { timeout: 10_000 }, async () => {
	const value = await run(process.execPath, ['--input-type=module', '-e',
		"process.stdout.write('actual tool output\\n3,7,11'); process.stderr.write('actual nonfatal compiler warning');"]);
	assert.equal(value, 'actual tool output\n3,7,11');
});
