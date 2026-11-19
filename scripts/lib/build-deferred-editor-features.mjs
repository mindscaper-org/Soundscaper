/* SPDX-License-Identifier: AGPL-3.0-only */
import { editorPath } from './build-chunk-tests.mjs';

// Optional implementations keep their own load boundaries even when the broad
// editor domain and controller groups also match their paths.
const featureModules = {
	timecode: String.raw`(?:controller[\\/]transport[\\/](?:internal[\\/])?timecode-sync-(?:browser|session|ports)|timecode-(?:sync-format|mtc|ltc(?:-worklet)?))\.ts`,
	'midi-authoring': String.raw`(?:controller[\\/]track-audio[\\/](?:midi-service|internal[\\/]midi-(?:file-delivery|source-publication|transfer-publication|warp-note-growth))|midi-file-(?:destinations|delivery-report|note-releases)|midi-project-(?:event-projection|interchange|performance-state))\.ts`,
	'waveform-gpu': String.raw`controller[\\/]source[\\/](?:internal[\\/])?waveform-gpu-[a-z-]+\.ts`,
	'overwrite-audio': String.raw`desktop-original-(?:export-settings|mpeg-settings|audio-bit-rate|flac-settings|wavpack-settings|audio-capability|m4a-movie)\.ts`,
	ara: String.raw`(?:controller[\\/]effects[\\/](?:ara-edit-session|internal[\\/]ara-clip-editing)|ara-(?:failure|contract|clip-editing-runtime))\.ts`,
	'dialogue-alignment': String.raw`(?:controller[\\/]track-audio[\\/]internal[\\/]dialogue-alignment-(?:service|preview)|dialogue-alignment-worker-client)\.ts`,
	'microphone-bleed': String.raw`(?:controller[\\/]effects[\\/]internal[\\/]microphone-bleed-service|microphone-bleed(?:-envelope|-worker-client)?)\.ts`,
	'embedded-metadata': String.raw`(?:ape-(?:metadata-reader|tag-location)|imported-(?:media-metadata|metadata-reader)|aiff-imported-metadata|riff-(?:imported-metadata|metadata-read-view)|m4a-embedded-chapters|ogg-flac-metadata-read-view|opus-initial-granule)\.ts`,
	'video-keyframe-export': String.raw`(?:video-keyframe-(?:audio-input|execution-engine|encoder-(?:execution|stream)|webcodecs-execution|video-(?:container(?:-stream)?|output|operation|encoder(?:-admission)?))|video-retime-html-video-seek-port)\.ts`,
	blender: String.raw`(?:controller[\\/]export[\\/]blender-(?:live-session|publication)|blender-contract)\.ts`,
	'import-codec-inspection': String.raw`(?:matroska-opus-end-padding|iso-audio-presentation-edit|controller[\\/]import[\\/]raw-pcm-detection)\.ts`,
	'clip-fades': String.raw`ui[\\/]timeline[\\/]ClipFadesDialog\.tsx`,
};

/** @type {Array<{ name: string, test: RegExp, priority: number, minSize: number, maxSize: number, includeDependenciesRecursively: false }>} */
export const deferredEditorFeatureChunks = Object.entries(featureModules).map(([feature, pattern]) => ({
	name: `editor-${feature}`,
	test: new RegExp(`${editorPath}${pattern}$`, 'u'),
	priority: 109,
	minSize: 0,
	maxSize: 250_000,
	includeDependenciesRecursively: false,
}));
