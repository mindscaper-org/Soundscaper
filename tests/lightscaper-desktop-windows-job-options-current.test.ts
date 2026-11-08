/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { readLightscaperManagedSmokeOptionsCurrentV1 } from '../scripts/lib/lightscaper-desktop-managed-smoke-options-current-v1.ts';

const executable = resolve(tmpdir(), 'Lightscaper stage Ω', 'Lightscaper.exe');
const runtime = resolve(tmpdir(), 'Lightscaper stage Ω', 'resources', 'runtime');
const output = resolve(tmpdir(), 'Lightscaper evidence');
const helper = resolve(tmpdir(), 'Lightscaper native tools', 'job.exe');
const base = ['--executable', executable, '--runtime-root', runtime, '--output-root', output];
const native = ['--windows-job-helper', helper, '--windows-job-helper-sha256', 'a'.repeat(64)];

test('Lightscaper Windows managed smoke requires both explicit helper authority options', () => {
	assert.throws(() => readLightscaperManagedSmokeOptionsCurrentV1(base, 'win32'), /paired explicit/u);
	assert.throws(() => readLightscaperManagedSmokeOptionsCurrentV1([...base, ...native.slice(0, 2)], 'win32'), /paired explicit/u);
	assert.throws(() => readLightscaperManagedSmokeOptionsCurrentV1([...base, ...native.slice(2)], 'win32'), /paired explicit/u);
	const parsed = readLightscaperManagedSmokeOptionsCurrentV1([...base, ...native], 'win32');
	assert.equal(parsed.windowsJobHelper, helper); assert.equal(parsed.windowsJobHelperSha256, 'a'.repeat(64));
	assert.equal(parsed.executable, executable); assert.equal(parsed.allowNoSandbox, false); assert.ok(Object.isFrozen(parsed));
});

test('Lightscaper POSIX managed smoke preserves its existing flags and refuses Windows helper options', () => {
	for (const platform of ['linux', 'darwin']) {
		const parsed = readLightscaperManagedSmokeOptionsCurrentV1([...base, '--allow-no-sandbox'], platform);
		assert.equal(parsed.windowsJobHelper, null); assert.equal(parsed.allowNoSandbox, true);
		assert.throws(() => readLightscaperManagedSmokeOptionsCurrentV1([...base, ...native], platform), /Windows Node/u);
	}
});

test('Lightscaper Windows helper CLI refuses unknown, duplicate and malformed authority options', () => {
	for (const changed of [
		[...base, ...native, '--unknown', '1'], [...base, ...native, '--windows-job-helper', helper],
		[...base, ...native, '--windows-job-helper-sha256', 'a'.repeat(64)],
		[...base, '--windows-job-helper', 'relative.exe', ...native.slice(2)],
		[...base, '--windows-job-helper', helper, '--windows-job-helper-sha256', 'A'.repeat(64)],
		[...base, '--windows-job-helper', helper, '--windows-job-helper-sha256', 'a'.repeat(63)],
		[...base, '--windows-job-helper', helper, '--windows-job-helper-sha256'],
		[...base, ...native, '--allow-no-sandbox', '--allow-no-sandbox'],
		[...base, '--windows-job-helper', `${helper}\0`, ...native.slice(2)],
	]) assert.throws(() => readLightscaperManagedSmokeOptionsCurrentV1(changed, 'win32'));
});
