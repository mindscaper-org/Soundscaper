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
		import('../../../i18n/lightscaper-debug-soak-copy-current-v1.ts'),
		import('../../../i18n/lightscaper-photo-linked-copy-current-v1.ts'),
		import('../../../i18n/lightscaper-photo-backend-copy-current-v1.ts'),
		import('../../../i18n/lightscaper-photo-raw-preview-copy.ts'),
		import('../../../i18n/lightscaper-photo-batch-export-menu-copy.ts'),
		import('../../../i18n/lightscaper-photo-batch-export-copy.ts'),
		import('../../../i18n/lightscaper-photo-jpeg-export-copy.ts'),
		import('../../../i18n/lightscaper-develop-soft-proof-copy.ts'),
		import('../../../i18n/lightscaper-develop-preview-renderer-copy.ts'),
		import('../../../i18n/lightscaper-photo-raster-profile-copy.ts'),
		import('../../../i18n/lightscaper-photo-png-export-copy.ts'),
		import('../../../i18n/lightscaper-photo-export-presets-copy.ts'),
		import('../../../i18n/image-export-graphic-copy.ts'),
		import('../../../i18n/image-export-text-copy.ts'),
		import('../../../i18n/image-hdr-merge-copy.ts'),
		import('../../../i18n/lightscaper-photo-framescaper-handoff-copy.ts'),
		import('../../../i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts'),
	]).then(([freesound, audiocom, nyquist, debug, linked, backend, raw, batchMenu, batch, jpeg,
		softProof, renderer, profile, png, presets, graphic, text, hdr, handoff, handoffMenu]) => {
		const owners = [
			{ owner: 'freesoundAttribution', en: freesound.FREESOUND_ATTRIBUTION_ENGLISH_COPY },
			{ owner: 'audiocom', en: audiocom.AUDIOCOM_COPY_BY_LOCALE.en },
			{ owner: 'nyquistBundled', en: nyquist.NYQUIST_BUNDLED_CONTROL_COPY },
			{ owner: 'photoDebugSoak', en: debug.photoLibraryDebugSoakCopyCurrentV1('en') },
			{ owner: 'photoLinked', en: linked.lightscaperPhotoLinkedCopyCurrentV1('en') },
			{ owner: 'photoBackend', en: backend.lightscaperPhotoBackendCopyCurrentV1('en') },
			{ owner: 'photoRawPreviewSource', en: raw.photoRawPreviewSourceCopy('en') },
			{ owner: 'photoBatchExportMenu', en: batchMenu.photoBatchExportMenuCopy('en') },
			{ owner: 'photoBatchExport', en: batch.photoBatchExportCopy('en') },
			{ owner: 'photoJpegExport', en: jpeg.photoJpegExportCopy('en') },
			{ owner: 'photoDevelopSoftProof', en: softProof.photoDevelopSoftProofCopy('en') },
			{ owner: 'photoDevelopPreviewRenderer', en: renderer.photoDevelopPreviewRendererCopy('en') },
			{ owner: 'photoRasterProfile', en: profile.photoRasterProfileCopy('en') },
			{ owner: 'photoPngExport', en: png.photoPngExportCopy('en') },
			{ owner: 'photoExportPresets', en: presets.photoExportPresetsCopy('en') },
			{ owner: 'imageExportGraphic', en: graphic.imageExportGraphicCopy('en') },
			{ owner: 'imageExportText', en: text.imageExportTextCopy('en') },
			{ owner: 'imageHdrMerge', en: hdr.imageHdrMergeCopy('en') },
			{ owner: 'photoFramescaperHandoff', en: handoff.photoFramescaperHandoffCopy('en') },
			{ owner: 'photoFramescaperReceive', en: handoff.photoFramescaperReceiveCopy('en') },
			{ owner: 'photoFramescaperCollectionHandoff', en: handoff.photoFramescaperCollectionHandoffCopy('en') },
			{ owner: 'photoFramescaperHandoffMenu', en: { download: handoffMenu.photoFramescaperHandoffMenuLabel('en'),
				receive: handoffMenu.photoFramescaperReceiveMenuLabel('en'), collection: handoffMenu.photoFramescaperCollectionHandoffMenuLabel('en') } },
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
