/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAutomationLaneV21, resolveAutomationLanePointFramesV21, type AutomationLaneV21 } from './automation-lane-v21.ts';
import { addDeliveryReportItem } from './delivery-report.ts';
import { panToNormalized, rationalToNumber } from './dawproject-format.ts';
import { xmlElement, type XmlElement } from './dawproject-xml.ts';
import { type DataRecord, type DawprojectExportContext, finite, parameterIdFor, record, records, stripKey } from './dawproject-export-context.ts';

/**
 * Volume, pan, and mute automation for one strip as `Points` timelines.
 *
 * A V21 lane is the authority when one exists for the parameter; the legacy
 * volume envelope stands in otherwise. Both target the channel parameter the
 * structure declared, by the same id.
 */
export function buildStripAutomation(key: string, strip: DataRecord, context: DawprojectExportContext): XmlElement[] {
	const lanes = records(context.project.automationLanes).filter((lane) => {
		const address = record(lane.address);
		return address.kind === 'strip' && stripKey(record(address.strip)) === key;
	});
	const byParameter = new Map(lanes.map((lane) => [String(record(lane.address).parameterId), lane]));
	const result: XmlElement[] = [];
	const gainLane = byParameter.get('gain');
	if (gainLane) {
		const points = lanePoints(gainLane, context);
		if (points) result.push(pointsElement(context, key, 'volume', 'linear', points, (value) => Math.max(0, value)));
	} else {
		const envelope: ResolvedPoint[] = records(strip.envelope)
			.map((point) => ({ frame: finite(point.frame, Number.NaN), value: finite(point.value, Number.NaN), interpolation: 'linear' as const }))
			.filter((point) => Number.isFinite(point.frame) && Number.isFinite(point.value));
		// The envelope is linear between points and flat after the last one.
		const last = envelope.at(-1);
		if (last) envelope[envelope.length - 1] = { ...last, interpolation: 'hold' };
		if (envelope.length > 0) result.push(pointsElement(context, key, 'volume', 'linear', envelope, (value) => Math.max(0, value * finite(strip.gain, 1))));
	}
	const panLane = byParameter.get('pan');
	if (panLane) {
		const points = lanePoints(panLane, context);
		if (points) result.push(pointsElement(context, key, 'pan', 'normalized', points, panToNormalized));
	}
	const muteLane = byParameter.get('mute');
	if (muteLane) {
		const points = lanePoints(muteLane, context);
		if (points) {
			result.push(xmlElement('Points', { id: context.ids.id(`points:${key}:mute`),
				...(points[0]?.beat === undefined ? {} : { timeUnit: 'beats' }) }, [
				xmlElement('Target', { parameter: parameterIdFor(context, key, 'mute') }),
				...points.map((point) => xmlElement('BoolPoint', {
					time: point.beat ?? point.frame / context.sampleRate, value: point.value >= 0.5,
				})),
			]));
		}
	}
	return result;
}

interface ResolvedPoint {
	readonly frame: number;
	readonly beat?: number;
	readonly value: number;
	readonly interpolation: 'hold' | 'linear';
}

function lanePoints(lane: DataRecord, context: DawprojectExportContext): readonly ResolvedPoint[] | null {
	const laneId = String(lane.id);
	context.consumedLaneIds.add(laneId);
	let resolved: readonly Readonly<{ frame: number; value: number }>[];
	let normalized: AutomationLaneV21;
	try {
		normalized = normalizeAutomationLaneV21(lane);
		resolved = resolveAutomationLanePointFramesV21(normalized, {
			sampleRate: context.sampleRate,
			...(context.tempoMap ? { tempoMap: context.tempoMap } : {}),
		});
	} catch (error) {
		addDeliveryReportItem(context.draft, {
			code: 'dawproject.automation-omitted',
			disposition: 'omitted',
			severity: 'warning',
			scope: { kind: 'automation-lane', id: laneId },
			data: { reason: error instanceof Error ? error.message : String(error) },
			message: 'The automation lane could not be resolved to sample positions and is not written.',
		});
		return null;
	}
	const segments = records(lane.segments);
	let approximated = 0;
	const points = resolved.map((point, index) => {
		const kind = index < segments.length ? String(segments[index]!.kind ?? 'linear') : 'hold';
		if (kind !== 'hold' && kind !== 'linear') approximated += 1;
		const position = normalized.points[index]!.position;
		return { frame: point.frame, value: point.value,
			...(normalized.timebase === 'musical-beats' && typeof position !== 'number' ? { beat: rationalToNumber(position) } : {}),
			interpolation: kind === 'hold' ? 'hold' as const : 'linear' as const };
	});
	if (approximated > 0) {
		addDeliveryReportItem(context.draft, {
			code: 'dawproject.automation-curve-converted',
			disposition: 'converted',
			severity: 'info',
			scope: { kind: 'automation-lane', id: laneId },
			data: { segments: approximated },
			message: 'DAWproject automation interpolates by hold or line; eased and bezier segments are written as lines between their anchors.',
		});
	}
	return points;
}

function pointsElement(
	context: DawprojectExportContext,
	key: string,
	parameter: 'volume' | 'pan',
	unit: 'linear' | 'normalized',
	points: readonly ResolvedPoint[],
	convert: (value: number) => number,
): XmlElement {
	return xmlElement('Points', { unit, id: context.ids.id(`points:${key}:${parameter}`),
		...(points[0]?.beat === undefined ? {} : { timeUnit: 'beats' }) }, [
		xmlElement('Target', { parameter: parameterIdFor(context, key, parameter) }),
		...points.map((point) => xmlElement('RealPoint', {
			time: point.beat ?? point.frame / context.sampleRate,
			value: convert(point.value),
			interpolation: point.interpolation,
		})),
	]);
}

export function reportUnconsumedLanes(context: DawprojectExportContext): void {
	for (const lane of records(context.project.automationLanes)) {
		const laneId = String(lane.id);
		if (context.consumedLaneIds.has(laneId)) continue;
		const address = record(lane.address);
		addDeliveryReportItem(context.draft, {
			code: 'dawproject.automation-omitted',
			disposition: 'omitted',
			severity: 'warning',
			scope: { kind: 'automation-lane', id: laneId },
			data: { addressKind: String(address.kind ?? ''), parameterId: String(address.parameterId ?? '') },
			message: 'Only volume, pan, and mute of a written channel have a DAWproject parameter to target; this lane\'s parameter has none.',
		});
	}
}
