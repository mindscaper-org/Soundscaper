/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject, type AudioEditorProjectCurrentOptions } from './project-current.ts';
import { addAup4CompatibilityItem, type createAup4CompatibilityReport } from './aup4-profile.js';

/** Recovery may omit native-only XML; the editor's document limits still apply. */
export function createAudacityEditingProject(options: AudioEditorProjectCurrentOptions,
	context: Readonly<{ recover: boolean; report: ReturnType<typeof createAup4CompatibilityReport> }>,
) {
	try { return createCurrentAudioEditorProject(options); }
	catch (error) {
		if (!context.recover || !(error instanceof RangeError)
			|| error.message !== 'Scape literal-key inspection exceeds the project node limit.') throw error;
	}
	const sources = options.sources?.map(source => omitNativeXml(source, ['aup4Sequence', 'aup4ChannelSequences']));
	const compactClip = (clip: Readonly<Record<string, unknown>>) => omitNativeXml(clip, ['aup4WaveClip', 'aup4WaveClips']);
	const project = createCurrentAudioEditorProject({ ...options, sources, clips: options.clips?.map(compactClip),
		...(options.projectBin ? { projectBin: { ...options.projectBin,
			clips: Array.isArray(options.projectBin.clips) ? options.projectBin.clips.map(compactClip) : [] } } : {}) });
	addAup4CompatibilityItem(context.report, { code: 'RECOVERY_NATIVE_CLIP_METADATA_OMITTED', severity: 'warning', disposition: 'omitted',
		scope: { kind: 'project' }, data: { originalFilePreserved: true },
		message: 'Audacity-only clip XML and original sample-block boundary hints were omitted to fit the project document limits. Editable audio, clip timing, envelopes and track state were retained. Keep the original for native-only clip fields.' });
	return project;
}

function omitNativeXml(value: Readonly<Record<string, unknown>>, names: readonly string[]): Readonly<Record<string, unknown>> {
	const opaque = value.opaqueExtensions;
	if (!opaque || typeof opaque !== 'object' || Array.isArray(opaque)) return value;
	return { ...value, opaqueExtensions: Object.fromEntries(Object.entries(opaque).filter(([name]) => !names.includes(name))) };
}
