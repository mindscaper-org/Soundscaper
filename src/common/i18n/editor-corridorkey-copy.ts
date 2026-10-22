/* SPDX-License-Identifier: AGPL-3.0-only */
const ENGLISH = Object.freeze({
	title: 'CorridorKey 2.0',
	description: 'Remove a green screen from the selected video clip. The complete source is processed while this clip keeps its trims and retiming.',
	supported: 'Currently supports short, opaque video sources with a constant frame rate in display-referred SDR. The source duration limit depends on its resolution. Existing alpha, HDR, and scene-linear sources are unavailable.',
	unavailable: 'CorridorKey 2.0 is not available in this build. Its model download will appear here when publication is ready.',
	run: 'Key selected clip', decoding: 'Decoding source frames', running: 'Keying source frames',
	encoding: 'Encoding transparent video', publishing: 'Adding keyed video to the project',
	selectVideo: 'Select one video clip to key.',
	hintTitle: 'Alpha hint', hintEnabled: 'Run Chroma Key first',
	hintDescription: 'Use the normal Chroma Key matte to guide CorridorKey. The original colors are passed to the model.',
	hintColor: 'Key color', similarity: 'Similarity', softness: 'Softness', hintQuality: 'Hint strength',
});
const GERMAN: Readonly<Record<keyof typeof ENGLISH, string>> = {
	title: 'CorridorKey 2.0',
	description: 'Entferne einen Greenscreen aus dem ausgewählten Videoclip. Die vollständige Quelle wird verarbeitet; Zuschnitt und Zeitänderungen dieses Clips bleiben erhalten.',
	supported: 'Unterstützt derzeit kurze, undurchsichtige Videoquellen mit konstanter Bildrate in darstellungsbezogenem SDR. Die maximale Quelldauer hängt von der Auflösung ab. Vorhandenes Alpha, HDR und szenenlineare Quellen sind nicht verfügbar.',
	unavailable: 'CorridorKey 2.0 ist in dieser Version nicht verfügbar. Der Modelldownload erscheint hier, sobald die Veröffentlichung bereit ist.',
	run: 'Ausgewählten Clip freistellen', decoding: 'Quellbilder dekodieren', running: 'Quellbilder freistellen',
	encoding: 'Transparentes Video kodieren', publishing: 'Freigestelltes Video zum Projekt hinzufügen',
	selectVideo: 'Wähle einen Videoclip zum Freistellen aus.',
	hintTitle: 'Alpha-Vorgabe', hintEnabled: 'Zuerst Chroma Key ausführen',
	hintDescription: 'Verwende die normale Chroma-Key-Maske als Vorgabe für CorridorKey. Das Modell erhält die ursprünglichen Farben.',
	hintColor: 'Schlüsselfarbe', similarity: 'Ähnlichkeit', softness: 'Weichheit', hintQuality: 'Stärke der Vorgabe',
};
export function resolveCorridorKeyCopy(locale: string) { return locale.toLowerCase().startsWith('de') ? GERMAN : ENGLISH; }
