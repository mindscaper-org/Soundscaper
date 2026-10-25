/* SPDX-License-Identifier: AGPL-3.0-only */

import { SITE_SIDEBAR_COPY_BY_LOCALE } from './site-sidebar-copy.js';

const SITE_COPY_ENTRIES = Object.freeze([
	['framescaperEyebrow', 'Local video editing'],
	['framescaperTitle', 'Framescaper'],
	['framescaperIntro', 'Edit video and sound nondestructively, combine layers and effects, and export the finished video.'],
	['framescaperMetaDescription', 'Beta: A browser-based video editor inspired by Audacity 4.'],
	['eyebrow', 'Local multitrack audio editing'],
	['title', 'Soundscaper'],
	['intro', 'Record audio, edit multiple tracks nondestructively, mix effects, and inspect loudness and frequency content.'],
	['privacy', 'Your recordings, projects, and audio files stay on this device and are processed entirely in your browser.'],
	['metaDescription', "It's practically Audacity 4 in the browser! Includes more features, completely private & open source"],
	['introExpand', 'Show introduction'],
	['introCollapse', 'Hide introduction'],
	['workspace', 'Workspace'],
	['workspaceModern', 'Soundscaper'],
	['workspaceAudacity', 'Audacity'],
	['workspaceMusic', 'Music'],
	['workspaceClassic', 'Classic'],
	['workspaceVideo', 'Video editor'],
	['loading', 'Loading project'],
	['loadingEditorFiles', 'Loading editor files'],
	['preparingEditor', 'Preparing editor'],
	['genericError', 'The action failed: {message}'],
	['staleBuildTitle', 'Editor is out of date'],
	['staleBuildMessage', 'A newer version of the editor has been published, so this function can no longer be loaded. Reload to get the current version. Your project stays saved on this device.'],
	['staleBuildCancel', 'Cancel'],
	['staleBuildReload', 'Reload'],
]);

export const SITE_COPY_BY_LOCALE = deepFreeze({
	en: {
		...Object.fromEntries(SITE_COPY_ENTRIES.map(([key, en]) => [key, en])),
		...SITE_SIDEBAR_COPY_BY_LOCALE.en,
	},
});

export function bundledSiteCopyForLocale(_locale = 'en') {
	return SITE_COPY_BY_LOCALE.en;
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
