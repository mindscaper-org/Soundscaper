/* SPDX-License-Identifier: AGPL-3.0-only */

import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';
import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { FREESOUND_ATTRIBUTION_ENGLISH_COPY } from '../../src/common/i18n/freesound-attribution-copy.js';
import { AUDIOCOM_COPY_BY_LOCALE } from '../../src/common/i18n/audiocom-copy.ts';
import { resolveEditorCopyScope } from '../../src/common/i18n/editor-copy-scope.ts';
import { currentTranslations } from '../../src/common/i18n/translation-catalog.js';
import { EDITOR_COPY_AUDIT_INVENTORY } from '../../scripts/lib/editor-copy-audit-inventory.mjs';
import catalog from '../../src/common/i18n/translations/de.json' with { type: 'json' };

const translations = currentTranslations(catalog, EDITOR_COPY_AUDIT_INVENTORY);
type BaseCopy = Readonly<Record<Exclude<keyof typeof catalog.entries, `ui.${string}`>, string>> & Readonly<Record<string, string>>;
export const EDITOR_GERMAN_COPY = Object.freeze({ ...EDITOR_ENGLISH_COPY, ...translations }) as BaseCopy & Readonly<Record<keyof typeof catalog.entries, string>>;
export const GERMAN_COPY = Object.freeze(Object.fromEntries(
	Object.entries(ENGLISH_COPY).map(([key, source]) => [key, translations[key] ?? source]),
)) as BaseCopy;
export const FREESOUND_GERMAN_COPY = resolveEditorCopyScope('freesoundAttribution', FREESOUND_ATTRIBUTION_ENGLISH_COPY, translations);
export const AUDIOCOM_GERMAN_COPY = resolveEditorCopyScope('audiocom', AUDIOCOM_COPY_BY_LOCALE.en, translations);

