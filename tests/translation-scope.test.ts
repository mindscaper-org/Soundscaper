/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslationScope } from '../src/common/editor/ui/use-translation-scope.ts';
import { AUDIOCOM_COPY_BY_LOCALE } from '../src/common/i18n/audiocom-copy.ts';
import { loadTranslationCatalog } from '../src/common/i18n/translation-catalog.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('optional panel translations load from JSON, follow locale changes and preserve preview overrides', async () => {
	await loadTranslationCatalog('de', { englishCopy: {} });
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	function Panel({ locale, copy = {} }: { locale: string; copy?: Readonly<Record<string, string>> }) {
		const resolved = useTranslationScope('audiocom', AUDIOCOM_COPY_BY_LOCALE.en, locale, copy);
		return React.createElement('span', null, resolved.searchLabel);
	}
	try {
		await act(async () => root.render(React.createElement(Panel, { locale: 'de' })));
		assert.equal(dom.one('span').textContent, 'audio.com durchsuchen');
		await act(async () => root.render(React.createElement(Panel, {
			locale: 'de', copy: { 'ui.audiocom.searchLabel': 'Vorschau' },
		})));
		assert.equal(dom.one('span').textContent, 'Vorschau');
		await act(async () => root.render(React.createElement(Panel, { locale: 'en' })));
		assert.equal(dom.one('span').textContent, 'Search audio.com');
	} finally {
		await act(async () => root.unmount());
		dom.restore();
		environment.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
