/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { photoNativeDeploymentFixtureCurrentV1 as fixture, PHOTO_NATIVE_TEST_CURRENT_V1 as options,
	PHOTO_NATIVE_BUILD_RESULT_CURRENT_V1 as resultFile, photoNativeHashCurrentV1 as sha, verify, photoNativeTargetCurrentV1 as target } from './helpers/lightscaper-photo-native-deployment-fixture-current.ts';

/** A checksum inside an untrusted result cannot replace the independently
 * owned source/license pin. Actual member bytes and its result checksum are
 * changed together, leaving the genuine source-inventory receipt untouched. */
for (const [description, member] of [
	['owned corresponding source', 'source/LICENSE'],
	['upstream corresponding source', 'source/LibRaw-0.22.2.tar.gz'],
	['selected upstream license', 'licenses/LibRaw-LGPL.txt'],
] as const) void test(`Photo native verifier refuses self-consistently repinned ${description}`, options, async context => fixture(context, async f => {
	const expected = f.result.files.find(file => file.path === member); assert.ok(expected);
	const bytes = await readFile(join(f.buildResultRoot, member)); assert.equal(bytes.byteLength, expected.byteLength);
	bytes[0] = bytes[0]! ^ 1;
	try {
		await writeFile(join(f.buildResultRoot, member), bytes);
		const replacement = { ...f.result, files: f.result.files.map(file => file.path === member
			? { ...file, byteLength: bytes.byteLength, sha256: sha(bytes) } : file) };
		assert.equal(replacement.sourceInventorySha256, f.result.sourceInventorySha256);
		await writeFile(join(f.buildResultRoot, resultFile), `${JSON.stringify(replacement)}\n`);
		await assert.rejects(verify({ repositoryRoot: f.repositoryRoot, buildResultRoot: f.buildResultRoot, target: target() }));
	} finally { bytes.fill(0); }
}));
