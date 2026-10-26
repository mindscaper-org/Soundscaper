/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITOR_COPY_AUDIT_INVENTORY } from '../scripts/lib/editor-copy-audit-inventory.mjs';
import { loadCommunityTranslationInventory, loadCommunityTranslationBaseline } from '../src/common/editor/ui/community-translations/community-translation-inventory.ts';
import { createContributionSnapshot, createTranslationDraft, updateTranslationDraft, previewTranslationDraft } from '../src/common/i18n/community-translations.ts';
import { emitTranslationPo } from '../src/common/i18n/community-translations-po.ts';
import { findTranslationCandidates } from '../src/common/editor/ui/community-translations/community-translation-picker.ts';

test('the opted-in translator inventories every optional surface and retains its published origin through preview and PO export', async () => {
	const inventory = await loadCommunityTranslationInventory();
	assert.deepEqual(inventory.english, EDITOR_COPY_AUDIT_INVENTORY);
	assert.equal(await loadCommunityTranslationInventory(), inventory);
	const keys = ['ui.freesoundAttribution.panel', 'ui.audiocom.searchLabel', 'ui.nyquistBundled.highPassFilterFrequency'];
	// Every lazy owner must participate even when the key names evolve.
	for (const owner of ['freesoundAttribution', 'audiocom', 'nyquistBundled']) {
		const key = Object.keys(inventory.english).find(key => key.startsWith(`ui.${owner}.`));
		assert.ok(key);
		assert.equal(inventory.metadata[key]?.owner, owner);
	}
	const { published, catalog } = await loadCommunityTranslationBaseline('de', inventory);
	const snapshot = createContributionSnapshot('de', inventory.english, published, catalog);
	for (const key of keys.slice(0, 2)) {
		const baseline = snapshot.entries[key];
		assert.ok(baseline, key);
		assert.equal(baseline.source, inventory.english[key]);
		assert.ok(findTranslationCandidates([{ text: baseline.source, attribute: 'text' }], inventory.english, published).some(candidate => candidate.key === key));
		const draft = updateTranslationDraft(createTranslationDraft(snapshot), snapshot, key, 'Übersetzungsprobe');
		assert.equal(previewTranslationDraft(draft, snapshot)[key], 'Übersetzungsprobe');
		assert.ok(emitTranslationPo(snapshot, true).includes(`msgctxt "${key}"`));
		if (catalog?.entries[key]?.[1] === baseline.source) assert.deepEqual(baseline.baselineEntry, catalog.entries[key]);
	}
});
