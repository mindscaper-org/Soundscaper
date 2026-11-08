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

void test('failed trusted native tool preserves first actual compiler error and FAILED lines before noisy bounded tails', { timeout: 10_000 }, async () => {
	const program = `process.stdout.write('owned.cpp(3,7): error C2491: ACTUAL_FIRST_MSVC_FAILURE\\n' + 'o'.repeat(20000) + 'ACTUAL_STDOUT_TAIL');
process.stderr.write('FAILED: ACTUAL_FIRST_NINJA_TARGET\\n' + 'e'.repeat(20000) + 'ACTUAL_STDERR_TAIL'); process.exitCode = 9;`;
	await assert.rejects(run(process.execPath, ['--input-type=module', '-e', program]), (error: unknown) => {
		assert.ok(error instanceof Error); assert.match(error.message, /Photo native tool failed \(9, null\)/u);
		assert.match(error.message, /owned\.cpp\(3,7\): error C2491: ACTUAL_FIRST_MSVC_FAILURE/u);
		assert.match(error.message, /FAILED: ACTUAL_FIRST_NINJA_TARGET/u);
		assert.ok(error.message.indexOf('ACTUAL_FIRST_MSVC_FAILURE') < error.message.indexOf('stdout (tail)'));
		assert.ok(error.message.indexOf('ACTUAL_FIRST_NINJA_TARGET') < error.message.indexOf('stdout (tail)'));
		assert.match(error.message, /ACTUAL_STDOUT_TAIL/u); assert.match(error.message, /ACTUAL_STDERR_TAIL/u);
		assert.ok(error.message.length <= 25_000); return true;
	});
});
