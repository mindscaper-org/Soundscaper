/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { ExportDialog } from '../src/common/editor/ui/inspector/ExportDialog.jsx';
import { DELIVERY_PRESETS_SETTING_KEY } from '../src/common/editor/controller/export/delivery-preset-service.ts';
import { createFixture, createCurrentAudioEditorProject, createAudioEditorController, createMemoryEngine, ENGLISH_COPY } from './helpers/audio-editor-nyquist-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { deferred, settle } from './helpers/async-test-control.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const operation of ['save', 'delete'] as const) {
	test(`a pending preset ${operation} cannot block or change the replacement project's preset selection`, async () => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const fixture = await createFixture('next-preset-owner', { sampleRate: 44_100,
			tracks: [{ id: 'voice', name: 'Voice', input: new Float32Array(80) }] });
		const incoming = createCurrentAudioEditorProject({ ...fixture.project, id: 'incoming-preset-project', title: 'Incoming preset project' });
		await fixture.store.saveProject(incoming);
		const held = deferred<void>(), started = deferred<void>(), completed = deferred<void>();
		let delay = false;
		const saveSetting = fixture.store.saveSetting.bind(fixture.store);
		fixture.store.saveSetting = async (...args: Parameters<typeof fixture.store.saveSetting>) => {
			if (delay && args[0] === DELIVERY_PRESETS_SETTING_KEY) { started.resolve(); await held.promise; }
			const result = await saveSetting(...args);
			if (delay && args[0] === DELIVERY_PRESETS_SETTING_KEY) completed.resolve();
			return result;
		};
		const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store: fixture.store,
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		await controller.ready;
		await controller.actions.project.openById(fixture.project.id);
		await controller.actions.export.presets.save({ label: 'First preset', kind: 'audio', format: 'wav' });
		await controller.actions.export.presets.save({ label: 'Second preset', kind: 'audio', format: 'wav' });
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorReact = globals.React, priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		const render = async () => {
			await act(async () => root.render(<ExportDialog isOpen controller={controller} snapshot={controller.getSnapshot()}
				copy={ENGLISH_COPY} productId="soundscaper" fileService={{ isDesktop: false }} onClose={() => undefined} />));
		};
		const click = async (element: ReactTestElement) => { await act(async () => { reactProps(element).onClick({}); }); };
		const bar = () => dom.one('[data-delivery-preset-bar]');
		const trigger = () => { const found = bar().querySelector('.dropdown__trigger'); assert.ok(found); return found; };
		const choose = async (label: string) => {
			await click(trigger());
			const option = (document.body as unknown as ReactTestElement).querySelectorAll('[role="option"]').find(node => node.textContent.includes(label));
			assert.ok(option); await click(option);
		};
		try {
			await render();
			await choose('First preset');
			delay = true;
			if (operation === 'delete') {
				const button = bar().querySelectorAll('button').find(node => node.getAttribute('aria-label') === ENGLISH_COPY.deleteEffectPreset);
				assert.ok(button); await click(button);
			} else {
				const button = bar().querySelectorAll('button').find(node => node.getAttribute('aria-label') === ENGLISH_COPY.saveEffectPreset);
				assert.ok(button); await click(button);
				const item = (document.body as unknown as ReactTestElement).querySelectorAll('[role="menuitem"]').find(node => node.textContent === ENGLISH_COPY.saveEffectPreset);
				assert.ok(item); await click(item);
			}
			await started.promise;
			await controller.actions.project.openById(incoming.id);
			await render();
			assert.equal(Boolean((reactProps(trigger()) as Readonly<Record<string, unknown>>).disabled), false,
				'the replacement project must not wait for old preset storage');
			await choose('Second preset');
			assert.ok(trigger().textContent.includes('Second preset'), 'the replacement project can choose its own preset before the old write finishes');
			await act(async () => { held.resolve(); await completed.promise; await settle(); });
			assert.ok(trigger().textContent.includes('Second preset'), 'the old preset completion must retain the new choice');
			assert.equal(controller.project?.id, incoming.id);
		} finally {
			held.resolve();
			await act(async () => { await settle(); root.unmount(); });
			await controller.dispose();
			globals.React = priorReact; globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}
