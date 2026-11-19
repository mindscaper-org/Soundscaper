/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import GeneratorDialog from '../src/common/editor/ui/dialogs/GeneratorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { reactProps } from './helpers/react-test-dom.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { createClipboardCustody, clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

type Custody = Awaited<ReturnType<typeof createClipboardCustody>>;
function Dialog({ controller, fixture, onClose }: Readonly<{ controller: Custody['controller']; fixture: ReturnType<typeof mountControllerDataDom>; onClose(): void }>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	return <GeneratorDialog type="dtmf" controller={controller} snapshot={snapshot}
		copy={ENGLISH_COPY} locale="en" run={fixture.run} onClose={onClose} />;
}

test('DTMF timing admission guards the native footer and form submission, and recovers with a legal ratio', async context => {
	const f = await createClipboardCustody(context), { controller } = f, fixture = mountControllerDataDom();
	const before = clipboardProject(controller.project), history = structuredClone(controller.getSnapshot().history);
	let closed = 0;
	const button = () => { const node = fixture.dom.container.querySelectorAll('button').find(value => value.textContent?.trim() === ENGLISH_COPY.generate); assert.ok(node); return node; };
	try {
		assert.equal(before.sources.length, 0); assert.equal(before.clips.length, 0); assert.equal(before.masterChannels, 2);
		await fixture.render(<Dialog controller={controller} fixture={fixture} onClose={() => { closed++; }} />);
		const duration = fixture.dom.one('[data-generator-field="durationSeconds"]').querySelector('[data-timecode-direct-entry]'); assert.ok(duration);
		await act(async () => { reactProps(duration).onChange({ currentTarget: { valueAsNumber: .001 } }); });
		assert.equal(fixture.dom.one('[data-generator-field="durationSeconds"]').querySelector('.timecode__display')?.textContent, '00h00m00.001s');
		const sequence = fixture.dom.one('[data-generator-field="sequence"]').querySelector('input'); assert.ok(sequence); assert.equal(sequence.value, '123');
		const duty = fixture.dom.one('[data-generator-field="dutyPercent"]').querySelector('input'); assert.ok(duty);
		await act(async () => { reactProps(duty).onChange({ target: { value: '1' } }); });
		assert.equal(duty.value, '1'); assert.equal(reactProps(button()).disabled, true);
		assert.match(fixture.dom.one('[role="alert"]').textContent, /at least one sample/u);
		await act(async () => { reactProps(fixture.dom.one('form')).onSubmit({ preventDefault() {} }); await Promise.resolve(); await fixture.settle(); });
		await act(async () => { reactProps(button()).onClick(); await Promise.resolve(); await fixture.settle(); });
		assert.deepEqual(controller.project, before); assert.deepEqual(controller.getSnapshot().history, history); assert.equal(closed, 0);
		await act(async () => { reactProps(duty).onChange({ target: { value: '100' } }); });
		assert.equal(duty.value, '100'); assert.equal(reactProps(button()).disabled, false);
		await act(async () => { reactProps(button()).onClick(); await Promise.resolve(); await fixture.settle(); });
		assert.equal(closed, 1);
		const after = clipboardProject(controller.project), source = after.sources[0], clip = after.clips[0]; assert.ok(source?.kind === 'audio'); assert.ok(clip?.kind === 'audio');
		assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [48_000, 48, 2]);
		assert.equal(after.sources.length, 1); assert.equal(after.clips.length, 1); assert.equal(after.tracks.length, 1);
		assert.deepEqual([clip.sourceId, clip.timelineStartFrame, clip.durationFrames, clip.sourceStartFrame, clip.sourceDurationFrames], [source.id, 0, 48, 0, 48]);
		assert.equal(controller.getSnapshot().history.undoEntries.length, history.undoEntries.length + 1);
		await act(async () => { controller.actions.edit.undo(); }); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
		await act(async () => { controller.actions.edit.redo(); }); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(after));
		// The declared default programme is keys 1/2/3, three 16-sample tones, duty 100, amplitude .8.
		// Each tone resets phase; the short-tone 8-sample edge ramp is independently evaluated.
		const expected = Float32Array.from({ length: 48 }, (_, frame) => {
			const tone = Math.floor(frame / 16), local = frame % 16, high = [1209, 1336, 1477][tone]!;
			const fade = Math.min(1, (local + 1) / 8, (16 - local) / 8);
			return .4 * fade * (Math.sin(2 * Math.PI * 697 * local / 48_000) + Math.sin(2 * Math.PI * high * local / 48_000));
		});
		await fixture.render(null);
		const reopened = await f.archive((name, channels) => { assert.equal(name, ENGLISH_COPY.dtmfGenerator); assertPcmChannelsEqual(channels, [expected, expected], 'all 48 generated DTMF samples in both master channels'); });
		assert.deepEqual(clipboardDocument(clipboardProject(reopened)), clipboardDocument(after));
	} finally { await fixture.dispose(); }
});
