/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspectLightscaperWindowsJobHelperCurrentV1, lightscaperWindowsJobTargetCurrentV1,
	revalidateLightscaperWindowsJobAdmissionCurrentV1 } from '../scripts/lib/lightscaper-windows-job-helper-current-v1.ts';
import type { LightscaperWindowsJobAdmissionCurrentV1 } from '../scripts/lib/lightscaper-windows-job-helper-current-v1.ts';

function pe(machine = 0x8664): Buffer {
	const bytes = Buffer.alloc(128); bytes.write('MZ'); bytes.writeUInt32LE(64, 0x3c);
	bytes.write('PE\0\0', 64, 'binary'); bytes.writeUInt16LE(machine, 68); bytes.writeUInt16LE(0x20b, 88);
	return bytes;
}
function digest(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

test('Lightscaper Windows helper target admits each actual Windows host independently', () => {
	assert.equal(lightscaperWindowsJobTargetCurrentV1('win32', 'x64'), 'win-x64');
	assert.equal(lightscaperWindowsJobTargetCurrentV1('win32', 'arm64'), 'win-arm64');
	for (const [platform, architecture] of [['linux', 'x64'], ['darwin', 'arm64'], ['win32', 'ia32']]) {
		assert.throws(() => lightscaperWindowsJobTargetCurrentV1(platform!, architecture!));
	}
});

test('Lightscaper Windows helper inspection authenticates complete bytes and exact PE target without executing fixtures', async () => {
	const root = await mkdtemp(join(tmpdir(), 'lightscaper-job-helper-'));
	try {
		const path = join(root, 'helper with Unicode Ω.exe'), bytes = pe(); await writeFile(path, bytes);
		const admitted = await inspectLightscaperWindowsJobHelperCurrentV1({ path, sha256: digest(bytes), target: 'win-x64' });
		assert.equal(admitted.byteLength, bytes.length); assert.equal(admitted.sha256, digest(bytes)); assert.ok(Object.isFrozen(admitted));
		await assert.rejects(inspectLightscaperWindowsJobHelperCurrentV1({ path, sha256: 'a'.repeat(64), target: 'win-x64' }), /SHA-256/u);
		await assert.rejects(inspectLightscaperWindowsJobHelperCurrentV1({ path, sha256: digest(bytes), target: 'win-arm64' }), /target-native/u);
		bytes[127] = 1; await writeFile(path, bytes);
		await assert.rejects(inspectLightscaperWindowsJobHelperCurrentV1({ path, sha256: admitted.sha256, target: 'win-x64' }), /SHA-256/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Lightscaper Windows helper inspection rejects missing digests, directories and malformed PE', async () => {
	const root = await mkdtemp(join(tmpdir(), 'lightscaper-job-refusal-'));
	try {
		const path = join(root, 'invalid.exe'); await writeFile(path, Buffer.alloc(128));
		await assert.rejects(inspectLightscaperWindowsJobHelperCurrentV1({ path, sha256: '', target: 'win-x64' }));
		await assert.rejects(inspectLightscaperWindowsJobHelperCurrentV1({ path: root, sha256: 'a'.repeat(64), target: 'win-x64' }));
		await assert.rejects(inspectLightscaperWindowsJobHelperCurrentV1({ path, sha256: digest(Buffer.alloc(128)), target: 'win-x64' }));
		await assert.rejects(revalidateLightscaperWindowsJobAdmissionCurrentV1({} as LightscaperWindowsJobAdmissionCurrentV1), /Unissued/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Lightscaper Windows helper inspection refuses symlink executable authority', { skip: process.platform === 'win32' }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'lightscaper-job-symlink-'));
	try {
		const path = join(root, 'real.exe'), alias = join(root, 'alias.exe'), bytes = pe();
		await writeFile(path, bytes); await symlink(path, alias);
		await assert.rejects(inspectLightscaperWindowsJobHelperCurrentV1({ path: alias, sha256: digest(bytes), target: 'win-x64' }), /non-symlink/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});
