/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FRAMESCAPER_FFMPEG_CONFIGURE_FLAGS, FRAMESCAPER_FFMPEG_POLICY,
	FRAMESCAPER_FFMPEG_REQUIRED_CONFIGURATION } from '../native/framescaper-media-host/build/media-build-commands.mjs';

test('all native media-host targets include the VP9 decoder that preserves WebM alpha', () => {
	assert.ok(FRAMESCAPER_FFMPEG_CONFIGURE_FLAGS.includes('--enable-decoder=libvpx_vp9'));
	assert.ok(FRAMESCAPER_FFMPEG_POLICY.enabledDecoders.includes('libvpx-vp9'));
	assert.ok(FRAMESCAPER_FFMPEG_REQUIRED_CONFIGURATION.includes('CONFIG_LIBVPX_VP9_DECODER'));
	const recipe = JSON.parse(readFileSync(new URL('../native/framescaper-media-host/build/ffmpeg-9.0.1-configure.json', import.meta.url), 'utf8'));
	assert.deepEqual(recipe.configureFlags, [...FRAMESCAPER_FFMPEG_CONFIGURE_FLAGS]);
});
