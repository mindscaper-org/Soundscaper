/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { EDITOR_ENGLISH_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { resolveCatalog } from '../src/common/i18n/runtime.js';
import { rebaseEditorCopyOrigin } from '../src/common/i18n/editor-copy-origin.ts';
import { snapshotBootstrapCopyFields } from '../src/common/editor/ui/audio-editor-bootstrap-copy-snapshot.ts';
import { resolveEditorCopyScope } from '../src/common/i18n/editor-copy-scope.ts';
import { AUDIOCOM_COPY_BY_LOCALE } from '../src/common/i18n/audiocom-copy.ts';
import { FREESOUND_ATTRIBUTION_ENGLISH_COPY } from '../src/common/i18n/freesound-attribution-copy.js';
import { createPresentationLocalization } from '../src/common/editor/controller/shared/presentation-localization.ts';
import { useTranslationScope } from '../src/common/editor/ui/use-translation-scope.ts';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const OWNERS = { audiocom: AUDIOCOM_COPY_BY_LOCALE.en, freesoundAttribution: FREESOUND_ATTRIBUTION_ENGLISH_COPY };

for (const locale of ['en', 'de']) test(`lazy owned copy rejects unrelated ${locale} catalog meanings after spreads`, async () => {
	const catalog = await resolveCatalog(locale);
	const copy = { ...snapshotBootstrapCopyFields(catalog, 'copy', 'own data property', new Set(Object.keys(EDITOR_ENGLISH_COPY))) };
	const audio = resolveEditorCopyScope('audiocom', OWNERS.audiocom, copy);
	const freesound = resolveEditorCopyScope('freesoundAttribution', OWNERS.freesoundAttribution, copy);
	assert.equal(audio.title, OWNERS.audiocom.title);
	assert.equal(audio.noProjects, OWNERS.audiocom.noProjects);
	assert.equal(freesound.intro, OWNERS.freesoundAttribution.intro);
	assert.equal(freesound.unavailable, OWNERS.freesoundAttribution.unavailable);
	assert.deepEqual(Object.keys(copy), Object.keys(EDITOR_ENGLISH_COPY));
	assert.deepEqual(JSON.parse(JSON.stringify(copy)), Object.fromEntries(Object.entries(copy)));
});

test('custom flat and explicit namespaced overrides keep their owner through the presentation facade', async () => {
	const baseline = await resolveCatalog('de');
	assert.equal(resolveEditorCopyScope('audiocom', OWNERS.audiocom, { ...baseline, title: 'Custom title' }).title, 'Custom title');
	assert.equal(resolveEditorCopyScope('audiocom', OWNERS.audiocom, { title: 'Local title' }).title, 'Local title');
	const localization = createPresentationLocalization({ locale: 'de', englishCopy: EDITOR_ENGLISH_COPY, publishedCopy: baseline });
	const release = localization.port.registerPreviewInventory({ 'ui.audiocom.title': OWNERS.audiocom.title });
	try {
		assert.equal(resolveEditorCopyScope('audiocom', OWNERS.audiocom, { ...localization.copy }).title, OWNERS.audiocom.title);
		localization.port.applyPreview('de', { 'ui.audiocom.title': 'Titel der Vorschau' });
		assert.equal(resolveEditorCopyScope('audiocom', OWNERS.audiocom, { ...localization.copy }).title, 'Titel der Vorschau');
		localization.port.resetPreview();
		assert.equal(resolveEditorCopyScope('audiocom', OWNERS.audiocom, localization.copy).title, OWNERS.audiocom.title);
	} finally { release(); localization.dispose(); }
});


test('Framescaper product title and intro remain global meanings after its bootstrap adapter', async () => {
	const catalog = await resolveCatalog('de');
	const frames = rebaseEditorCopyOrigin({ ...catalog, title: catalog.framescaperTitle, intro: catalog.framescaperIntro });
	assert.equal(resolveEditorCopyScope('audiocom', OWNERS.audiocom, frames).title, OWNERS.audiocom.title);
	assert.equal(resolveEditorCopyScope('freesoundAttribution', OWNERS.freesoundAttribution, frames).intro, OWNERS.freesoundAttribution.intro);
});

test('core English catalog meanings and all string inventories remain unchanged', () => {
	assert.equal(ENGLISH_COPY.title, 'Soundscaper');
	assert.equal(ENGLISH_COPY.unavailable, 'unavailable');
	assert.equal(ENGLISH_COPY.noProjects, 'No saved projects yet.');
	assert.equal(ENGLISH_COPY.intro, 'Record audio, edit multiple tracks nondestructively, mix effects, and inspect loudness and frequency content.');
	assert.deepEqual(Object.keys(ENGLISH_COPY), Object.keys(Object.fromEntries(Object.entries(ENGLISH_COPY))));
});

test('lazy copy uses owned English before a failed chunk and follows later namespaced locale revisions', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const pending = deferred<Readonly<Record<string, string>> | null>();
	const german = await resolveCatalog('de');
	const loader = () => pending.promise;
	function Panel({ locale, copy }: { readonly locale: string; readonly copy: Readonly<Record<string, string>> }) {
		const audio = useTranslationScope('audiocom', OWNERS.audiocom, locale, copy, loader);
		const freesound = useTranslationScope('freesoundAttribution', OWNERS.freesoundAttribution, locale, copy, loader);
		return <span>{[audio.title, audio.noProjects, freesound.intro, freesound.unavailable].join('|')}</span>;
	}
	const expected = [OWNERS.audiocom.title, OWNERS.audiocom.noProjects, OWNERS.freesoundAttribution.intro, OWNERS.freesoundAttribution.unavailable].join('|');
	try {
		await act(async () => root.render(<Panel locale="de" copy={german} />));
		assert.equal(dom.one('span').textContent, expected);
		await act(async () => { pending.reject(new Error('Lazy catalog chunk unavailable')); await pending.promise.catch(() => undefined); });
		assert.equal(dom.one('span').textContent, expected);
		await act(async () => root.render(<Panel locale="de" copy={{ ...german, 'ui.audiocom.title': 'Titel', 'ui.freesoundAttribution.unavailable': 'Nicht erreichbar' }} />));
		assert.equal(dom.one('span').textContent, ['Titel', OWNERS.audiocom.noProjects, OWNERS.freesoundAttribution.intro, 'Nicht erreichbar'].join('|'));
		await act(async () => root.render(<Panel locale="en" copy={await resolveCatalog('en')} />));
		assert.equal(dom.one('span').textContent, expected);
	} finally { await act(async () => root.unmount()); dom.restore(); environment.IS_REACT_ACT_ENVIRONMENT = previous; }
});

