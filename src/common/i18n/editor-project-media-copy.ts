/* SPDX-License-Identifier: AGPL-3.0-only */

export const PROJECT_MEDIA_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({
		projectChanged: 'The project changed while its media was being trimmed.',
		archiveStreamed: 'The archive was streamed straight to its destination and never held as readable bytes.',
		archiveUnreadable: 'The written archive could not be read back: {message}',
		noArchive: 'No archive has been written yet.',
	}),
});

export const CROSS_PRODUCT_HANDOFF_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({ savedReport: '{saved}: {fileName}; {accepted} accepted, {omitted} omitted; {reportFileName}.' }),
});

export const IMPORT_STATUS_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({ notice: '{notice}' }),
});
