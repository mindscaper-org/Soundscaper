/* SPDX-License-Identifier: AGPL-3.0-only */

import { publishedTranslationOrigin, type ContributionSnapshot, type TranslationContribution } from '../../../i18n/community-translations.ts';

interface CommunityTranslationMessageOptions {
	readonly query: string;
	readonly filter: string;
	readonly reviewKeys: ReadonlySet<string>;
	readonly locale: string;
}

export function communityTranslationMessageKeys(
	snapshot: ContributionSnapshot,
	draft: TranslationContribution,
	{ query, filter, reviewKeys, locale }: CommunityTranslationMessageOptions,
	metadata: Readonly<Record<string, Readonly<{ bundledGerman?: string }>>>,
): readonly string[] {
	const needle = query.toLocaleLowerCase();
	const changes = new Map<string, TranslationContribution['entries'][number]>();
	for (const change of draft.entries) {
		const key = change.key;
		if (!changes.has(key)) changes.set(key, change);
	}
	const changedKeys = changes.keys();
	return [...new Set([...Object.keys(snapshot.entries), ...changedKeys])].sort().filter((key) => {
		const entry = snapshot.entries[key];
		const change = changes.get(key);
		if (filter === 'changed' && !changes.has(key)) return false;
		if (filter === 'review' && !reviewKeys.has(key)) return false;
		if (filter === 'missing' && publishedTranslationOrigin(entry, locale === 'de'
			? metadata[key]?.bundledGerman : undefined) !== 'missing') return false;
		return [key, entry?.source, entry?.baselineText, change?.translation]
			.some((value) => value?.toLocaleLowerCase().includes(needle));
	});
}

/** Current draft reader shared by selected-message and option-source presentation. */
export function createCommunityTranslationDraftReader(draft: TranslationContribution | undefined) {
	const direct = (key: string) => draft?.entries.find(entry => entry.key === key);
	const entries = draft?.entries;
	if (!entries || !Object.isFrozen(entries) || entries.length > 16_384
		|| Object.getPrototypeOf(entries) !== Array.prototype || Object.hasOwn(entries, Symbol.iterator)) return direct;
	const byKey = new Map<string, TranslationContribution['entries'][number]>();
	for (let index = 0; index < entries.length; index++) {
		const slot = Object.getOwnPropertyDescriptor(entries, index);
		if (!slot || !('value' in slot)) return direct;
		const entry = slot.value as TranslationContribution['entries'][number] | null;
		if (!entry || !Object.isFrozen(entry)
			|| typeof Object.getOwnPropertyDescriptor(entry, 'key')?.value !== 'string') return direct;
		const key = entry.key;
		if (!byKey.has(key)) byKey.set(key, entry);
	}
	return (key: string) => byKey.get(key);
}
