/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
	validateSoundscaperNativePluginStateBodyRecordV1,
	validateSoundscaperPersistedNativePluginStateBodyV1,
} from '../src/soundscaper/desktop-native-plugin-state-transport-v1.ts'

test('the retained native-state transport verifies an exact pathless record', () => {
	const bytes = Uint8Array.from([0, 1, 2, 255])
	const sha256 = createHash('sha256').update(bytes).digest('hex')
	const descriptor = {
		kind: 'native-plugin-state', bodyId: `native-plugin-state:${sha256}`, byteLength: bytes.byteLength, sha256,
	}
	assert.deepEqual(validateSoundscaperPersistedNativePluginStateBodyV1(descriptor, bytes), descriptor)
	assert.deepEqual(validateSoundscaperNativePluginStateBodyRecordV1({ ...descriptor, bytes }).bytes, bytes)
})

test('desktop native-state transport rejects digest drift and shared bytes', () => {
	const bytes = Uint8Array.from([1, 2, 3])
	const sha256 = createHash('sha256').update(bytes).digest('hex')
	assert.throws(() => validateSoundscaperNativePluginStateBodyRecordV1({
		kind: 'native-plugin-state',
		bodyId: `native-plugin-state:${sha256}`,
		byteLength: bytes.byteLength,
		sha256,
		bytes: Uint8Array.from([9, 9, 9]),
	}), /digest/iu)
	assert.throws(() => validateSoundscaperNativePluginStateBodyRecordV1({
		kind: 'native-plugin-state',
		bodyId: `native-plugin-state:${sha256}`,
		byteLength: bytes.byteLength,
		sha256,
		bytes: new Uint8Array(new SharedArrayBuffer(bytes.byteLength)),
	}), /ordinary/iu)
})

test('native-state persistence rejects a descriptor for different bytes', () => {
	const bytes = Uint8Array.from([1, 2, 3])
	const otherBytes = Uint8Array.from([4, 5, 6])
	const otherSha256 = createHash('sha256').update(otherBytes).digest('hex')
	assert.throws(() => validateSoundscaperPersistedNativePluginStateBodyV1({
		kind: 'native-plugin-state',
		bodyId: `native-plugin-state:${otherSha256}`,
		byteLength: otherBytes.byteLength,
		sha256: otherSha256,
	}, bytes), /another content identity/iu)
})
