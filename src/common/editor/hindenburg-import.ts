/* SPDX-License-Identifier: AGPL-3.0-only */

import { parseXmlDocument, childElements, type XmlElement } from './dawproject-xml.ts';
import { normalizeProjectSampleRate } from './project-sample-rate.ts';
import { hindenburgTime, hindenburgRequired, hindenburgNumber, hindenburgGain, hindenburgFlag,
	hindenburgMediaPath, hindenburgChild, hindenburgLocalNames } from './hindenburg-import-values.ts';
import { timelineImportIssue, TIMELINE_INTERCHANGE_MAXIMUM_BYTES, TIMELINE_INTERCHANGE_MAXIMUM_DEPTH,
	TIMELINE_INTERCHANGE_MAXIMUM_ITEMS, type TimelineInterchangeDocument, type TimelineInterchangeTrack,
	type TimelineInterchangeClip, type TimelineInterchangeMedia } from './timeline-interchange-types.ts';

const REGION_ATTRIBUTES = new Set(['Ref', 'Name', 'Start', 'Length', 'Offset', 'Gain', 'ClipGain', 'Muted', 'FadeIn', 'FadeOut', 'IsMusic', 'UseTranscription']);

/** Observed Lite/PRO/Narrator NHSX audio cuts. No vendor implementation or DSP is bundled. */
export function parseHindenburgDocument(text: string): TimelineInterchangeDocument {
	const root = hindenburgLocalNames(parseXmlDocument(text, { maximumBytes: TIMELINE_INTERCHANGE_MAXIMUM_BYTES,
		maximumDepth: TIMELINE_INTERCHANGE_MAXIMUM_DEPTH, maximumElements: TIMELINE_INTERCHANGE_MAXIMUM_ITEMS,
		maximumTextBytes: 2 * 1024 * 1024 }, { allowedSimpleDoctype: 'Session' }));
	if (root.name !== 'Session') throw new SyntaxError('A Hindenburg session must start with <Session>.');
	const sampleRate = normalizeProjectSampleRate(hindenburgNumber(hindenburgRequired(root, 'Samplerate')));
	const pool = hindenburgChild(root, 'AudioPool', true)!;
	const trackRoot = hindenburgChild(root, 'Tracks', true)!;
	const info = hindenburgChild(root, 'Info');
	const issues: TimelineInterchangeDocument['issues'][number][] = [];
	const reported = new Set<string>();
	const report = (code: string, message: string, converted = false) => {
		if (reported.has(code)) return;
		reported.add(code);
		issues.push(timelineImportIssue('hindenburg', code, message, converted ? 'converted' : 'omitted'));
	};
	const unknownChildren = (node: XmlElement, allowed: readonly string[]) => {
		for (const child of node.children) if (!allowed.includes(child.name)) {
			report('unknown-element-omitted', `Unsupported Hindenburg elements, including ${child.name}, are not imported.`);
		}
	};
	const poolPath = hindenburgMediaPath(pool.attributes.Path ?? '');
	const media = new Map<string, TimelineInterchangeMedia>();
	for (const file of childElements(pool, 'File')) {
		const id = hindenburgRequired(file, 'Id');
		if (media.has(id)) throw new SyntaxError('Duplicate Hindenburg source ID.');
		const name = hindenburgRequired(file, 'Name');
		hindenburgMediaPath(name);
		const relative = hindenburgMediaPath(file.attributes.Path ?? name);
		if (!relative) throw new SyntaxError('Hindenburg media path must not be empty.');
		const path = hindenburgMediaPath([poolPath, relative].filter(Boolean).join('/'));
		media.set(id, { id, name, path, kind: 'audio',
			...(file.attributes.Duration ? { duration: hindenburgTime(file.attributes.Duration) } : {}) });
		if (hindenburgChild(file, 'Transcription')) report('transcription-omitted', 'Source transcripts and speaker alignment are not imported.');
		const metadata = hindenburgChild(file, 'MetaData');
		if (metadata && Object.keys(metadata.attributes).some(key => key !== 'OriginalPath')) report('metadata-omitted', 'Metadata other than the session title is not imported.');
		if (Object.keys(file.attributes).some(key => !['Id', 'Name', 'Path', 'Duration', 'Channels', 'Leq', 'Dyn'].includes(key))) {
			report('source-controls-omitted', 'Additional Hindenburg source controls are not imported.');
		}
		unknownChildren(file, ['MetaData', 'Transcription']);
	}
	const tracks: TimelineInterchangeTrack[] = [];
	for (const [index, track] of childElements(trackRoot, 'Track').entries()) {
		if (track.attributes.Type && track.attributes.Type.toLowerCase() !== 'audio') {
			report('track-omitted', 'Non-audio Hindenburg tracks are not imported.'); continue;
		}
		const clips: TimelineInterchangeClip[] = [];
		for (const [regionIndex, region] of childElements(track, 'Region').entries()) {
			if (region.children.some(child => child.name === 'Region') || Object.keys(region.attributes).some(key => !REGION_ATTRIBUTES.has(key))) {
				report('region-omitted', 'Compound regions and regions with unsupported controls are not imported.'); continue;
			}
			const mediaId = hindenburgRequired(region, 'Ref');
			if (!media.has(mediaId)) throw new ReferenceError('Hindenburg region references an unavailable audio source.');
			const duration = hindenburgTime(hindenburgRequired(region, 'Length'));
			if (duration.num <= 0) throw new RangeError('Hindenburg region length must be positive.');
			const fadeIn = hindenburgTime(region.attributes.FadeIn), fadeOut = hindenburgTime(region.attributes.FadeOut);
			clips.push({ id: `${index}:${regionIndex}`, name: region.attributes.Name ?? '', mediaId,
				start: hindenburgTime(region.attributes.Start), duration, sourceStart: hindenburgTime(region.attributes.Offset),
				gain: hindenburgGain(region.attributes.ClipGain ?? region.attributes.Gain), muted: hindenburgFlag(region.attributes.Muted), fadeIn, fadeOut });
			if (fadeIn.num || fadeOut.num) report('fade-curve-converted', 'Fade lengths are retained using the editor fade curve; Hindenburg fade curvature is not retained.', true);
			if (childElements(region, 'Fade').length) report('ducking-omitted', 'Hindenburg volume ramps and ducking envelopes are not imported; review affected clip levels.');
			unknownChildren(region, ['Fade']);
		}
		const pan = hindenburgNumber(track.attributes.Pan);
		if (pan !== 0) report('pan-law-converted', 'Pan direction is converted to the editor convention; Hindenburg stereo balance and pan law may sound different.', true);
		if (track.attributes.Volume !== undefined && track.attributes.Gain !== undefined) {
			report('track-gain-omitted', 'A track carrying both Volume and legacy Gain uses Volume; the additional gain control is not imported.');
		}
		tracks.push({ id: `track-${index}`, name: track.attributes.Name ?? '', kind: 'audio', clips,
			gain: hindenburgGain(track.attributes.Volume ?? track.attributes.Gain), pan: -Math.max(-1, Math.min(1, pan)),
			mute: hindenburgFlag(track.attributes.Muted), solo: hindenburgFlag(track.attributes.Solo) });
		if (hindenburgChild(track, 'Plugins')?.children.length) report('processing-omitted', 'Hindenburg plug-ins, voice profiles and other track processing are not imported.');
		unknownChildren(track, ['Region', 'Plugins']);
		if (Object.keys(track.attributes).some(key => !['Name', 'Volume', 'Gain', 'Pan', 'Muted', 'Solo', 'Rec', 'Type'].includes(key))) {
			report('track-controls-omitted', 'Additional Hindenburg track controls and routing are not imported.');
		}
	}
	if (info && Object.keys(info.attributes).some(key => key !== 'Title')) report('metadata-omitted', 'Metadata other than the session title is not imported.');
	if (hindenburgChild(root, 'Markers')?.children.length) report('markers-omitted', 'Hindenburg markers and chapters are not imported.');
	if (hindenburgChild(root, 'Clipboard')?.children.some(group => group.children.length)) report('clipboard-omitted', 'Clipboard audio and groups outside the timeline are not imported.');
	if (root.children.some(child => ['Document', 'TextItems', 'NavPoints'].includes(child.name))) report('document-omitted', 'Narrator manuscripts, EPUB documents and navigation alignment are not imported.');
	if (Object.keys(root.attributes).some(key => !['Version', 'Samplerate', 'Time', 'Name'].includes(key))) {
		report('session-controls-omitted', 'Additional Hindenburg session controls are not imported.');
	}
	unknownChildren(root, ['Info', 'AudioPool', 'Tracks', 'Clipboard', 'Markers', 'Document', 'TextItems', 'NavPoints']);
	unknownChildren(pool, ['File']);
	unknownChildren(trackRoot, ['Track']);
	report('sequence-clock-converted', 'Stored audio timestamps are rounded to the audio sample grid; the sequence clock uses 30 fps and a zero timecode origin.', true);
	return { format: 'hindenburg', title: info?.attributes.Title ?? root.attributes.Name ?? '', sampleRate,
		rate: { num: 30, den: 1 }, dropFrame: false, startFrameCount: 0, tracks, media: [...media.values()], issues };
}
