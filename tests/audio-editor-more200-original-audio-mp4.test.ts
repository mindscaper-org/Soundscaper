/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';
import { aacLcM4a48_000Fixture } from './helpers/os-audio-codec-fixtures.ts';

for (const extension of ['m4a', 'mp4']) test(`Original recognizes an audio-only AAC ${extension} file`, async () => {
	const file = new File([Uint8Array.from(aacLcM4a48_000Fixture())], `Recording.${extension}`, { type: 'audio/mp4' });
	const result = await resolveDesktopOriginalExportSettings(file, [{ kind: 'audio', sampleRate: 48_000, originalSampleRate: 48_000, channelCount: 2 }]);
	assert.ok(result);
	assert.equal(result.format, 'aac-m4a');
	assert.equal(result.sampleRate, 48_000);
	assert.equal(result.channelMapping, 'stereo');
});
