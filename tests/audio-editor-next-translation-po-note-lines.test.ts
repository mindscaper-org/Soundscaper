/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { po } from 'gettext-parser';
import { createContributionSnapshot, parseTranslationContribution } from '../src/common/i18n/community-translations.ts';
import { createTranslationPoManifest, emitTranslationPo } from '../src/common/i18n/community-translations-po.ts';
import { importTranslationPo } from '../scripts/community-translations-po.ts';

for (const ending of ['\r', '\r\n', '\n']) test(`PO kits preserve imported note lines separated by ${JSON.stringify(ending)}`, () => {
	const snapshot = createContributionSnapshot('fr', { save: 'Save' }, { save: 'Sauver' });
	const draft = parseTranslationContribution(JSON.stringify({ version: 1, locale: 'fr', snapshotId: snapshot.snapshotId,
		entries: [{ ...snapshot.entries.save, translation: 'Enregistrer', note: `Verb${ending}Button label` }] }));
	const output = emitTranslationPo(snapshot, false, draft.entries);
	assert.equal(po.parse(output, { validation: true }).translations.save?.Save?.comments?.translator, 'Verb\nButton label');
	assert.equal(importTranslationPo(output, createTranslationPoManifest(snapshot)).entries[0]?.note, 'Verb\nButton label');
});
