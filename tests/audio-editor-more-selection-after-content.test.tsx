/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import GeneratorDialog from '../src/common/editor/ui/dialogs/GeneratorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { selectionControllerCustody, selectionWav } from './helpers/selection-controller-custody.tsx';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { reactProps } from './helpers/react-test-dom.ts';

for (const sampleRate of [44_100, 48_000]) test(`precise selection beyond a ${sampleRate}Hz source reaches real Silence generation and fresh Scape`, async context => {
	const input = selectionWav('one second.wav', sampleRate, 1, sampleRate);
	const f = await selectionControllerCustody(context, input);
	try {
		await f.controller.actions.timeline.selectAll();
		await f.toolbar();
		const end = f.fixture.dom.container.querySelectorAll('.timecode')[1]; assert.ok(end);
		const display = end.querySelector('.timecode__display'); assert.ok(display);
		await act(async () => { reactProps(display).onDoubleClick({}); });
		const field = end.querySelector('input'); assert.ok(field);
		await act(async () => { reactProps(field).onChange({ currentTarget: { value: '2' } }); });
		await act(async () => {
			reactProps(field).onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} }); await f.fixture.settle();
		});
		assert.deepEqual([f.controller.project?.selection.startFrame, f.controller.project?.selection.endFrame], [0, sampleRate * 2]);
		assert.equal(end.querySelector('.timecode__display')?.textContent, '00h00m02.000s');
		const before = clipboardProject(f.controller.project), entries = f.controller.getSnapshot().history.undoEntries.length;
		const original = before.clips[0]; assert.ok(original);
		const owner = before.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(original.id)); assert.ok(owner);
		assert.equal(f.controller.getSnapshot().selectedTrackId, owner.id, 'the imported mono lane retains focus');
		let closed = 0;
		await f.fixture.render(<GeneratorDialog type="silence" controller={f.controller} snapshot={f.controller.getSnapshot()}
			copy={ENGLISH_COPY} locale="en" run={f.fixture.run} onClose={() => { closed += 1; }} />);
		assert.ok(f.fixture.dom.container.querySelectorAll('.timecode__display').some(node => node.textContent === '00h00m02.000s'));
		const form = f.fixture.dom.container.querySelector('form'); assert.ok(form);
		await act(async () => {
			reactProps(form).onSubmit({ preventDefault() {} });
			// The production UI runner queues its handoff before invoking the real generator.
			await Promise.resolve(); await f.fixture.settle();
		});
		assert.equal(closed, 1);
		const after = clipboardProject(f.controller.project);
		assert.equal(f.controller.getSnapshot().history.undoEntries.length, entries + 1);
		assert.equal(after.tracks.length, 2);
		assert.equal(after.clips.length, 1);
		assert.deepEqual(after.tracks.filter(track => track.id !== owner.id), before.tracks.filter(track => track.id !== owner.id));
		for (const clip of after.clips) assert.deepEqual([clip.timelineStartFrame, clip.durationFrames, clip.sourceStartFrame, clip.sourceDurationFrames], [0, sampleRate * 2, 0, sampleRate * 2]);
		const generated = after.sources.filter(source => !before.sources.some(prior => prior.id === source.id));
		assert.equal(generated.length, 1);
		assert.equal(generated[0]?.channelCount, 1);
		for (const source of generated) assert.deepEqual([source.sampleRate, source.frameCount], [sampleRate, sampleRate * 2]);
		await act(async () => { f.controller.actions.edit.undo(); });
		assert.deepEqual(clipboardDocument(clipboardProject(f.controller.project)), clipboardDocument(before));
		await act(async () => { f.controller.actions.edit.redo(); });
		assert.deepEqual(clipboardDocument(clipboardProject(f.controller.project)), clipboardDocument(after));
		await f.archive((_name, channels) => {
			assert.equal(channels.length, 1);
			for (const channel of channels) { assert.equal(channel.length, sampleRate * 2); for (const sample of channel) assert.equal(sample, 0); }
		});
	} finally { await f.dispose(); }
});
