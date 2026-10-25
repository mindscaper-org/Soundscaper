/* SPDX-License-Identifier: AGPL-3.0-only */

const en = Object.freeze({
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
