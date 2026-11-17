/* SPDX-License-Identifier: AGPL-3.0-only */
import { addDeliveryReportItem } from './delivery-report.ts';
import { clamp, parameterToLinearGain, parameterToPan } from './dawproject-format.ts';
import { dawprojectImportedVolumeCurve } from './dawproject-import-volume-curve.ts';
import { interchangeAutomationLane } from './interchange-automation.ts';
import { canonicalParameterAddressKey, type ParameterAddress } from './parameter-address.ts';
import type { DawprojectAutomationEvent } from './dawproject-import-timeline.ts';
import type { Build } from './dawproject-import-structure.ts';

export function applyAutomation(events: readonly DawprojectAutomationEvent[], build: Build): void {
	if (events.length) addDeliveryReportItem(build.draft, { code: 'dawproject.automation-clock-converted', disposition: 'converted', severity: 'info', message: 'Arrangement automation is resolved to absolute project samples; musical anchors do not move with subsequent tempo edits.' });
	for (const event of events) {
		const target = event.parameterId ? build.parameters.get(event.parameterId) : undefined;
		if (!target || target.parameter === 'effect' && event.unit !== null && target.unit !== null && event.unit !== target.unit || target.inactive && target.parameter === 'mute') {
			addDeliveryReportItem(build.draft, { code: 'dawproject.automation-omitted', disposition: 'omitted', severity: 'warning',
				data: { parameterId: event.parameterId }, message: 'Automation targets an unavailable parameter; its original points are retained with the imported effect where present.' });
			continue;
		}
		const address: ParameterAddress = target.address ?? { kind: 'strip', strip: target.kind === 'master' ? { kind: 'master' }
			: { kind: target.kind === 'track' ? 'track' : 'mixer-node', id: target.id! },
			parameterId: target.parameter === 'volume' ? 'gain' : target.parameter as 'pan' | 'mute' };
		const unit = event.unit ?? target.unit;
		let clamped = false;
		const convert = (value: number): number => {
			const v = target.convert ? target.convert(value) : target.parameter === 'volume' ? parameterToLinearGain(value, unit) ?? 1
				: target.parameter === 'pan' ? parameterToPan(value, unit) ?? 0 : value ? 1 : 0;
			const minimum = target.minimum ?? (target.parameter === 'pan' ? -1 : 0), maximum = target.maximum ?? (target.parameter === 'volume' ? 4 : 1);
			const admitted = clamp(v, minimum, maximum); if (admitted !== v) clamped = true; return admitted;
		};
		const points = event.points.filter(point => Number.isFinite(point.value) || target.parameter === 'volume' && unit === 'decibel' && point.value === Number.NEGATIVE_INFINITY).map(point => ({ ...point, interpolation: target.parameter === 'mute' ? 'hold' as const : point.interpolation }));
		const infinite = points.some(point => !Number.isFinite(point.value));
		const lane = interchangeAutomationLane(infinite ? points.map(point => ({ ...point, value: convert(point.value) })) : points, address, build.createStableId, infinite ? value => value : convert);
		if (infinite && points.some(point => point.interpolation === 'linear')) addDeliveryReportItem(build.draft, { code: 'dawproject.automation-infinity-converted', disposition: 'converted', severity: 'warning', message: 'Infinite dB values retain exact silence; adjacent ramps interpolate in linear gain.' });
		if (points.length < event.points.length) addDeliveryReportItem(build.draft, { code: 'dawproject.automation-nonfinite-omitted', disposition: 'omitted', severity: 'warning', message: 'Nonfinite automation values outside decibel silence are omitted.' });
		if (!lane) continue;
		if (target.parameter === 'mute' && target.kind === 'group') { const folder = build.folders.find(folder => folder.id === target.id); if (folder) folder.mute = false; }
		const key = canonicalParameterAddressKey(address), index = build.automationLanes.findIndex(value => canonicalParameterAddressKey(value.address) === key);
		if (index >= 0) {
			build.automationLanes[index] = lane;
			addDeliveryReportItem(build.draft, { code: 'dawproject.automation-replaced', disposition: 'converted', severity: 'warning', message: 'Several timelines address the same parameter; the last automation timeline is used.' });
		} else build.automationLanes.push(lane);
		// Retain a bounded volume approximation for the V17 interchange foundation.
		if (target.parameter === 'volume' && address.kind === 'strip') {
			const owner = target.kind === 'master' ? build.master : target.kind === 'track' ? build.tracks.find(track => track.id === target.id)
				: [...build.groups, ...build.sends].find(strip => strip.id === target.id);
			if (owner) { owner.gain = 1; owner.envelope = dawprojectImportedVolumeCurve(points, unit, 4); }
		}
		addDeliveryReportItem(build.draft, { code: 'dawproject.automation-preserved', disposition: 'preserved', severity: 'info',
			data: { parameterId: event.parameterId, points: lane.points.length }, message: 'Automation is retained as an editable lane, including held segments.' });
		if (clamped) addDeliveryReportItem(build.draft, { code: 'dawproject.automation-gain-clamped', disposition: 'converted', severity: 'warning', message: 'Automation values outside the destination parameter range are limited to that range.' });
	}
}
