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

test('the dialogue menu indexes sources and track membership for densely edited sessions', () => {
	const count = 400;
	let sourceReads = 0, membershipReads = 0;
	const clips = Array.from({ length: count }, (_, index) => ({ id: `cut-${index}`, sourceId: `recording-${index}`,
		timelineStartFrame: index * 4_000, durationFrames: 4_000 }));
	const clipIds = clips.map(({ id }) => id);
	const sources = clips.map(({ sourceId }) => ({ get id() { sourceReads++; return sourceId; }, channelCount: 1 }));
	const tracks = [{ id: 'dialogue', type: 'audio', get clipIds() { membershipReads++; return clipIds; } }];
	const largeEdit = { sampleRate: 8_000, clips, sources, tracks };
	assert.equal(dialogueAlignmentMenuItem({ productId: 'soundscaper', project: largeEdit, editBlocked: false,
		copy: ENGLISH_COPY, open: () => undefined })[0]?.disabled, false);
	assert.ok(sourceReads <= count * 2, `the menu revisited source identity ${sourceReads} times`);
	assert.equal(membershipReads, 1);
});
