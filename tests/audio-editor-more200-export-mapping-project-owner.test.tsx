/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { ExportDialog } from '../src/common/editor/ui/inspector/ExportDialog.jsx';
import { createFixture, createCurrentAudioEditorProject, createAudioEditorController, createMemoryEngine, ENGLISH_COPY } from './helpers/audio-editor-nyquist-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('a channel mapping draft cannot be applied to a project opened while its editor is visible', async () => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const fixture = await createFixture('more200-export-mapping-owner', { sampleRate: 48_000,
		tracks: [{ id: 'voice', name: 'Voice', input: new Float32Array(80) }] });
	const incoming = createCurrentAudioEditorProject({ ...fixture.project, id: 'mapping-incoming',
		title: 'Incoming six channel project', masterChannels: 6 });
	await fixture.store.saveProject(incoming);
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store: fixture.store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	await controller.ready;
	await controller.actions.project.openById(fixture.project.id);
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = globals.React, priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async () => act(async () => root.render(<ExportDialog isOpen controller={controller}
		snapshot={controller.getSnapshot()} copy={ENGLISH_COPY} productId="soundscaper"
		fileService={{ isDesktop: false }} onClose={() => undefined} />));
	const click = async (element: ReactTestElement) => act(async () => { reactProps(element).onClick({}); });
	try {
		await render();
		const custom = dom.one('[data-export-channel-option="custom"]').querySelector('input');
		assert.ok(custom);
		await act(async () => { reactProps(custom).onChange({}); });
		const edit = dom.one('[data-export-channel-action="edit-mapping"]').querySelector('button');
		assert.ok(edit); await click(edit);
		assert.ok(dom.find('[data-export-channel-mapping]'));
		const route = dom.one('[data-export-channel-mapping-cell="0-0"]').querySelector('[role="checkbox"]');
		assert.ok(route); await click(route);
		await controller.actions.project.openById(incoming.id);
		await render();
		assert.equal(controller.project?.id, incoming.id);
		assert.equal(dom.find('[data-export-channel-mapping]'), null,
			'the old project mapping must retire before it can overwrite incoming channel delivery');
		const preserve = dom.one('[data-export-channel-option="preserve"]').querySelector('input');
		assert.ok(preserve); assert.equal(preserve.checked, true);
	} finally {
		await act(async () => root.unmount());
		await controller.dispose();
		globals.React = priorReact; globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
