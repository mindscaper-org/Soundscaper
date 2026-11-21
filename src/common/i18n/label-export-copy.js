const LABEL_EXPORT_COPY_ENTRIES = Object.freeze([
	['exportLabelsTxt', 'As Audacity TXT'],
	['exportLabelsSrt', 'As SubRip (SRT)'],
	['exportLabelsVtt', 'As WebVTT'],
	['exportLabelsPodcastJson', 'As Podcast 2.0 chapters (JSON)'],
	['embedLabelChapters', 'Embed chapters'],
	['embedLabelChaptersHint', 'Write the selected markers or labels as chapters or cues in the exported file. Display depends on the player.'],
	['embedLabelChaptersNoLabels', 'Add markers or labels in the export range to embed chapters.'],
	['embeddedChapterTrack', 'Chapter track'],
	['embeddedChapterAllLabelTracks', 'All label tracks'],
]);

export const LABEL_EXPORT_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(LABEL_EXPORT_COPY_ENTRIES.map(([key, en]) => [key, en]))),
});
