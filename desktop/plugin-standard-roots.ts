/* SPDX-License-Identifier: AGPL-3.0-only */

interface StandardRootTemplate {
	readonly name: string;
	readonly base: 'system' | 'home';
	readonly path: string;
}

function templates(...entries: StandardRootTemplate[]): readonly StandardRootTemplate[] {
	return Object.freeze(entries);
}

/** Keyed `${platform}:${format}`; an absent key offers nothing, never throws. */
export const STANDARD_PLUGIN_ROOTS: Readonly<Record<string, readonly StandardRootTemplate[]>> = Object.freeze({
	'darwin:vst2': templates(
		{ name: 'System VST2 folder', base: 'system', path: '/Library/Audio/Plug-Ins/VST' },
		{ name: 'User VST2 folder', base: 'home', path: 'Library/Audio/Plug-Ins/VST' },
	),
	'darwin:vst3': templates(
		{ name: 'System VST3 folder', base: 'system', path: '/Library/Audio/Plug-Ins/VST3' },
		{ name: 'User VST3 folder', base: 'home', path: 'Library/Audio/Plug-Ins/VST3' },
	),
	'darwin:clap': templates(
		{ name: 'System CLAP folder', base: 'system', path: '/Library/Audio/Plug-Ins/CLAP' },
		{ name: 'User CLAP folder', base: 'home', path: 'Library/Audio/Plug-Ins/CLAP' },
	),
	'darwin:au': templates(
		{ name: 'System Audio Units folder', base: 'system', path: '/Library/Audio/Plug-Ins/Components' },
		{ name: 'User Audio Units folder', base: 'home', path: 'Library/Audio/Plug-Ins/Components' },
	),
	'darwin:vamp': templates(
		{ name: 'System Vamp folder', base: 'system', path: '/Library/Audio/Plug-Ins/Vamp' },
		{ name: 'User Vamp folder', base: 'home', path: 'Library/Audio/Plug-Ins/Vamp' },
	),
	'linux:vst2': templates(
		{ name: 'System VST2 folder', base: 'system', path: '/usr/lib/vst' },
		{ name: 'Local VST2 folder', base: 'system', path: '/usr/local/lib/vst' },
		{ name: 'User VST2 folder', base: 'home', path: '.vst' },
	),
	'linux:vst3': templates(
		{ name: 'System VST3 folder', base: 'system', path: '/usr/lib/vst3' },
		{ name: 'Local VST3 folder', base: 'system', path: '/usr/local/lib/vst3' },
		{ name: 'User VST3 folder', base: 'home', path: '.vst3' },
	),
	'linux:clap': templates(
		{ name: 'System CLAP folder', base: 'system', path: '/usr/lib/clap' },
		{ name: 'Local CLAP folder', base: 'system', path: '/usr/local/lib/clap' },
		{ name: 'User CLAP folder', base: 'home', path: '.clap' },
	),
	'linux:lv2': templates(
		{ name: 'System LV2 folder', base: 'system', path: '/usr/lib/lv2' },
		{ name: 'Local LV2 folder', base: 'system', path: '/usr/local/lib/lv2' },
		{ name: 'User LV2 folder', base: 'home', path: '.lv2' },
	),
	'linux:ladspa': templates(
		{ name: 'System LADSPA folder', base: 'system', path: '/usr/lib/ladspa' },
		{ name: 'Local LADSPA folder', base: 'system', path: '/usr/local/lib/ladspa' },
		{ name: 'User LADSPA folder', base: 'home', path: '.ladspa' },
	),
	'linux:vamp': templates(
		{ name: 'System Vamp folder', base: 'system', path: '/usr/lib/vamp' },
		{ name: 'Local Vamp folder', base: 'system', path: '/usr/local/lib/vamp' },
		{ name: 'User Vamp folder', base: 'home', path: 'vamp' },
	),
	'win32:vst2': templates(
		{ name: 'Steinberg VST2 folder', base: 'system', path: 'C:\\Program Files\\Steinberg\\VstPlugins' },
		{ name: 'VST2 Plugins folder', base: 'system', path: 'C:\\Program Files\\VstPlugins' },
		{ name: 'Common VST2 folder', base: 'system', path: 'C:\\Program Files\\Common Files\\VST2' },
	),
	'win32:vst3': templates(
		{ name: 'Common VST3 folder', base: 'system', path: 'C:\\Program Files\\Common Files\\VST3' },
	),
	'win32:clap': templates(
		{ name: 'Common CLAP folder', base: 'system', path: 'C:\\Program Files\\Common Files\\CLAP' },
	),
	'win32:vamp': templates(
		{ name: 'Vamp Plugins folder', base: 'system', path: 'C:\\Program Files\\Vamp Plugins' },
	),
});
