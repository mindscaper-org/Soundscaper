/* SPDX-License-Identifier: AGPL-3.0-only */
import { EDITOR_ENGLISH_COPY, getEditorCopyMetadata, type EditorCopyMetadata } from '../../../i18n/editor-copy-inventory.ts';
import { currentTranslations } from '../../../i18n/translation-catalog.js';
import { TRANSLATION_CATALOG_LOADERS } from '../../../i18n/translations/index.js';
import type { ContributionCatalog } from '../../../i18n/community-translations.ts';

export interface CommunityTranslationInventory {
	readonly english: Readonly<Record<string, string>>;
	readonly metadata: Readonly<Record<string, EditorCopyMetadata>>;
}
let pending: Promise<CommunityTranslationInventory> | null = null;

/** Optional panel copy is loaded only after the contributor opens this surface. */
export function loadCommunityTranslationInventory(): Promise<CommunityTranslationInventory> {
	pending ??= Promise.all([
		import('../../../i18n/freesound-attribution-copy.js'),
		import('../../../i18n/audiocom-copy.ts'),
		import('../dialogs/nyquist-bundled-control-copy.ts'),
	]).then(([freesound, audiocom, nyquist]) => {
		const owners = [
			{ owner: 'freesoundAttribution', en: freesound.FREESOUND_ATTRIBUTION_ENGLISH_COPY },
			{ owner: 'audiocom', en: audiocom.AUDIOCOM_COPY_BY_LOCALE.en },
			{ owner: 'nyquistBundled', en: nyquist.NYQUIST_BUNDLED_CONTROL_COPY },
		];
		const english: Record<string, string> = { ...EDITOR_ENGLISH_COPY };
		const metadata: Record<string, EditorCopyMetadata> = { ...getEditorCopyMetadata() };
		for (const { owner, en } of owners) for (const [localKey, source] of Object.entries(en)) {
			const key = `ui.${owner}.${localKey}`;
			english[key] = source;
			metadata[key] = Object.freeze({ key, owner, source });
		}
		return Object.freeze({
			english: Object.freeze(english),
			metadata: Object.freeze(metadata),
		});
	}).catch((error: unknown) => { pending = null; throw error; });
	return pending;
}

export async function loadCommunityTranslationBaseline(locale: string, inventory: CommunityTranslationInventory) {
	const loaders = TRANSLATION_CATALOG_LOADERS as Readonly<Record<string, (() => Promise<unknown>) | undefined>>;
	const module = await loaders[locale]?.() ?? null;
	const raw = module && typeof module === 'object' && 'default' in module ? module.default : module;
	const catalog = raw as ContributionCatalog | null;
	const published = Object.freeze({ ...inventory.english, ...(catalog ? currentTranslations(catalog, inventory.english, { locale }) : {}) });
	return { published, catalog };
}
