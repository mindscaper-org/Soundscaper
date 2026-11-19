/* SPDX-License-Identifier: AGPL-3.0-only */
const EN = Object.freeze({ menu: 'Develop input', original: 'Original precision', preview: 'Cached preview (offline)',
	notice: 'Editing an 8-bit preview derivative at preview resolution. Full-resolution output and RAW recovery require the Original.' });
const DE = Object.freeze({ menu: 'Entwicklungseingabe', original: 'Originalgenauigkeit', preview: 'Gespeicherte Vorschau (offline)',
	notice: 'Bearbeitung eines 8-Bit-Vorschauderivats in Vorschauauflösung. Für die volle Ausgabeauflösung und RAW-Wiederherstellung ist das Original erforderlich.' });
export function photoDevelopInputQualityCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN; }
