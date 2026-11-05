/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { parseSubRipLabels, parseWebVttLabels, serializeSubRipLabels, serializeWebVttLabels } from '../src/common/editor/label-io.js';

test('plain label markup cannot silently become SubRip formatting on delivery', () => {
	const title = '<b>Literal</b>';
	const project = createCurrentAudioEditorProject({ sampleRate: 8000,
		tracks: [{ ...createLabelTrack({ id: 'labels', name: 'Chapters', labels: [{ id: 'label', title, startFrame: 0, endFrame: 8000 }] }) }] });
	const track = project.tracks[0]!;
	assert.ok(track.type === 'label' && Array.isArray(track.labels));
	assert.throws(() => serializeSubRipLabels(track.labels, { sampleRate: 8000 }), /SubRip.*literal.*markup.*WebVTT/u);
	const vtt = serializeWebVttLabels(track.labels, { sampleRate: 8000 });
	assert.equal(parseWebVttLabels(vtt, { sampleRate: 8000 }).labels[0]?.title, title);
});

test('ordinary SubRip label punctuation retains the existing literal entity convention', () => {
	const title = '2 < 3 &amp; stays literal';
	const text = serializeSubRipLabels([{ id: 'label', title, startFrame: 0, endFrame: 8000 }], { sampleRate: 8000 });
	assert.equal(parseSubRipLabels(text, { sampleRate: 8000 }).labels[0]?.title, title);
});
