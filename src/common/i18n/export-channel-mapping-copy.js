/**
 * Copy for the export dialog's channel choice and its mapping matrix.
 *
 * The choice is Audacity's: mono, stereo, or a custom mapping edited in its own
 * window, plus the preserve option a multichannel project needs to deliver the
 * channels it actually authored. One entry per key with both locales beside each
 * other, so a translation can never drift into a different position from the
 * string it translates.
 */
const EXPORT_CHANNEL_MAPPING_COPY_ENTRIES = Object.freeze([
	['editChannelMapping', 'Edit mapping'],
	['channelMappingApply', 'Apply'],
	['channelMappingTitle', 'Edit channel mapping'],
	['channelMappingOutputCount', 'Output channels'],
	['channelMappingInputChannel', 'Input {channel}'],
	['channelMappingOutputChannel', 'Output {channel}'],
	[
		'channelMappingCell',
		'Route input {input} to output {output}',
	],
	[
		'channelMappingMatrixHint',
		'Each checked cell routes that input to that output at unity gain. An output with nothing checked is delivered silent.',
	],
]);

export const EXPORT_CHANNEL_MAPPING_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(EXPORT_CHANNEL_MAPPING_COPY_ENTRIES.map(([key, en]) => [key, en]))),
});
