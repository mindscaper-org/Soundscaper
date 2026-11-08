/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLightscaperAssociationProcessOwnerCurrentV1 } from '../scripts/lib/lightscaper-desktop-association-evidence-current-v1.ts';
import { createLightscaperNativeAssociationSmokeCurrentV1 as create } from '../scripts/lib/lightscaper-desktop-association-native-current-v1.ts';

const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform;
const target = `${platform}-${process.arch}`;
function options(root: string) {
	return { target, sourceRevision: 'a'.repeat(40), helperSha256: 'b'.repeat(64), helperPath: join(root, 'helper'),
		executablePath: process.execPath, evidenceRoot: root, profilePath: join(root, 'profile'), runtimeRoot: root, outputRoot: root,
		processOwner: createLightscaperAssociationProcessOwnerCurrentV1({ evidenceRoot: root }) };
}
void test('registered native owner refuses foreign target, incomplete source/helper identity or relative paths before app ownership', () => {
	const request = options(process.cwd());
	for (const changed of [{ ...request, target: 'other-x64' }, { ...request, sourceRevision: 'HEAD' },
		{ ...request, helperSha256: 'b'.repeat(63) }, { ...request, profilePath: '../foreign' }]) assert.throws(() => create(changed));
});
void test('registered native owner authenticates actual helper bytes before starting an app and cannot reuse the failed attempt', { timeout: 10_000 }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'lightscaper-native-association-admission-'));
	try {
		const request = options(root); await writeFile(request.helperPath, 'actual non-executable negative bytes', { flag: 'wx', mode: 0o600 });
		const owner = create(request); await assert.rejects(owner.run(), /helper bytes differ/u);
		assert.equal(owner.readersRetired, true); assert.equal(owner.registrationRetired, false);
		await assert.rejects(owner.run(), /one-use/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});
