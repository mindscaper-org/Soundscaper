/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorMediaSearchEntries, searchAudioEditorEntries } from '../src/common/editor/search.js';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';

test('canonical image source filenames stay searchable separately from display names', () => {
	const { project, clip, source } = createFramescaperBaselineImageFixture({ imageOnly: true });
	const entries = createAudioEditorMediaSearchEntries(project);
	const image = entries.find(entry => entry.target.clipId === clip.id);
	assert.ok(image);
	assert.ok(image.terms.includes(source.original.fileName));
	assert.ok(searchAudioEditorEntries(entries, source.original.fileName).some(entry => entry.key === image.key));
	assert.ok(searchAudioEditorEntries(entries, source.name).some(entry => entry.key === image.key));
});
