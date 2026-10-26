/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import WorkspacePreferencesDialog from '../src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx';
import AdvancedPreferencesPage from '../src/common/editor/ui/dialogs/AdvancedPreferencesPage.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

function renderPage(initialPage: string, productId = 'soundscaper'): string {
	return renderToStaticMarkup(<WorkspacePreferencesDialog
		controller={{ actions: { preferences: {} } }}
		snapshot={{ preferences: createAudioEditorPreferencesV1() }}
		copy={ENGLISH_COPY} locale="en" fileService={{ isDesktop: false }} menus={[]}
		run={() => undefined} initialPage={initialPage} productId={productId}
		onTogglePanel={() => undefined} onClose={() => undefined}
	/>);
}

test('Advanced offers an accessible server setting with audio.com as the default', () => {
	const markup = renderPage('advanced');
	assert.match(markup, /role="tabpanel"[^>]*aria-label="Advanced"/u);
	assert.match(markup, /type="url"[^>]*value="https:\/\/api\.audio\.com"/u);
	assert.match(markup, /Server URL/u);
	assert.match(markup, /Save server/u);
	assert.match(markup, /Use audio\.com/u);
	assert.match(markup, /connect again/u);
});

test('Advanced owns Optimize for in both products while the audio server remains Soundscaper-only', () => {
	assert.doesNotMatch(renderPage('general'), /Save server|Server URL/u);
	assert.doesNotMatch(renderPage('general'), /Optimize for/u);
	assert.doesNotMatch(renderPage('general', 'framescaper'), /Optimize for/u);
	assert.match(renderPage('advanced'), /Optimize for/u);
	assert.match(renderPage('advanced', 'framescaper'), /Optimize for/u);
	assert.doesNotMatch(renderPage('advanced', 'framescaper'), /Save server|Server URL/u);
});

test('Advanced leaves optimization unchanged until the user chooses a mode in either product', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const updates: Record<string, unknown>[] = [];
	const controller = { actions: { preferences: {
		update: async (value: Record<string, unknown>) => { updates.push(value); },
	} } };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		for (const productId of ['soundscaper', 'framescaper']) {
			await act(async () => root.render(<AdvancedPreferencesPage
				controller={controller} preferences={createAudioEditorPreferencesV1()} copy={ENGLISH_COPY}
				productId={productId} run={(operation) => { void operation(); }} />));
			const group = dom.container.querySelectorAll('[role="group"]')
				.find((candidate) => candidate.getAttribute('aria-label') === ENGLISH_COPY.optimizeFor);
			assert.ok(group);
			const trigger = group.querySelector('.dropdown__trigger');
			assert.ok(trigger);
			assert.equal(trigger.getAttribute('aria-label'), ENGLISH_COPY.optimizeFor);
			assert.ok(trigger.textContent.includes(ENGLISH_COPY.optimizeForMemory));
			assert.equal(updates.length, productId === 'soundscaper' ? 0 : 1);
			await act(async () => {
				reactProps(trigger).onClick({});
				await Promise.resolve();
				await Promise.resolve();
			});
			const option = (globalThis.document as unknown as { body: typeof dom.container }).body
				.querySelectorAll('[role="option"]')
				.find((candidate) => candidate.textContent === ENGLISH_COPY.optimizeForSpeed);
			assert.ok(option);
			await act(async () => { reactProps(option).onClick({}); await Promise.resolve(); });
		}
		assert.deepEqual(updates, [
			{ performance: { optimizeFor: 'speed' } },
			{ performance: { optimizeFor: 'speed' } },
		]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});


test('Advanced owns the waveform renderer in both products', () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		assert.match(renderPage('advanced', productId), /Waveform renderer/u);
		assert.match(renderPage('advanced', productId), />Canvas</u);
		assert.doesNotMatch(renderPage('track-display', productId), /Waveform renderer/u);
	}
});
