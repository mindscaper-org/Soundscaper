/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import TranscriptEditingPanel from '../src/common/editor/ui/workspace/TranscriptEditingPanel.tsx';
import type { TranscriptEditingWord } from '../src/common/editor/transcript-editing.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

test('deleting the final transcript word keeps keyboard focus in the visible editor', async context => {
	const dom = new JSDOM('<div id="editor"></div>', { pretendToBeVisual: true });
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
		Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
		Range: dom.window.Range, IS_REACT_ACT_ENVIRONMENT: true })) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const root = createRoot(dom.window.document.getElementById('editor')!);
	context.after(async () => {
		await act(async () => root.unmount()); dom.window.close();
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
		}
	});
	const project = { id: 'transcript-focus', revision: 0, sampleRate: 48_000 };
	let words: readonly TranscriptEditingWord[] = [{ id: 'word', text: 'Last.', speaker: null, trackId: 'track',
		trackName: 'Speech', clipId: 'clip', startFrame: 0, endFrame: 24_000, granularity: 'word', locked: false }];
	const controller = { getSnapshot: () => ({ project }), actions: {
		transcript: { read: async () => ({ projectId: project.id, revision: project.revision, words, targets: [] }),
			remove: async () => { project.revision++; words = []; } },
		timeline: { selectClip() {}, setExactSelection() {} }, transport: { seek() {} }, edit: { undo() {}, redo() {} },
	} };
	await act(async () => root.render(<TranscriptEditingPanel controller={controller} snapshot={{ project }}
		copy={ENGLISH_COPY} locale="en" fileService={{ isDesktop: false }} blocked={false} />));
	const textbox = dom.window.document.querySelector<HTMLElement>('[role="textbox"]')!;
	const word = textbox.querySelector('[data-transcript-word]')!;
	textbox.focus();
	const range = dom.window.document.createRange(); range.selectNodeContents(word);
	dom.window.getSelection()!.removeAllRanges(); dom.window.getSelection()!.addRange(range);
	await act(async () => { textbox.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })); });
	assert.equal(textbox.hidden, true);
	const active = dom.window.document.activeElement;
	assert.ok(active && active !== dom.window.document.body && dom.window.document.getElementById('editor')!.contains(active),
		'focus stays within the editor so its keyboard Undo can receive the next key');
	assert.equal(Boolean(active.closest('[hidden]')), false, 'focus cannot remain in the hidden transcript textbox');
});
