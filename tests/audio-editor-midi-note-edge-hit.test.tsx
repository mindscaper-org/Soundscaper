/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NoteRect, type NoteEdge } from '../vendor/audacity-design-system/components/src/NoteRect/NoteRect.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('note resize hit testing uses current bounds after a pan without another mousemove', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const edges: NoteEdge[] = [];
	try {
		await act(async () => root.render(<NoteRect note={{ id: 1, pitch: 60, velocity: 100 }} x={0} y={0} width={50} height={16}
			isSelected onMouseDown={(_event, _note, edge) => { edges.push(edge); }} />));
		const note = dom.one('[data-note-id="1"]');
		let left = 0;
		note.getBoundingClientRect = () => ({ left, top: 0, right: left + 50, bottom: 16, x: left, y: 0, width: 50, height: 16 });
		const pointer = { currentTarget: note, clientX: 25, stopPropagation() {} };
		await act(async () => { reactProps(note).onMouseMove?.(pointer); });
		left = -23;
		await act(async () => { reactProps(note).onMouseDown?.(pointer); });
		left = 23;
		await act(async () => { reactProps(note).onMouseDown?.(pointer); });
		assert.deepEqual(edges, ['right', 'left']);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('the minimum-width note keeps center movement and both resize edges', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const edges: NoteEdge[] = [];
	try {
		await act(async () => root.render(<NoteRect note={{ id: 1, pitch: 60, velocity: 100 }} x={0} y={0} width={2} height={16}
			isSelected onMouseDown={(_event, _note, edge) => { edges.push(edge); }} />));
		const note = dom.one('[data-note-id="1"]');
		note.getBoundingClientRect = () => ({ left: 0, width: 4 });
		for (const clientX of [0, 2, 3.9]) await act(async () => {
			reactProps(note).onMouseDown?.({ currentTarget: note, clientX, stopPropagation() {} });
		});
		assert.deepEqual(edges, ['left', 'body', 'right']);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