test('forwarded origins reuse one descriptor until the controller publishes another snapshot', async () => {
	const baseline = await resolveCatalog('de');
	const localization = createPresentationLocalization({ locale: 'de', englishCopy: EDITOR_ENGLISH_COPY, publishedCopy: baseline });
	const key = Object.getOwnPropertySymbols(localization.copy)[0]; assert.ok(key);
	const descriptor = () => Object.getOwnPropertyDescriptor({ ...localization.copy }, key)?.value as unknown;
	try {
		const first = descriptor();
		for (let index = 0; index < 50; index += 1) assert.equal(descriptor(), first);
		localization.port.applyPreview('de', { intro: 'Eine Vorschau des Editors.' });
		const second = descriptor(); assert.notEqual(second, first);
		for (let index = 0; index < 50; index += 1) assert.equal(descriptor(), second);
		localization.port.resetPreview();
		const reset = descriptor(); assert.notEqual(reset, second);
		assert.equal(descriptor(), reset);
	} finally { localization.dispose(); }
});

test('generic catalog previews keep their source meaning while explicit caller flat overrides survive', async () => {
	const baseline = await resolveCatalog('de');
	const localization = createPresentationLocalization({ locale: 'de', englishCopy: EDITOR_ENGLISH_COPY, publishedCopy: { ...baseline, title: 'Custom audio title' } });
	const release = localization.port.registerPreviewInventory({ 'ui.freesoundAttribution.intro': OWNERS.freesoundAttribution.intro });
	try {
		localization.port.applyPreview('de', { intro: 'Eine Vorschau des Editors.', unavailable: 'Der Kanal ist nicht verfügbar.' });
		assert.equal(resolveEditorCopyScope('freesoundAttribution', OWNERS.freesoundAttribution, { ...localization.copy }).intro, OWNERS.freesoundAttribution.intro);
		assert.equal(resolveEditorCopyScope('freesoundAttribution', OWNERS.freesoundAttribution, localization.copy).unavailable, OWNERS.freesoundAttribution.unavailable);
		assert.equal(resolveEditorCopyScope('audiocom', OWNERS.audiocom, localization.copy).title, 'Custom audio title');
		localization.port.applyPreview('de', { 'ui.freesoundAttribution.intro': 'Quellen dieses Projekts.' });
		assert.equal(resolveEditorCopyScope('freesoundAttribution', OWNERS.freesoundAttribution, localization.copy).intro, 'Quellen dieses Projekts.');
		localization.port.resetPreview();
		assert.equal(resolveEditorCopyScope('freesoundAttribution', OWNERS.freesoundAttribution, localization.copy).intro, OWNERS.freesoundAttribution.intro);
		assert.equal(resolveEditorCopyScope('audiocom', OWNERS.audiocom, localization.copy).title, 'Custom audio title');
	} finally { release(); localization.dispose(); }
});
