/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { dialogueAlignmentMenuItem } from '../src/common/editor/ui/dialogue-alignment-menu.ts';
import { dialogueAlignmentTargets } from '../src/common/editor/dialogue-alignment-targets.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

const project = { sampleRate: 8000, sources: [{ id: 'source', channelCount: 1 }],
	clips: ['a', 'b'].map(id => ({ id, sourceId: 'source', timelineStartFrame: 0, durationFrames: 8000 })),
	tracks: [{ id: 'track', type: 'audio', clipIds: ['a', 'b'] }] };

test('dialogue menu is Soundscaper-only and requires two eligible clips and writable editing', () => {
	let opened = 0;
	const input = { productId: 'soundscaper', project, editBlocked: false, copy: ENGLISH_COPY, open: () => { opened++; } };
	const menu = dialogueAlignmentMenuItem(input);
	assert.equal(menu[0]?.id, 'align-dialogue'); assert.equal(menu[0]?.disabled, false);
	menu[0]?.onClick(); assert.equal(opened, 1);
	assert.equal(dialogueAlignmentMenuItem({ ...input, editBlocked: true })[0]?.disabled, true);
	assert.deepEqual(dialogueAlignmentMenuItem({ ...input, productId: 'framescaper' }), []);
	assert.equal(dialogueAlignmentMenuItem({ ...input, project: { ...project, clips: project.clips.slice(0, 1) } })[0]?.disabled, true);
});

test('dialogue admission excludes frozen, locked, linked, missing and oversized clips', () => {
	assert.equal(dialogueAlignmentTargets(project).length, 2);
	for (const changes of [{ locked: true }, { audioFreeze: {} }]) {
		assert.equal(dialogueAlignmentTargets({ ...project, tracks: [{ ...project.tracks[0]!, ...changes }] }).length, 0);
	}
	for (const changes of [{ avLinkId: 'linked' }, { durationFrames: 8000 * 31 }, { kind: 'video' }, { anchor: 'musical' }]) {
		assert.equal(dialogueAlignmentTargets({ ...project, clips: project.clips.map(clip => ({ ...clip, ...changes })) }).length, 0);
	}
	assert.equal(dialogueAlignmentTargets({ ...project, sources: [{ ...project.sources[0]!, missing: true }] }).length, 0);
});
