/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import ClipSpreadsheetPanel from '../src/common/editor/ui/clip-spreadsheet/ClipSpreadsheetPanel.tsx';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { ClipSpreadsheetEdit } from '../src/common/editor/clip-spreadsheet.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const operation of ['paste paragraph', 'insert line break']) test(`multiline clip-name drafts retain native editing for ${operation}`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const descriptors = new Map(['React', 'HTMLButtonElement'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(globalThis, 'HTMLButtonElement', { configurable: true, value: class {} });
	const prototype = Object.getPrototypeOf(dom.container) as object;
	const select = Object.getOwnPropertyDescriptor(prototype, 'select');
	Object.defineProperty(prototype, 'select', { configurable: true, value: () => undefined });
	const project = applyEditorCommand(createCurrentAudioEditorProject({ id: 'paragraph-grid', sampleRate: 48_000 }), {
		type: 'batch', commands: [
			{ type: 'source/add', source: { id: 'source', storageKey: 'source', name: 'Voice.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 } },
			{ type: 'track/add', track: { id: 'voice', name: 'Voice' } },
			{ type: 'clip/add', trackId: 'voice', clip: { id: 'first', sourceId: 'source', title: 'First\nline', timelineStartFrame: 0,
				sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 } },
			{ type: 'clip/add', trackId: 'voice', clip: { id: 'second', sourceId: 'source', title: 'Keep this clip', timelineStartFrame: 48_000,
				sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 } },
		],
	});
	const edits: ClipSpreadsheetEdit[][] = [];
	let pastes = 0;
	const controller = { actions: { clip: {
		editSpreadsheet: (_id: string, values: readonly ClipSpreadsheetEdit[]) => { edits.push([...values]); },
		pasteSpreadsheet: () => { pastes++; return Promise.resolve(); },
	}, edit: { undo() {}, redo() {} } } };
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<ClipSpreadsheetPanel controller={controller} snapshot={{ project }} copy={ENGLISH_COPY} />));
		const table = dom.one('table');
		await act(async () => reactProps(dom.one('[data-column="name"]')).onDoubleClick());
		const draft = dom.one('textarea');
		let prevented = false;
		const event = { target: draft, key: 'Enter', code: 'Enter', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false,
			nativeEvent: { isComposing: false }, preventDefault() { prevented = true; }, stopPropagation() {},
			clipboardData: { getData: () => 'Revised\nparagraph' } };
		await act(async () => {
			if (operation === 'paste paragraph') reactProps(table).onPaste(event);
			else reactProps(table).onKeyDown(event);
		});
		assert.equal(prevented, false, 'native multiline editing must not become a grid paste or row navigation');
		assert.equal(pastes, 0);
		assert.equal(edits.length, 0);
		assert.equal(dom.find('textarea'), draft);
		await act(async () => reactProps(draft).onChange({ currentTarget: { value: 'Revised\nparagraph' } }));
		await act(async () => reactProps(table).onKeyDown({ ...event, shiftKey: false }));
		assert.deepEqual(edits, [[{ clipId: 'first', column: 'name', value: 'Revised\nparagraph' }]]);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		for (const [name, descriptor] of descriptors) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
		}
		if (select) Object.defineProperty(prototype, 'select', select); else Reflect.deleteProperty(prototype, 'select');
		dom.restore();
	}
});
