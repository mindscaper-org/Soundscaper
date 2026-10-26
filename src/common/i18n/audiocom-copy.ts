/* SPDX-License-Identifier: AGPL-3.0-only */
import { UPLOAD_VALIDATION_COPY } from '../editor/ui/workspace/upload-validation-copy.ts';

import { resolveEditorCopyScope } from './editor-copy-scope.ts';

const ENGLISH = Object.freeze({
	...UPLOAD_VALIDATION_COPY,
	projectUploadCancelled: 'The upload was cancelled. The server may retain an unfinished project. Refresh the archive list before trying again.',
	projectArchiveInvalid: 'The selected project archive is invalid. Choose a complete Audacity project file.',
	projectArchiveTooLarge: 'The project archive exceeds the server size limit.',
	projectArchiveRequestFailed: 'The cloud project request failed. Check your connection and try again.',
	projectArchiveRefreshFailed: 'The project was stored, but the cloud list could not be refreshed. Refresh the list before saving again.',
	connectionError: 'The audio.com connection failed. Check your connection and try reconnecting.',
	connectionExpired: 'Your audio.com connection expired. Reconnect to continue.',
	searchRequestFailed: 'The audio.com search could not connect. Check your connection and try again.',
	searchRequestHttpFailed: 'audio.com returned HTTP {status}. Try the search again later.',
	previewFailed: 'The audio.com preview could not be played. Try again or check your listening device.',
	panel: 'audio.com', siteName: 'audio.com', searchLabel: 'Search audio.com',
	searchPlaceholder: 'Search audio', search: 'Search', searching: 'Searching audio.com',
	searchPrompt: 'Connect to audio.com to search and share audio.', noResults: 'No audio matches this search.',
	results: 'audio.com results', resultsCount: '{count} results', searchError: 'The audio.com search failed.',
	page: 'Page {page} of {pages}', pageNumber: 'Page {page}', pagination: 'audio.com result pages',
	previousPage: 'Previous', nextPage: 'Next', byInline: 'by', playPreview: 'Play preview', stopPreview: 'Stop preview',
	resultsProvidedBy: 'Results provided by', connect: 'Connect to audio.com', connecting: 'Connecting to audio.com',
	disconnect: 'Disconnect', checkingAccount: 'Checking audio.com account', connectedAs: 'Connected as {username}',
	connected: 'Connected to audio.com', accountName: 'audio.com account', uploadHeading: 'Upload to audio.com',
	uploadAudio: 'Upload audio', saveProject: 'Save project',
	openLinkError: 'The audio.com link could not be opened.',
	uploadDrop: 'Drop audio files here', chooseFiles: 'Choose audio files',
	uploadFileTypes: 'WAV, MP3, FLAC, WavPack, AIFF, OGG and M4A. Maximum 100 MB per file in Soundscaper.',
	uploadQueue: 'Audio upload queue', title: 'Title', description: 'Description', category: 'Category', license: 'License',
	visibility: 'Visibility', listed: 'Listed', unlisted: 'Unlisted',
	unlistedNotice: 'Anyone with the link can listen to unlisted audio. Unlisted audio is not private.',
	downloadable: 'Allow other people to download this audio', publish: 'Publish', publishSettings: 'Publish settings',
	cancel: 'Cancel', retry: 'Retry', remove: 'Remove', openAudio: 'Open on audio.com',
	statusDraft: 'Ready to publish', statusQueued: 'Queued', statusUploading: 'Uploading',
	statusProcessing: 'Submitted for processing', statusComplete: 'Published', statusError: 'Upload failed', statusCancelled: 'Upload cancelled',
	uploadRights: 'Upload only audio you have the rights to share.',
	uploadRightsConsent: 'I confirm that I have the rights to publish this audio.',
	uploadError: 'The audio could not be added to the upload queue.', publishError: 'The audio.com upload failed.',
	projectApiUnavailable: 'Reconnect to audio.com to authorize project saving.',
	providerServer: 'Connected storage server:', projectArchives: 'Cloud projects',
	projectArchiveNotice: 'Save project stores the open project. Saving again creates a revision of the same cloud project.',
	projectArchiveLimit: 'Maximum {size} MB per project.',
	projectArchiveSize: '{format} · {size} MB',
	refreshProjects: 'Refresh projects', projectPages: 'Cloud project pages',
	projectsLoading: 'Loading cloud projects', projectUploading: 'Uploading project',
	projectUploaded: 'Stored {name}.', noProjects: 'No cloud projects on this page.',
	categoryMusic: 'Music', categoryPodcast: 'Podcast', categoryVoiceOver: 'Voice-over', categorySoundDesign: 'Sound design',
	categoryCover: 'Cover', categoryBeats: 'Beats', categoryAudiobook: 'Audiobook', categoryRecording: 'Recording', categoryOther: 'Other',
	licenseNone: 'No license chosen', licenseArr: 'All rights reserved', licenseCc0: 'CC0', licenseCcBy: 'CC BY',
	licenseCcBySa: 'CC BY-SA', licenseCcByNc: 'CC BY-NC', licenseCcByNcSa: 'CC BY-NC-SA',
	licenseCcByNd: 'CC BY-ND', licenseCcByNcNd: 'CC BY-NC-ND',
});

export type AudiocomCopy = { readonly [Key in keyof typeof ENGLISH]: string };

export const AUDIOCOM_COPY_BY_LOCALE = Object.freeze({ en: ENGLISH });

/** Panel copy loads with the opt-in panel rather than the initial editor graph. */
export function audiocomCopy(_locale: unknown, publishedCopy: Readonly<Record<string, unknown>> = {}): AudiocomCopy {
	const base: AudiocomCopy = ENGLISH;
	return resolveEditorCopyScope('audiocom', base, publishedCopy);
}
