/* SPDX-License-Identifier: AGPL-3.0-only */

import { loadCommunityTranslationInventory, loadCommunityTranslationBaseline, type CommunityTranslationInventory } from './community-translation-inventory.ts';
import {
	assessTranslationContribution, createContributionSnapshot, serializeTranslationContribution,
	type ContributionSnapshot, type TranslationContribution,
} from '../../../i18n/community-translations.ts';
import { createTranslationPoManifest, emitTranslationPo } from '../../../i18n/community-translations-po.ts';
import audacityNotice from '../../../i18n/translations/NOTICE.md?raw';
import audacityLicense from '../../../i18n/translations/LICENSE.txt?raw';

export interface CommunityTranslationFileService {
	saveFile(request: { purpose: 'translation'; text?: string; bytes?: Uint8Array; mimeType: string; suggestedName: string }): Promise<unknown>;
}

export async function loadCommunityTranslationSnapshot(locale: string): Promise<{
	readonly snapshot: ContributionSnapshot;
	readonly inventory: CommunityTranslationInventory;
	readonly published: Readonly<Record<string, string>>;
}> {
	const inventory = await loadCommunityTranslationInventory();
	const { published, catalog } = await loadCommunityTranslationBaseline(locale, inventory);
	return { inventory, published, snapshot: createContributionSnapshot(locale, inventory.english, published, catalog) };
}

export async function exportCommunityTranslationJson(
	fileService: CommunityTranslationFileService,
	draft: TranslationContribution,
): Promise<void> {
	await fileService.saveFile({
		purpose: 'translation',
		text: serializeTranslationContribution(draft), mimeType: 'application/json',
		suggestedName: `soundscaper-translations-${draft.locale}.json`,
	});
}

export async function exportCommunityTranslationPo(
	fileService: CommunityTranslationFileService,
	snapshot: ContributionSnapshot,
	instructions: string,
	draft?: TranslationContribution,
): Promise<void> {
	const { zipSync, strToU8 } = await import('fflate');
	const bytes = zipSync({
		'messages.pot': strToU8(emitTranslationPo(snapshot, true)),
		'messages.po': strToU8(emitTranslationPo(snapshot, false, draft ? assessTranslationContribution(draft, snapshot).clean.map(entry => ({ ...entry, contributor: entry.contributor ?? draft.contributor })) : [])),
		'manifest.json': strToU8(createTranslationPoManifest(snapshot)),
		'README.txt': strToU8(`${instructions}\n`),
		'NOTICE.md': strToU8(audacityNotice),
		'LICENSE.txt': strToU8(audacityLicense),
	});
	await fileService.saveFile({
		purpose: 'translation',
		bytes, mimeType: 'application/zip', suggestedName: `soundscaper-translations-${snapshot.locale}.zip`,
	});
}
