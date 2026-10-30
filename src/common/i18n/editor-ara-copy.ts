/* SPDX-License-Identifier: AGPL-3.0-only */

const en = Object.freeze({
	unsupportedPlugin: 'This VST3 plug-in does not support ARA 2. Choose an ARA-compatible plug-in.',
	revoked: 'Permission to use this ARA plug-in was revoked. Review the plug-in permissions before retrying.',
	sessionClosed: 'The ARA session closed. Reopen the selected clip to continue.',
	selectionChanged: 'The selected clip changed. Reopen the ARA clip editor.',
	cancelled: 'ARA clip editing was cancelled.',
	openingFailed: 'The selected clip could not be opened with this ARA plug-in.',
	editorFailed: 'The ARA plug-in editor could not be opened.',
	renderFailed: 'The edited ARA audio could not be rendered into the project.',
	discoveryFailed: 'ARA plug-ins could not be refreshed or scanned. Check the plug-in permissions.',
	operationFailed: 'The ARA operation could not be completed.',
	clipEditor: 'Edit selected clip with ARA', title: 'ARA clip editor', selectClip: 'Select an unlocked mono or stereo audio clip first.',
	plugin: 'VST3 plug-in', choosePlugin: 'Choose a plug-in', scan: 'Enable and scan VST3 folders',
	customFolder: 'Add VST3 folder', refresh: 'Refresh plug-ins', openClip: 'Open clip',
	openEditor: 'Open plug-in editor', render: 'Render to new muted track', cancel: 'Cancel',
	description: 'Edit the selected clip with an installed ARA 2 plug-in. Rendering creates a new muted audio track and preserves the original.',
	noPlugins: 'No VST3 plug-ins are available. Enable scanning or add a plug-in folder.',
	opening: 'Preparing audio for the plug-in', editing: 'The clip is ready. Open the plug-in editor, then render your changes.',
	rendering: 'Rendering edited audio', unavailable: 'The desktop ARA runtime is unavailable.',
})

export const ARA_COPY_BY_LOCALE = Object.freeze({ en })
