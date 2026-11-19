/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import ClipEffectRack from '../src/common/editor/ui/inspector/ClipEffectRack.tsx';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

test('the embedded clip rack exports its macro through the desktop save service', async context => {
	const dom = new JSDOM('<div id="editor"></div>', { pretendToBeVisual: true });
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
		Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
		getComputedStyle: dom.window.getComputedStyle.bind(dom.window), React,
		requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
		cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true })) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const written: number[] = [], saves: unknown[] = [];
	Object.assign(dom.window, { soundscaperDesktop: { v1: {
		chooseSaveTarget: async (request: unknown) => { saves.push(request); return { id: 'macro', name: 'Clip.txt' }; },
		beginWrite: async () => ({ writeId: 'write' }),
		writeChunk: async ({ bytes, offset }: { bytes: Uint8Array; offset: number }) => {
			written.push(...bytes); return { nextOffset: offset + bytes.length };
		},
		finishWrite: async () => ({ byteLength: written.length }),
	} } });
	const root = createRoot(dom.window.document.getElementById('editor')!);
	context.after(async () => {
		await act(async () => root.unmount()); dom.window.close();
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
		}
	});
	const project = createCurrentAudioEditorProject({
		sources: [{ id: 'source', storageKey: 'source', sampleRate: 48_000, frameCount: 24_000, channelCount: 1 }],
		clips: [{ id: 'clip', sourceId: 'source', title: 'Clip', durationFrames: 24_000, sourceDurationFrames: 24_000,
			effects: [createEffect('audacity-invert', { id: 'invert' })] }],
		tracks: [{ id: 'track', clipIds: ['clip'] }],
	});
	const controller = { project, actions: { effects: { presets: { list: () => [] } }, mixer: {}, track: {} } };
	await act(async () => root.render(<ClipEffectRack controller={controller}
		snapshot={{ ready: true, project }} clipId="clip" copy={ENGLISH_COPY} disabled={false} />));
	const disclosure = dom.window.document.querySelector('details')!;
	await act(async () => { disclosure.open = true; disclosure.dispatchEvent(new dom.window.Event('toggle')); });
	const button = (label: string) => {
		const found = [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')]
			.find(candidate => candidate.getAttribute('aria-label') === label);
		assert.ok(found, label); return found;
	};
	await act(async () => button('Effect stack options').click());
	const exported = [...dom.window.document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
		.find(candidate => candidate.textContent?.includes('Export as macro'));
	assert.ok(exported);
	await act(async () => exported.click());
	assert.equal(new TextDecoder().decode(Uint8Array.from(written)), 'Invert:\n');
	assert.equal(saves.length, 1);
	assert.equal(dom.window.document.querySelector('[role="alert"]')?.textContent, ENGLISH_COPY.macroExported);
});
