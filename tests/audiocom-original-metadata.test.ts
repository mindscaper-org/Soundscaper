/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAudio } from '../functions/api/audiocom/_shared/contracts.ts';
import { providerConfiguration } from '../functions/api/audiocom/_shared/provider-config.ts';

test('only Audiocity identifies playback as the original source format', () => {
	const common = { title: 'Rain', username: 'recorder', author_name: 'Recorder', slug: 'rain', description: '', license: 'none', is_downloadable: false,
		source: { mime: 'audio/x-wavpack' } };
	const official = normalizeAudio({ ...common, id: '123', play: { duration: 1500, url: 'https://s3.audio.com/audio/123.mp3' } });
	assert.equal(official.previewMime, undefined);
	const provider = providerConfiguration({ AUDIOCOM_PROVIDER: 'audiocity', AUDIOCOM_API_ORIGIN: 'https://audio.example.org' });
	const id = '34c792f3-f4bb-44e8-8b0a-314210b4d933';
	const local = normalizeAudio({ ...common, id, play: { duration: 0, url: `https://audio.example.org/media/${id}?expires=1792080000&signature=${'s'.repeat(43)}` } }, provider);
	assert.equal(local.previewMime, 'audio/x-wavpack');
	assert.equal(local.durationSeconds, 0);
	assert.equal(local.url, `https://audio.example.org/audio/${id}/play`);
});
