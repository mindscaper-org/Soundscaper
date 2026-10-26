/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorMediaSearchEntries, searchAudioEditorEntries } from '../src/common/editor/search.js';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';

test('native timeline images are indexed as images rather than audio recordings', () => {
	const { project, clip } = createFramescaperBaselineImageFixture({ imageOnly: true });
	const entries = createAudioEditorMediaSearchEntries(project);
	const image = entries.find(entry => entry.target.clipId === clip.id);
	assert.ok(image);
	assert.ok(image.terms.includes('image'));
	assert.ok(!image.terms.includes('audio'));
	assert.ok(searchAudioEditorEntries(entries, 'image').some(entry => entry.key === image.key));
	assert.ok(!searchAudioEditorEntries(entries, 'audio').some(entry => entry.key === image.key));
});
