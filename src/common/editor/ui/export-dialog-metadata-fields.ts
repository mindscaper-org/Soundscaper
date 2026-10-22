/* SPDX-License-Identifier: AGPL-3.0-only */

interface MetadataSettings {
	readonly metadataTitle: string;
	readonly metadataArtist: string;
	readonly metadataAlbum: string;
	readonly metadataTrack: string;
	readonly metadataYear: string;
	readonly metadataGenre: string;
	readonly metadataComments: string;
	readonly metadataCopyright: string;
	readonly metadataArtwork: string;
}

/** Visible standard fields own their values; explicit custom artwork replaces inheritance. */
export function exportDialogMetadataFields(
	settings: MetadataSettings,
	custom: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	const hasArtwork = Object.keys(custom).some(key => key.toLowerCase().replace(/[^a-z0-9]/gu, '') === 'id3artwork');
	return {
		...custom,
		title: settings.metadataTitle,
		artist: settings.metadataArtist,
		album: settings.metadataAlbum,
		trackNumber: settings.metadataTrack,
		year: settings.metadataYear,
		genre: settings.metadataGenre,
		comments: settings.metadataComments,
		copyright: settings.metadataCopyright,
		...(hasArtwork ? {} : { id3Artwork: settings.metadataArtwork }),
	};
}
