/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE } from '../src/common/i18n/community-translations-copy.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const rawTextHook = registerHooks({ load(url, context, nextLoad) {
	if (url.endsWith('/translations/LICENSE.txt?raw')) return { format: 'module', source: "export default '';", shortCircuit: true };
	return nextLoad(url, context);
} });
const { useCommunityTranslationDraft } = await import('../src/common/editor/ui/community-translations/useCommunityTranslationDraft.ts');
rawTextHook.deregister();

for (const failure of ['malformed', 'read-error']) test(`retired translation-file ${failure} does not fail the newly chosen language`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let state: ReturnType<typeof useCommunityTranslationDraft> | null = null;
	const port = { publishedCopy: {}, getSnapshot: () => ({ locale: 'en', copy: {}, revision: 0 }),
		subscribe: () => () => undefined, applyPreview: () => undefined, resetPreview: () => undefined };
	function Harness() {
		state = useCommunityTranslationDraft(port, 'de', COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE.en);
		return null;
	}
	function current() { assert.ok(state); return state; }
	async function loaded(locale: string) {
		for (let attempt = 0; attempt < 100 && current().loaded?.snapshot.locale !== locale; attempt += 1) {
			await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
		}
		assert.equal(current().loaded?.snapshot.locale, locale);
	}
	try {
		await act(async () => root.render(<Harness />)); await loaded('de');
		let resolveRead: (value: string) => void = () => undefined;
		let rejectRead: (reason: Error) => void = () => undefined;
		const read = new Promise<string>((resolve, reject) => { resolveRead = resolve; rejectRead = reject; });
		const imported = current().importContributionFile({ text: () => read });
		const result = imported.then(value => ({ value }), (error: unknown) => ({ error }));
		await act(async () => { current().setLocale('fr'); }); await loaded('fr');
		await act(async () => {
			if (failure === 'malformed') resolveRead('{'); else rejectRead(new Error('German file read failed'));
			await result;
		});
		assert.deepEqual(await result, { value: false });
		assert.equal(current().loaded?.draft.locale, 'fr');
		await assert.rejects(current().importContributionFile({ text: async () => '{' }), SyntaxError,
			'a malformed file still reports a refusal in its own active language');
	} finally {
		await act(async () => root.unmount()); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
