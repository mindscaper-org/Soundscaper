/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { ExportDialog } from '../src/common/editor/ui/inspector/ExportDialog.jsx';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFixture, createAudioEditorController, createMemoryEngine, ENGLISH_COPY } from './helpers/audio-editor-nyquist-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=';
const artwork = (description: string) => JSON.stringify([{ mimeType: 'image/png', pictureType: 3, description, data: png }]);

for (const [key, inherited] of [['id3Artwork', false], ['id3Artwork', true], ['ID3ARTWORK', true], ['id3-artwork', true]] as const) {
	test(`the actual Export dialog honors explicit ${key} artwork ${inherited ? 'over an inherited picture' : 'without inherited metadata'}`, async () => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const fixture = await createFixture('next-export-artwork', { sampleRate: 48_000,
			tracks: [{ id: 'voice', name: 'Voice', input: new Float32Array(80) }] });
		const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store: fixture.store,
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		await controller.ready; await controller.actions.project.openById(fixture.project.id);
		const snapshot = controller.getSnapshot();
		assert.ok(snapshot.project);
		const projectMetadata = snapshot.project.metadata;
		assert.ok(projectMetadata && typeof projectMetadata === 'object');
		const inputProject = inherited ? { ...snapshot.project, metadata: { ...projectMetadata,
			tags: { id3Artwork: artwork('Inherited cover') } } } : snapshot.project;
		let request: Readonly<Record<string, unknown>> | null = null;
		const dialogController = { ...controller, project: inputProject, actions: { ...controller.actions,
			export: { ...controller.actions.export, start(value: Readonly<Record<string, unknown>>) { request = value; } } } };
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorReact = globals.React, priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		const click = async (element: ReactTestElement) => { await act(async () => { reactProps(element).onClick({}); }); };
		const button = (name: string) => { const found = dom.container.querySelectorAll('button').find(node => node.textContent === name || node.getAttribute('aria-label') === name); assert.ok(found); return found; };
		try {
			await act(async () => root.render(<ExportDialog isOpen controller={dialogController} snapshot={{ ...snapshot, project: inputProject }}
				copy={ENGLISH_COPY} productId="soundscaper" fileService={{ isDesktop: false }} onClose={() => undefined} />));
			await click(button(ENGLISH_COPY.metadata));
			const field = dom.one('[data-export-metadata-dialog]').querySelectorAll('label').find(node => node.textContent === ENGLISH_COPY.customMetadata)?.querySelector('textarea');
			assert.ok(field);
			await act(async () => { reactProps(field).onChange({ target: { value: JSON.stringify({ [key]: artwork('Explicit custom cover') }) } }); });
			await click(button(ENGLISH_COPY.done));
			await click(button(ENGLISH_COPY.export));
			assert.ok(request);
			const metadata = Reflect.get(request, 'metadata') as Readonly<Record<string, string>>;
			const bytes = encodeWav([new Float32Array(80)], { sampleRate: 48_000, bitDepth: 24, metadata });
			const input = new Input({ source: new BlobSource(new Blob([Uint8Array.from(bytes).buffer])), formats: ALL_FORMATS });
			try {
				const tags = await input.getMetadataTags();
				assert.equal(tags.images?.length, 1, 'the written audio must contain the explicitly requested picture');
				assert.ok(tags.images?.[0]);
				assert.equal(tags.images[0]?.description, 'Explicit custom cover');
				assert.deepEqual(Buffer.from(tags.images[0]!.data), Buffer.from(png, 'base64'));
			} finally { input.dispose(); }
		} finally {
			await act(async () => { root.unmount(); }); await controller.dispose();
			globals.React = priorReact; globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
		}
	});
}
