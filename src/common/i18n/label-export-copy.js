const LABEL_EXPORT_COPY_ENTRIES = Object.freeze([
	['exportLabelsTxt', 'As Audacity TXT'],
	['exportLabelsSrt', 'As SubRip (SRT)'],
	['exportLabelsVtt', 'As WebVTT'],
	['exportLabelsPodcastJson', 'As Podcast 2.0 chapters (JSON)'],
	['embedLabelChapters', 'Embed labels as chapters'],
	['embedLabelChaptersHint', 'Include label titles and times in the exported MP3 or M4A file. Only labels in the exported range are included. Chapter display depends on the player.'],
	['embedLabelChaptersNoLabels', 'Add a label to embed chapters in the exported file.'],
]);

export const LABEL_EXPORT_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(LABEL_EXPORT_COPY_ENTRIES.map(([key, en]) => [key, en]))),
});
