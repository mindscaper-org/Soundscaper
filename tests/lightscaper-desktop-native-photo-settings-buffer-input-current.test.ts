/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { captureLightscaperNativePhotoSettingCurrentV1 as capture,
	decodeLightscaperNativePhotoSettingCurrentV1 as decode } from '../desktop/lightscaper-native-photo-settings-codec-current-v1.ts';

test('Lightscaper settings decoder preserves caller Buffer bytes while retiring its private payload copy', async () => {
	const input = Buffer.from(await capture({ value: new Uint8Array([1, 2, 3]) }));
	const before = Buffer.from(input);
	const first = decode(input) as { value: Uint8Array };
	assert.deepEqual(input, before);
	const second = decode(input) as typeof first;
	first.value.fill(9); assert.deepEqual(second.value, new Uint8Array([1, 2, 3]));
	assert.deepEqual(input, before);
});
