/* SPDX-License-Identifier: AGPL-3.0-only */
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as profile } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { visualProjectOptions } from './framescaper-unified-render-project-fixture.ts';
import { framescaperV20Options } from './framescaper-model-fixture.ts';
import { normalizeVideoProxyAttachmentV18 } from '../../src/common/editor/video-proxy-attachment-v18.ts';
import { reconcileFramescaperProjectFeatureRequirementsAssistance } from '../../src/framescaper/editor-project-feature-requirements-assistance.ts';
import { validateFramescaperProject } from '../../src/framescaper/editor-project.ts';

type Data = Record<string, unknown>;
export { profile };

export function generatorCatalog(count: number) {
	const options = visualProjectOptions();
	const source = ((options.visualModel as Data).generatorSources as Data[])[0]!;
	options.visualModel = { generatorSources: [source] };
	options.clips = Array.from({ length: count }, (_, index) => ({ schemaVersion: 1, kind: 'generator', id: `visual-${index}`,
		sourceId: source.id, sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10 }));
	const template = (options.tracks as Data[])[0]!;
	const tracks = Array.from({ length: count }, (_, index) => ({ ...template, id: `track-${index}`, name: `Track ${index}`, clipIds: [`visual-${index}`] }));
	options.tracks = tracks;
	(options.sequences as Data[])[0]!.trackIds = tracks.map(track => track.id);
	options.sources = []; options.projectBin = { clips: [] }; options.videoTransitionsByTrackId = {};
	options.selection = { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] };
	return createFramescaperProject(profile, options);
}

export function proxyCatalog(count: number) {
	const options = framescaperV20Options();
	const source = (options.sources as Data[])[0]!, clip = (options.clips as Data[])[0]!;
	options.sources = Array.from({ length: count }, (_, index) => ({ ...source, id: `source-${index}`, storageKey: `source-${index}`, contentSha256: (index + 1).toString(16).padStart(64, '0') }));
	const clips = Array.from({ length: count }, (_, index) => ({ ...clip, id: `video-${index}`, sourceId: `source-${index}`, sequenceStartFrame: index * 10 }));
	options.clips = clips; options.projectBin = { clips: [] };
	options.tracks = [{ ...(options.tracks as Data[])[0], clipIds: clips.map(clip => clip.id) }];
	(options.sequences as Data[])[0]!.trackIds = [(options.tracks as Data[])[0]!.id];
	options.selection = { trackIds: [], clipIds: [], startFrame: 0, endFrame: 0 };
	const project = structuredClone(createFramescaperProject(profile, options)) as unknown as Data;
	project.sources = (project.sources as Data[]).map((source, index) => {
		const sha = (index + 1000).toString(16).padStart(64, '0'), timing = (index + 2000).toString(16).padStart(64, '0');
		return { ...source, proxyAttachment: normalizeVideoProxyAttachmentV18({ kind: 'video-proxy-attachment', version: 1,
			rule: 'exact-original-generation-proxy-content-and-timing-v1', storageKey: `video-proxy-sha256:${sha}`, mimeType: 'video/mp4', byteLength: 1024,
			sha256: sha, originalSha256: source.contentSha256, originalAuthorityKind: 'owned', generatorId: 'ffmpeg', generatorVersion: 1,
			recipeId: 'framescaper-video-proxy-h264-540-v1', recipeVersion: 1, timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
			frameCount: 10, boundaryCount: 11, timingAsset: { encoding: 'soundscaper-video-timing-v1', storageKey: `video-timing-sha256:${timing}`,
				sha256: timing, sourceSha256: sha, byteLength: 112, frameCount: 10, timescale: 1000, finalFrameDurationTicks: '100' }, audioPolicy: 'ignore-proxy-container-audio-v1' }) };
	});
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsAssistance(profile, project);
	validateFramescaperProject(profile, project);
	return project;
}

export function freezeCatalog<Value>(value: Value): Value {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freezeCatalog(child);
		Object.freeze(value);
	}
	return value;
}
