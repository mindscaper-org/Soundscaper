/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, createRef } from 'react';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { CommunityTranslationContributor, type CommunityTranslationContributorHandle } from '../src/common/editor/ui/community-translations/CommunityTranslationContributor.tsx';
import { createTranslationDraftStore } from '../src/common/editor/controller/preferences/translation-drafts.ts';
import { createContributionSnapshot, createTranslationDraft, parseTranslationContribution, type TranslationContribution } from '../src/common/i18n/community-translations.ts';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
test('typing a contributor keeps a large draft local until commit, exports the latest name and preserves failed-write recovery', async () => {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const snapshot = createContributionSnapshot('de', Object.fromEntries(Array.from({ length: 2000 }, (_, index) => [`key${index}`, `Source ${index}`])), {}, null);
	const draft = parseTranslationContribution({ ...createTranslationDraft(snapshot), entries: Object.values(snapshot.entries).map(entry => ({ ...entry, translation: 'Übersetzung' })) });
	let writes = 0;
	const store = createTranslationDraftStore({ loadSetting: async () => draft, persistSetting: async () => { writes++; throw new Error('Disk full'); } });
	const initial = await store.load(snapshot);
	let saves = 0;
	const save = async (value: TranslationContribution) => { saves++; await store.save(value); };
	const handle = createRef<CommunityTranslationContributorHandle>();
	try {
		await act(async () => root.render(<CommunityTranslationContributor draft={initial.draft} label="Contributor" onSave={save} onFailure={() => assert.fail('storage failures remain draft state')} handleRef={handle} />));
		for (const value of ['J', 'Ja', 'Jan', 'Jane', 'Jane ', 'Jane D', 'Jane Do', 'Jane Doe']) {
			await act(async () => { reactProps(dom.one('input')).onChange?.({ target: { value } }); });
		}
		assert.equal(saves, 0, 'no full draft parse while typing');
		assert.equal(writes, 0, 'no synchronous localStorage serialization while typing');
		assert.equal(handle.current?.getDraft().contributor, 'Jane Doe', 'export reads the latest uncommitted text');
		assert.equal(handle.current?.getDraft().entries, initial.draft.entries);
		await act(async () => { reactProps(dom.one('input')).onBlur?.(); });
		assert.equal(saves, 1);
		assert.equal(writes, 1);
		assert.equal((await store.load(snapshot)).draft.contributor, 'Jane Doe');
		assert.equal((await store.load(snapshot)).persistenceError, 'Disk full');
		await act(async () => { reactProps(dom.one('input')).onChange?.({ target: { value: 'Jane Doe Jr' } }); });
		await act(async () => root.unmount());
		assert.equal(saves, 2, 'closing without blur commits the latest name once');
		assert.equal((await store.load(snapshot)).draft.contributor, 'Jane Doe Jr');
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

test('a completed earlier save does not replace a name typed while persistence was pending', async () => {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const snapshot = createContributionSnapshot('de', { play: 'Play' }, {}, null);
	let release: () => void = () => undefined;
	const pending = new Promise<void>(resolve => { release = resolve; });
	const store = createTranslationDraftStore({ loadSetting: async () => null, persistSetting: async () => { await pending; } });
	const initial = await store.load(snapshot);
	const handle = createRef<CommunityTranslationContributorHandle>();
	function View() {
		const [draft, setDraft] = React.useState(initial.draft);
		return <CommunityTranslationContributor draft={draft} label="Contributor" handleRef={handle}
			onFailure={() => assert.fail('unexpected persistence error')} onSave={async next => {
				setDraft(next);
				const result = await store.save(next);
				setDraft(result.draft);
			}} />;
	}
	try {
		await act(async () => root.render(<View />));
		await act(async () => { reactProps(dom.one('input')).onChange?.({ target: { value: 'Jane' } }); });
		await act(async () => { reactProps(dom.one('input')).onBlur?.(); });
		await act(async () => { reactProps(dom.one('input')).onChange?.({ target: { value: 'Jane Doe' } }); });
		await act(async () => { release(); await pending; });
		assert.equal(handle.current?.getDraft().contributor, 'Jane Doe');
		await act(async () => { await handle.current?.flush(); });
		assert.equal((await store.load(snapshot)).draft.contributor, 'Jane Doe');
	} finally { release(); await act(async () => root.unmount()); dom.restore(); }
});
