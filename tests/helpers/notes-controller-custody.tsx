/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import WorkspacePanelContent from '../../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';
import { readProjectRecordingNotes } from '../../src/common/editor/recording-notes.ts';
import { WORKSPACE_LAYOUT_COPY_BY_LOCALE } from '../../src/common/i18n/workspace-layout-copy.js';
import { reactProps } from './react-test-dom.ts';
import { mountControllerDataDom } from './controller-data-dom.ts';
import { createClipboardCustody, clipboardDocument, clipboardProject } from './clipboard-source-custody.ts';
import { assertEditedAudioArchiveCustody } from './edited-audio-archive-custody.ts';
import { COPY } from './audio-editor-controller-harness.js';

type Controller = Awaited<ReturnType<typeof createClipboardCustody>>['controller'];
type Fixture = ReturnType<typeof mountControllerDataDom>;
type Profile = Readonly<{ action: 'bold' | 'italic' | 'code'; formatted: string; element: string;
	children: readonly string[]; toggle?: boolean; selection?: readonly [number, number] }>;
function Notes({ controller, fixture }: Readonly<{ controller: Controller; fixture: Fixture }>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	return <WorkspacePanelContent panelId="recording-notes" controller={controller} snapshot={snapshot}
		copy={{ ...COPY, ...WORKSPACE_LAYOUT_COPY_BY_LOCALE.en }} locale="en" run={fixture.run} fileService={null}
		playbackMeterSettings={null} showArmControls={false} displayAudioSupported={false}
		onOpenEffects={() => assert.fail('Notes cannot open effects.')} effectsPanelTarget={null}
		onEffectWindowChange={() => assert.fail('Notes have no effect window.')} blocked={false} />;
}

/** Only DOM selection is supplied: real workspace callbacks own every edit and history publication. */
export async function assertNotesControllerCustody(context: TestContext, literal: string, profiles: readonly Profile[]) {
	const { controller, store } = await createClipboardCustody(context), fixture = mountControllerDataDom();
	const before = clipboardProject(controller.project), initialHistory = controller.getSnapshot().history.undoEntries.length;
	let start = 0, end = 0, entries = initialHistory;
	const expectNotes = (value: string) => {
		assert.equal(readProjectRecordingNotes(controller.project), value);
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), {
			...clipboardDocument(before), metadata: { ...before.metadata, recordingNotes: value },
		});
		assert.equal(controller.getSnapshot().history.undoEntries.length, entries);
	};
	try {
		await fixture.render(<Notes controller={controller} fixture={fixture} />);
		const textarea = fixture.dom.one('[data-recording-notes-editor]');
		Object.defineProperties(textarea, {
			selectionStart: { configurable: true, get: () => start }, selectionEnd: { configurable: true, get: () => end },
			setSelectionRange: { configurable: true, value: (a: number, b: number) => { start = a; end = b; } },
		});
		await act(async () => { reactProps(textarea).onChange({ currentTarget: { value: literal } }); await fixture.settle(); });
		entries++; expectNotes(literal);
		for (const profile of profiles) {
			start = 0; end = literal.length;
			const format = () => fixture.dom.one(`[data-recording-notes-format="${profile.action}"]`);
			await act(async () => { reactProps(format()).onClick(); await fixture.settle(); });
			entries++; expectNotes(profile.formatted); assert.equal(textarea.value, profile.formatted);
			if (profile.selection) assert.deepEqual([start, end], profile.selection);
			assert.equal(document.activeElement, textarea as unknown as Element);
			const preview = async () => {
				await act(async () => { reactProps(fixture.dom.one('[data-recording-notes-toggle]')).onClick(); });
				const node = fixture.dom.one('[data-recording-notes-preview]');
				assert.deepEqual(node.querySelectorAll(profile.element).map(child => child.textContent), profile.children);
				assert.equal(node.querySelectorAll('p').length, profile.children.length);
				assert.equal(node.textContent, literal.replaceAll('\n', ''));
				await act(async () => { reactProps(fixture.dom.one('[data-recording-notes-toggle]')).onClick(); });
				assert.equal(document.activeElement, textarea as unknown as Element);
			};
			await preview(); expectNotes(profile.formatted);
			if (profile.toggle !== false) {
				await act(async () => { reactProps(format()).onClick(); await fixture.settle(); });
				entries++; expectNotes(literal); assert.equal(textarea.value, literal);
				await act(async () => { controller.actions.edit.undo(); }); entries--; expectNotes(profile.formatted);
				assert.equal(textarea.value, profile.formatted);
				await act(async () => { controller.actions.edit.redo(); }); entries++; expectNotes(literal);
			} else {
				await act(async () => { controller.actions.edit.undo(); }); entries--; expectNotes(literal);
				assert.equal(textarea.value, literal);
				await act(async () => { controller.actions.edit.redo(); }); entries++; expectNotes(profile.formatted);
				await preview();
			}
		}
		const expected = profiles.at(-1)?.toggle === false ? profiles.at(-1)!.formatted : literal;
		expectNotes(expected);
		await act(async () => { await controller.actions.project.flush(); });
		const reopened = await assertEditedAudioArchiveCustody(context, store, controller.project, []);
		assert.equal(readProjectRecordingNotes(reopened), expected);
		assert.deepEqual(clipboardDocument(reopened), { ...clipboardDocument(before), metadata: { ...before.metadata, recordingNotes: expected } });
	} finally { await fixture.dispose(); }
}
