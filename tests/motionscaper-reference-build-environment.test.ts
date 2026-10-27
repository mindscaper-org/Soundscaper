/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createMotionReferenceCompileEnvironment } from '../scripts/lib/motionscaper-reference-build-plan.ts';

test('Reference compiler child excludes parent coverage without changing its audited environment', async () => {
	const previous = process.env.NODE_V8_COVERAGE;
	try {
		// A native shell observes the actual child environment without producing any V8 profiles.
		process.env.NODE_V8_COVERAGE = '/parent-only-motion-reference-coverage';
		const windows = process.platform === 'win32', systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
		assert.ok(!windows || systemRoot, 'The native Windows shell requires its actual system root.');
		const environment = createMotionReferenceCompileEnvironment({ PATH: process.env.PATH!, ...(windows ? { SYSTEMROOT: systemRoot! } : {}) },
			[windows ? 'C:\\native\\ffmpeg-install' : '/native/ffmpeg-install'], windows ? 'win-x64' : 'linux-x64');
		const digest = () => createHash('sha256').update(JSON.stringify(environment)).digest('hex');
		const before = digest();
		const command = windows ? process.env.ComSpec ?? join(systemRoot!, 'System32', 'cmd.exe') : '/bin/sh';
		const args = windows ? ['/d', '/s', '/c', 'if defined NODE_V8_COVERAGE (echo present) else (echo absent)']
			: ['-c', 'if [ "${NODE_V8_COVERAGE+x}" = x ]; then printf present; else printf absent; fi'];
		const result = await promisify(execFile)(command, args, {
			env: environment, timeout: 5000, maxBuffer: 65536, shell: false,
		});
		assert.deepEqual({ childCoverage: result.stdout.trim(), auditSha256: digest() }, { childCoverage: 'absent', auditSha256: before });
		assert.equal(process.env.NODE_V8_COVERAGE, '/parent-only-motion-reference-coverage', 'Parent test coverage must remain enabled.');
	} finally {
		if (previous === undefined) delete process.env.NODE_V8_COVERAGE;
		else process.env.NODE_V8_COVERAGE = previous;
	}
});
