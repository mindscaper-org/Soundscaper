/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { captureLightscaperNativePhotoLibraryRestorePhotoCurrentV1 as capture } from '../desktop/lightscaper-native-photo-library-restore-source-policy-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { canonicalPhotoDocumentJsonV1 } from '../src/lightscaper/catalog/photo-document-json-v1.ts';
import { scopePhotoCurrentV1 } from './helpers/lightscaper-native-library-scope-integration-fixture-current.ts';

const digest = (value: unknown): string => createHash('sha256').update(canonicalPhotoDocumentJsonV1(value)).digest('hex');
for (const retention of ['linked', 'managed'] as const) void test(`Native restore policy v1 preserves ${retention} archived identity and binds both full Original descriptors`, () => {
	const seed = scopePhotoCurrentV1().photo, input = normalizePhotoDocumentCurrentV1({ ...seed, original: { ...seed.original, retention } });
	const before = digest(input), result = capture(input);
	assert.equal(digest(input), before); assert.equal(digest(result.source), before);
	const expected = normalizePhotoDocumentCurrentV1({ ...input, original: { ...input.original, retention: 'managed' } });
	assert.equal(digest(result.photo), digest(expected)); assert.equal(result.photo.original.retention, 'managed');
	assert.deepEqual(Object.keys(result).sort(), ['photo', 'policy', 'source']);
	assert.deepEqual(result.policy, { schemaVersion: 1, kind: 'native-photo-library-restore-source-policy',
		profile: 'embedded-originals-as-managed-copies/v1', sourceOriginalSha256: digest(input.original),
		destinationOriginalSha256: digest(expected.original), converted: retention === 'linked' });
	assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.policy), true);
	assert.equal(Object.isFrozen(result.source), true); assert.equal(Object.isFrozen(result.photo), true);
	if (retention === 'linked') assert.notEqual(result.policy.sourceOriginalSha256, result.policy.destinationOriginalSha256);
	else assert.equal(result.policy.sourceOriginalSha256, result.policy.destinationOriginalSha256);
});
