/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import { formatRecordingNotes } from '../src/common/editor/recording-notes-markdown.ts';
import WorkspacePanelContent from '../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';
import { readProjectRecordingNotes } from '../src/common/editor/recording-notes.ts';
import { WORKSPACE_LAYOUT_COPY_BY_LOCALE } from '../src/common/i18n/workspace-layout-copy.js';
import { reactProps } from './helpers/react-test-dom.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { createClipboardCustody, clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { assertEditedAudioArchiveCustody } from './helpers/edited-audio-archive-custody.ts';
import { COPY } from './helpers/audio-editor-controller-harness.js';

for (const format of ['heading', 'bullets', 'numbered-list'] as const) {
	test(`${format} preserves selected blank separators and removes only its own block markers`, () => {
		const literal = 'First take\n\nSecond take';
		const expected = format === 'heading' ? '# First take\n\n# Second take'
			: format === 'bullets' ? '- First take\n\n- Second take' : '1. First take\n\n2. Second take';
		const formatted = formatRecordingNotes(literal, 0, literal.length, format, 'Placeholder');
		assert.equal(formatted.value, expected);
		assert.equal(formatRecordingNotes(formatted.value, formatted.selectionStart,
			formatted.selectionEnd, format, 'Placeholder').value, literal);
		assert.equal(formatRecordingNotes('', 0, 0, format, 'Placeholder').value.includes('Placeholder'), true);
		assert.equal(formatRecordingNotes('\n\n', 0, 2, format, 'Placeholder').value, '\n\n');
	});
}

type Controller = Awaited<ReturnType<typeof createClipboardCustody>>['controller'];
type Fixture = ReturnType<typeof mountControllerDataDom>;
function Notes({ controller, fixture }: Readonly<{ controller: Controller; fixture: Fixture }>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	return <WorkspacePanelContent panelId="recording-notes" controller={controller} snapshot={snapshot}
		copy={{ ...COPY, ...WORKSPACE_LAYOUT_COPY_BY_LOCALE.en }} locale="en" run={fixture.run} fileService={null}
		playbackMeterSettings={null} showArmControls={false} displayAudioSupported={false}
		onOpenEffects={() => assert.fail('Recording notes must not open effects.')} effectsPanelTarget={null}
		onEffectWindowChange={() => assert.fail('Recording notes have no effect window.')} blocked={false} />;
}

test('the mounted Numbered list action does not invent a note in the selected empty paragraph', async context => {
	const { controller, store } = await createClipboardCustody(context);
	const before = clipboardProject(controller.project), initialHistory = controller.getSnapshot().history.undoEntries.length;
	const fixture = mountControllerDataDom();
	let start = 0, end = 0;
	const literal = 'First take\n\nSecond take', numbered = '1. First take\n\n2. Second take';
	const expectNotes = (value: string, entries: number) => {
		const project = clipboardProject(controller.project);
		assert.equal(readProjectRecordingNotes(project), value);
		assert.deepEqual(clipboardDocument(project), { ...clipboardDocument(before), metadata: { ...before.metadata, recordingNotes: value } });
		assert.equal(controller.getSnapshot().history.undoEntries.length, initialHistory + entries);
	};
	try {
		await fixture.render(<Notes controller={controller} fixture={fixture} />);
		const textarea = fixture.dom.one('[data-recording-notes-editor]');
		Object.defineProperties(textarea, {
			selectionStart: { configurable: true, get: () => start }, selectionEnd: { configurable: true, get: () => end },
			setSelectionRange: { configurable: true, value: (nextStart: number, nextEnd: number) => { start = nextStart; end = nextEnd; } },
		});
		await act(async () => { reactProps(textarea).onChange({ currentTarget: { value: literal } }); await fixture.settle(); });
		expectNotes(literal, 1); assert.equal(textarea.value, literal);
		start = 0; end = literal.length;
		const format = () => fixture.dom.one('[data-recording-notes-format="numbered-list"]');
		await act(async () => { reactProps(format()).onClick(); await fixture.settle(); });
		expectNotes(numbered, 2); assert.equal(textarea.value, numbered);
		await act(async () => { reactProps(fixture.dom.one('[data-recording-notes-toggle]')).onClick(); });
		const preview = fixture.dom.one('[data-recording-notes-preview]');
		assert.deepEqual(preview.querySelectorAll('li').map(item => item.textContent), ['First take', 'Second take']);
		assert.equal(preview.textContent, 'First takeSecond take'); expectNotes(numbered, 2);
		await act(async () => { reactProps(fixture.dom.one('[data-recording-notes-toggle]')).onClick(); });
		assert.equal(textarea.value, numbered); start = 0; end = numbered.length;
		await act(async () => { reactProps(format()).onClick(); await fixture.settle(); });
		expectNotes(literal, 3); assert.equal(textarea.value, literal);
		for (const expected of [numbered, literal]) {
			await act(async () => { controller.actions.edit.undo(); });
			assert.equal(readProjectRecordingNotes(controller.project), expected); assert.equal(textarea.value, expected);
		}
		for (const expected of [numbered, literal]) {
			await act(async () => { controller.actions.edit.redo(); });
			assert.equal(readProjectRecordingNotes(controller.project), expected); assert.equal(textarea.value, expected);
		}
		expectNotes(literal, 3);
		await act(async () => { await controller.actions.project.flush(); });
		const reopened = await assertEditedAudioArchiveCustody(context, store, controller.project, []);
		assert.equal(readProjectRecordingNotes(reopened), literal);
		assert.deepEqual(clipboardDocument(reopened), { ...clipboardDocument(before), metadata: { ...before.metadata, recordingNotes: literal } });
	} finally { await fixture.dispose(); }
});
