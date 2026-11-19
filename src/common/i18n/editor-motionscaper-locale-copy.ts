/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveEditorCopyScope } from './editor-copy-scope.ts';
import { localeLanguage } from './locale.js';
const ENTRIES = [
	['motionscaperNativeFileMenu', 'File', 'Datei'],
	['motionscaperNativeEditMenu', 'Edit', 'Bearbeiten'],
	['motionscaperNativeViewMenu', 'View', 'Ansicht'],
	['motionscaperNativeWindowMenu', 'Window', 'Fenster'],
	['motionscaperNativeLaunchErrorTitle', 'Motionscaper could not open the project', 'Motionscaper konnte das Projekt nicht öffnen'],
	['motionscaperNativeLaunchError', 'The native file launch failed.', 'Das Öffnen der Datei ist fehlgeschlagen.'],
	['motionscaperNativeStartupErrorTitle', 'Motionscaper could not start', 'Motionscaper konnte nicht starten'],
	['motionscaperNativeStartupError', 'Desktop startup failed.', 'Der Start der Desktop-Anwendung ist fehlgeschlagen.'],
	['motionscaperNativeCloseErrorTitle', 'Motionscaper could not finish closing', 'Motionscaper konnte nicht vollständig geschlossen werden'],
	['motionscaperNativeCloseError', 'Native work or temporary file cleanup failed. Motionscaper will stay open.', 'Die native Verarbeitung oder die Bereinigung temporärer Dateien ist fehlgeschlagen. Motionscaper bleibt geöffnet.'],
	['motionscaperLanguage', 'Language', 'Sprache'],
	['motionscaperLanguageHint', 'Change the interface language. Your open project and edits stay in this window.', 'Ändere die Sprache der Oberfläche. Dein geöffnetes Projekt und deine Änderungen bleiben in diesem Fenster.'],
	['motionscaperLanguageFailed', 'The language preference could not be saved. Your current language and project are unchanged.', 'Die Spracheinstellung konnte nicht gespeichert werden. Deine aktuelle Sprache und dein Projekt bleiben unverändert.'],
	['motionscaperNativeOpenTitle', 'Open Motionscaper project', 'Motionscaper-Projekt öffnen'],
	['motionscaperNativeSaveTitle', 'Save Motionscaper project', 'Motionscaper-Projekt speichern'],
	['motionscaperNativeProjectFilter', 'Scape project', 'Scape-Projekt'],
	['motionscaperNativeExportTitle', 'Export ProRes 4444', 'ProRes 4444 exportieren'],
	['motionscaperNativeMovieFilter', 'QuickTime movie', 'QuickTime-Film'],
] as const;
type LocaleCopy = Readonly<Record<typeof ENTRIES[number][0], string>>;
export const MOTIONSCAPER_LOCALE_COPY_BY_LOCALE = Object.freeze({ en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en])) as LocaleCopy), de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de])) as LocaleCopy) });
export function resolveMotionscaperLocaleCopy(locale: string, overrides: Readonly<Record<string, unknown>> = {}): LocaleCopy {
	return resolveEditorCopyScope('motionscaper-locale', localeLanguage(locale) === 'de' ? MOTIONSCAPER_LOCALE_COPY_BY_LOCALE.de : MOTIONSCAPER_LOCALE_COPY_BY_LOCALE.en, overrides);
}
