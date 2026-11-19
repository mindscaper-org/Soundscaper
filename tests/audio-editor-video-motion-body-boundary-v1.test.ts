/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { requireVideoMotionAnalysisBodyV1 as readBody, videoMotionSettingsSha256V1 as settingsHash } from '../src/common/editor/video-motion-analysis-body-v1.ts';
import { requireVideoMotionAnalysisBodyV1 as legacyRead, videoMotionSettingsSha256V1 as legacySettings } from '../src/common/editor/video-motion-analysis-v27.ts';
import { safeScapeEntryId as bytesEntryId } from '../src/common/editor/scape-byte-stream.ts';
import { safeScapeEntryId as legacyEntryId } from '../src/common/editor/scape-archive-media.ts';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const stack = Object.freeze({ schemaVersion: 1, id: 'stack', sourceId: 'source', processors: [] });
const sourceSha = 'a'.repeat(64), expectedSettings = hash(new TextEncoder().encode(JSON.stringify(stack)));
const body = { schemaVersion: 1, analysisId: 'analysis', sourceId: 'source', processorStackId: 'stack', inputSha256: sourceSha,
	settingsSha256: expectedSettings, analysisWidth: 4, analysisHeight: 3, startFrame: 0, endFrame: 2,
	transforms: [{ frameNumber: 1, transform: { scale: 1, rotationRadians: 0, translateX: 1, translateY: 0, inlierCount: 2, meanError: 0 } }] };
const bytes = new TextEncoder().encode(JSON.stringify(body));
function reference(value: Uint8Array = bytes) {
	const sha = hash(value);
	return { schemaVersion: 1, id: 'analysis', sourceId: 'source', processorStackId: 'stack', inputSha256: sourceSha,
		settingsSha256: expectedSettings, storageKey: `motion-sha256:${sha}`, sha256: sha, byteLength: value.byteLength, startFrame: 0, endFrame: 2 };
}
const expected = { inputSha256: sourceSha, processorStack: stack };

void test('motion body byte admission preserves the exact legacy functions and independently pinned canonical bytes', () => {
	assert.equal(readBody, legacyRead); assert.equal(settingsHash, legacySettings); assert.equal(settingsHash(stack), expectedSettings);
	const before = bytes.slice(), actual = readBody(reference(), bytes, expected);
	assert.deepEqual(actual, body); assert.ok(Object.isFrozen(actual)); assert.ok(Object.isFrozen(actual.transforms)); assert.deepEqual(bytes, before);
});
void test('motion byte owner rejects corrupt bytes and stale source or settings before accepting a body', () => {
	const corrupt = bytes.slice(); corrupt[corrupt.length - 1] = 0;
	assert.throws(() => readBody(reference(), corrupt, expected));
	assert.throws(() => readBody(reference(), bytes, { ...expected, inputSha256: 'b'.repeat(64) }));
	assert.throws(() => readBody(reference(), bytes, { ...expected, processorStack: { ...stack, id: 'other-stack' } }));
});
void test('motion byte owner rejects self-consistently hashed foreign fields and noncanonical JSON', () => {
	const foreign = new TextEncoder().encode(JSON.stringify({ ...body, foreign: true }));
	assert.throws(() => readBody(reference(foreign), foreign, expected), /unsupported fields/u);
	const spaced = new TextEncoder().encode(' ' + JSON.stringify(body));
	assert.throws(() => readBody(reference(spaced), spaced, expected), /canonical JSON/u);
});
void test('narrow archive entry encoding remains one legacy-compatible function with exact escaped bytes', () => {
	assert.equal(bytesEntryId, legacyEntryId);
	for (const [input, output] of [['.', '_2E'], ['..', '_2E_2E'], ['a_b', 'a_5Fb'], ['a/b', 'a_2Fb'], ['ü', '_C3_BC']]) {
		assert.equal(bytesEntryId(input), output);
	}
});
