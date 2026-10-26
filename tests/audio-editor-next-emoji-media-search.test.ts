/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorMediaSearchEntries, flattenAudioEditorSearchMenus, searchAudioEditorEntries } from '../src/common/editor/search.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';

for (const name of ['🦊', '🇩🇪', '👩‍💻']) test(`Search finds the filename's emoji: ${name}`, () => {
	const source = createAudioSource({ id: 'source', name: `${name}.wav`, frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, sourceDurationFrames: 48_000, title: 'Recording' });
	const project = createSoundscaperProject({ sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
	const entries = [...flattenAudioEditorSearchMenus([{ label: 'File', items: [{ id: 'new', label: 'New', onClick: () => undefined }] }]),
		...createAudioEditorMediaSearchEntries(project)];
	assert.deepEqual(searchAudioEditorEntries(entries, name).map(entry => entry.key), ['timeline:clip']);
});
