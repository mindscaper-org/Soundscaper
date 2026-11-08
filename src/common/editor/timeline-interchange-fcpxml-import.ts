/* SPDX-License-Identifier: AGPL-3.0-only */

import { parseXmlDocument, childElement, childElements, type XmlElement } from './dawproject-xml.ts';
import { addRationals, subtractRationals, divideRationals, multiplyRationals, normalizeRational, roundRational, type Rational } from './timeline-time.ts';
import { timelineImportIssue, timelineInterchangeMediaName, TIMELINE_INTERCHANGE_MAXIMUM_DEPTH, TIMELINE_INTERCHANGE_MAXIMUM_ITEMS,
	type TimelineInterchangeDocument, type TimelineInterchangeMedia, type TimelineInterchangeTrack, type TimelineInterchangeClip } from './timeline-interchange-types.ts';

const ZERO = Object.freeze({ num: 0, den: 1 });
const TIMED_ELEMENTS = new Set(['asset-clip', 'clip', 'video', 'audio', 'gap', 'ref-clip', 'sync-clip', 'mc-clip', 'title', 'transition']);

export function parseFcpxmlTimeline(text: string): TimelineInterchangeDocument {
	const root = parseXmlDocument(text, undefined, { allowedSimpleDoctype: 'fcpxml' });
	if (root.name !== 'fcpxml') throw new TypeError('The XML document is not FCPXML.');
	const issues: TimelineInterchangeDocument['issues'][number][] = [];
	const resources = new Map(childElement(root, 'resources')?.children.map(item => [item.attributes.id ?? '', item]) ?? []);
	const projects = descendants(root, 'project');
	const project = projects[0];
	const sequence = project ? childElement(project, 'sequence') : descendants(root, 'sequence')[0];
	if (!sequence) throw new TypeError('The FCPXML document has no project sequence.');
	if (projects.length > 1) issues.push(timelineImportIssue('fcpxml', 'additional-projects-omitted', 'Only the first FCPXML project sequence is imported.'));
	const format = resources.get(sequence.attributes.format ?? '');
	if (!format?.attributes.frameDuration) throw new TypeError('FCPXML sequence format must declare a frame duration.');
	const rate = divideRationals(1, xmlTime(format.attributes.frameDuration));
	const origin = xmlTime(sequence.attributes.tcStart ?? '0s');
	const start = multiplyRationals(origin, rate);
	const startFrameCount = roundRational(start.num, start.den, 'point');
	const sampleRate = sequence.attributes.audioRate ? audioRate(sequence.attributes.audioRate) : 48000;
	const media = new Map<string, TimelineInterchangeMedia>();
	const tracks = new Map<string, { id: string; name: string; kind: 'audio' | 'video'; clips: TimelineInterchangeClip[] }>();
	let visited = 0;
	const walk = (container: XmlElement, parentTimelineStart: Rational, parentSourceStart: Rational, depth: number, inheritedLane: string, inheritedDuration?: Rational): void => {
		if (depth > TIMELINE_INTERCHANGE_MAXIMUM_DEPTH) throw new RangeError('FCPXML nesting depth limit exceeded.');
		let cursor = parentSourceStart;
		for (const node of container.children) {
			if (++visited > TIMELINE_INTERCHANGE_MAXIMUM_ITEMS) throw new RangeError('FCPXML item limit exceeded.');
			if (!TIMED_ELEMENTS.has(node.name)) continue;
			const offset = node.attributes.offset ? xmlTime(node.attributes.offset) : cursor;
			const duration = node.attributes.duration ? xmlTime(node.attributes.duration) : inheritedDuration ?? ZERO;
			if (duration.num <= 0) throw new RangeError('FCPXML timeline items require positive durations.');
			const timelineStart = addRationals(parentTimelineStart, subtractRationals(offset, parentSourceStart));
			const asset = resources.get(node.attributes.ref ?? '');
			const sourceStart = xmlTime(node.attributes.start ?? (['asset-clip', 'video', 'audio'].includes(node.name) ? asset?.attributes.start : undefined) ?? '0s');
			const lane = node.attributes.lane ?? inheritedLane;
			if (!node.attributes.lane || node.attributes.lane === '0') cursor = addRationals(offset, duration);
			if (timelineStart.num < 0) throw new RangeError('FCPXML items cannot begin before the sequence origin.');
			if (node.name === 'asset-clip' || node.name === 'audio' || node.name === 'video') {
				if (!asset || asset.name !== 'asset') throw new ReferenceError('FCPXML clip references a missing asset resource.');
				const kinds: ('audio' | 'video')[] = [];
				const enabled = node.attributes.srcEnable ?? 'all';
				if (node.name !== 'audio' && enabled !== 'audio' && asset.attributes.hasVideo !== '0' && (asset.attributes.hasVideo === '1' || node.name === 'video')) kinds.push('video');
				if (node.name !== 'video' && enabled !== 'video' && asset.attributes.hasAudio !== '0' && (asset.attributes.hasAudio === '1' || node.name === 'audio')) kinds.push('audio');
				if (!kinds.length) kinds.push(Number(lane) < 0 ? 'audio' : 'video');
				const assetStart = xmlTime(asset.attributes.start ?? '0s');
				const relativeSourceStart = subtractRationals(sourceStart, assetStart);
				if (relativeSourceStart.num < 0) throw new RangeError('FCPXML clip begins before its asset source origin.');
				for (const kind of kinds) {
					const mediaId = `${kind}:${node.attributes.ref}`;
					if (!media.has(mediaId)) {
						const sourceFormat = resources.get(asset.attributes.format ?? '');
						const path = childElements(asset, 'media-rep').find(rep => rep.attributes.kind === 'original-media')?.attributes.src
							?? childElement(asset, 'media-rep')?.attributes.src ?? asset.attributes.src ?? '';
						media.set(mediaId, { id: mediaId, path, name: timelineInterchangeMediaName(path, asset.attributes.name ?? ''), kind,
							aliases: asset.attributes.name ? [asset.attributes.name] : [],
							...(sourceFormat?.attributes.frameDuration ? { rate: divideRationals(1, xmlTime(sourceFormat.attributes.frameDuration)) } : kind === 'video' ? { rate } : {}),
							...(asset.attributes.duration ? { duration: xmlTime(asset.attributes.duration) } : {}),
							...(sourceFormat?.attributes.width ? { width: Number(sourceFormat.attributes.width) } : {}),
							...(sourceFormat?.attributes.height ? { height: Number(sourceFormat.attributes.height) } : {}) });
					}
					const trackKey = `${kind}:${lane}`;
					let track = tracks.get(trackKey);
					if (!track) { track = { id: trackKey, name: `${kind === 'video' ? 'Video' : 'Audio'} ${lane}`, kind, clips: [] }; tracks.set(trackKey, track); }
					if (node.attributes.enabled === '0') issues.push(timelineImportIssue('fcpxml', 'disabled-clip-omitted', 'A disabled FCPXML clip is omitted.'));
					else track.clips.push({ id: `clip-${visited}-${kind}`, name: node.attributes.name ?? asset.attributes.name ?? '', mediaId, start: timelineStart, duration, sourceStart: relativeSourceStart });
				}
			} else if (node.attributes.enabled === '0') {
				issues.push(timelineImportIssue('fcpxml', 'disabled-clip-omitted', 'A disabled FCPXML container is omitted; its duration remains a gap.'));
			} else if (!['clip', 'sync-clip', 'gap'].includes(node.name)) {
				issues.push(timelineImportIssue('fcpxml', 'item-omitted', `FCPXML ${node.name} is omitted; its duration remains a gap.`));
			}
			for (const child of node.children) if (['timeMap', 'marker', 'chapter-marker', 'fadeIn', 'fadeOut'].includes(child.name) || child.name.startsWith('adjust-') || child.name.startsWith('filter-')) {
				issues.push(timelineImportIssue('fcpxml', child.name === 'timeMap' ? 'time-map-omitted' : 'effect-omitted', `FCPXML ${child.name} is omitted; clips use unity playback and default presentation.`));
			}
			if (node.attributes.enabled !== '0') walk(node, timelineStart, sourceStart, depth + 1, lane, duration);
		}
	};
	const spine = childElement(sequence, 'spine');
	if (!spine) throw new TypeError('FCPXML sequence has no spine.');
	walk(spine, ZERO, origin, 0, '0');
	return { format: 'fcpxml', title: project?.attributes.name ?? 'FCPXML timeline', sampleRate, rate,
		dropFrame: sequence.attributes.tcFormat === 'DF', startFrameCount, tracks: [...tracks.values()] as TimelineInterchangeTrack[], media: [...media.values()], issues };
}

function xmlTime(value: string): Rational {
	const match = value.match(/^(-?\d+)(?:\/(\d+))?s$/u);
	if (!match) throw new TypeError('FCPXML time must be rational seconds.');
	return normalizeRational({ num: Number(match[1]), den: Number(match[2] ?? 1) });
}
function audioRate(value: string): number {
	const rate = Number(value.endsWith('k') ? Number(value.slice(0, -1)) * 1000 : value);
	if (!Number.isSafeInteger(rate) || rate < 1) throw new RangeError('FCPXML audio rate must be positive.');
	return rate;
}
function descendants(element: XmlElement, name: string): XmlElement[] {
	const found: XmlElement[] = [];
	const visit = (node: XmlElement) => { if (node.name === name) found.push(node); for (const child of node.children) visit(child); };
	visit(element);
	return found;
}
