/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createContributionSnapshot, createTranslationDraft, updateTranslationDraft } from '../src/common/i18n/community-translations.ts';
import { communityTranslationMessageKeys } from '../src/common/editor/ui/community-translations/community-translation-message-filter.ts';

test('missing translations exclude current same-source Audacity and machine translations', () => {
	const snapshot = createContributionSnapshot('de', {
		pause: 'Pause', untranslated: 'English fallback', bundled: 'OK',
	}, { pause: 'Pause', untranslated: 'English fallback', bundled: 'OK' }, {
		locale: 'de', entries: { pause: ['audacity', 'Pause', 'Pause'], bundled: ['machine', 'OK', 'OK'] },
	});
	const keys = communityTranslationMessageKeys(snapshot, createTranslationDraft(snapshot), {
		query: '', filter: 'missing', reviewKeys: new Set(), locale: 'de',
	});
	assert.deepEqual(keys, ['untranslated']);
});

test('the contributor can find a Turkish published string using its native lowercase spelling', () => {
	const snapshot = createContributionSnapshot('tr', { action: 'Operation' }, { action: 'İŞLEM' });
	const keys = communityTranslationMessageKeys(snapshot, createTranslationDraft(snapshot), {
		query: 'işlem', filter: 'all', reviewKeys: new Set(), locale: 'tr',
	});
	assert.deepEqual(keys, ['action']);
});

test('searching Changed can find the old English wording and baseline from an imported draft', () => {
	const old = createContributionSnapshot('de', { action: 'Open tape' }, { action: 'Band öffnen' });
	const current = createContributionSnapshot('de', { action: 'Open audio' }, { action: 'Audio öffnen' });
	const draft = updateTranslationDraft(createTranslationDraft(old), old, 'action', 'Ton aufrufen');
	for (const query of ['Open tape', 'Band öffnen']) {
		assert.deepEqual(communityTranslationMessageKeys(current, draft, {
			query, filter: 'changed', reviewKeys: new Set(['action']), locale: 'de',
		}), ['action']);
	}
});

test('search matches precomposed query characters against equivalent imported Unicode', () => {
	const snapshot = createContributionSnapshot('fr', { action: 'Preview' }, { action: 'Aperçu' });
	const draft = updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'action', 'Ve\u0301rification');
	assert.deepEqual(communityTranslationMessageKeys(snapshot, draft, {
		query: 'Vérification', filter: 'changed', reviewKeys: new Set(), locale: 'fr',
	}), ['action']);
});
