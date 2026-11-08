/* SPDX-License-Identifier: AGPL-3.0-only */
const EN = Object.freeze({ title: 'Library debug soak', files: 'Tiny raster and RAW files', run: 'Run 3 rounds', stop: 'Stop and join', close: 'Close',
	help: 'Opt-in real-library diagnostic. Choose a tiny raster and RAW corpus (up to 32 files, 64 MiB total, one megapixel per rendered image). Three rounds import photos, search, save a reversible exposure edit, export and read back a lossless PNG, restore the recipe, and close/reopen the library. Imported diagnostic photos and their history remain in this library. Private PNG outputs are removed.',
	measurement: 'Elapsed phases and live-owner counts describe this diagnostic. Browser JS heap is measured only when its actual API is available; it is not process RSS. This is not a performance release gate or camera certification.',
	failed: 'The diagnostic stopped or failed. Known imported photos remain. A cleanup failure keeps the workspace fenced; restart before continuing.',
	report: 'Diagnostic report', progress: 'Diagnostic phase' });
type Copy = { readonly [Key in keyof typeof EN]: string };
const DE: Copy = Object.freeze({ title: 'Bibliotheks-Diagnoselauf', files: 'Kleine Raster- und RAW-Dateien', run: '3 Runden starten', stop: 'Stoppen und Bereinigung abwarten', close: 'Schließen',
	help: 'Freiwillige Diagnose in der tatsächlichen Bibliothek. Wähle kleine Raster- und RAW-Dateien (höchstens 32 Dateien, zusammen 64 MiB, ein Megapixel je gerendertem Bild). Drei Runden importieren Fotos, suchen, speichern eine umkehrbare Belichtungsänderung, exportieren und prüfen ein verlustfreies PNG, stellen das Rezept wieder her und öffnen die Bibliothek nach dem Schließen erneut. Importierte Diagnosefotos und ihr Verlauf bleiben erhalten. Private PNG-Ausgaben werden entfernt.',
	measurement: 'Phasenzeiten und aktive Besitzer beziehen sich auf diese Diagnose. Der Browser-JS-Heap wird nur über eine verfügbare tatsächliche API gemessen; dies ist kein Prozess-RSS. Dies ist weder eine Leistungsfreigabe noch eine Kamerazertifizierung.',
	failed: 'Die Diagnose wurde gestoppt oder ist fehlgeschlagen. Bestätigte Fotoimporte bleiben erhalten. Bei fehlgeschlagener Bereinigung bleibt der Arbeitsbereich gesperrt; starte vor dem Fortfahren neu.',
	report: 'Diagnosebericht', progress: 'Diagnosephase' });
export function photoLibraryDebugSoakCopyCurrentV1(locale: string): Copy { return locale === 'de' ? DE : EN; }
