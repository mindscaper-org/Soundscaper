/* SPDX-License-Identifier: AGPL-3.0-only */
import { childElement, childElements, walkXml, type XmlElement } from './dawproject-xml.ts';
import { interchangeMissingEffect } from './interchange-effect-state.ts';
import { interchangeClipEnvelope } from './interchange-clip-envelope.ts';
import { timelineImportIssue, type TimelineInterchangeStrip, type TimelineInterchangeAutomation, type TimelineInterchangeDocument } from './timeline-interchange-types.ts';
import { ardourMidiTempos } from './ardour-import-midi.ts';
import { createInterchangeMidiClock } from './interchange-midi-clock.ts';
import type { InterchangeAutomationPoint } from './interchange-automation.ts';
import { ardourRouteHasFlag } from './ardour-route-flags.ts';
import { composeArdourGainCurves } from './ardour-import-gain-curves.ts';
import { ardourSendMuteFactor, projectArdourMuteRouting, type ArdourMixStrip } from './ardour-import-mute-routing.ts';

export function ardourAutomationPoints(list: XmlElement, root: XmlElement, sampleRate: number): readonly InterchangeAutomationPoint[] {
	const interpolation = list.attributes['interpolation-style'] ?? 'Linear';
	if (!['Linear', 'Discrete', 'Curved', 'Exponential', 'Logarithmic'].includes(interpolation)) throw new RangeError('Unknown Ardour automation interpolation.');
	const events = childElement(list, 'events')?.text.trim();
	if (!events) return [];
	return events.split(/\r?\n/u).map(line => {
		const [time, value] = line.trim().split(/\s+/u);
		let frame: number;
		if (time?.startsWith('b')) frame = createInterchangeMidiClock(ardourMidiTempos(root)).frameAt(finite(time.slice(1)) / 1920, sampleRate);
		else frame = Math.round(finite(time?.replace(/^a/u, '')) * (time?.startsWith('a') ? sampleRate / 282240000 : 1));
		return { frame, value: finite(value), interpolation: interpolation === 'Discrete' ? 'hold' as const : 'linear' as const };
	});
}

export function ardourRegionEnvelope(region: XmlElement, root: XmlElement, durationFrames: number, sampleRate: number,
	issues: TimelineInterchangeDocument['issues'][number][]) {
	const envelope = childElement(region, 'Envelope'), list = envelope && (childElement(envelope, 'AutomationList') ?? envelope);
	if (!list || ['0', 'no', 'false'].includes(region.attributes['envelope-active'] ?? envelope?.attributes.active ?? '')) return [];
	if (!['Linear', 'Discrete', undefined].includes(list.attributes['interpolation-style'])) issues.push(timelineImportIssue('ardour', 'envelope-interpolation-converted', 'The region envelope retains its control points with linear interpolation.', 'converted'));
	let clamped = false;
	const result = interchangeClipEnvelope(ardourAutomationPoints(list, root, sampleRate), durationFrames, value => value, () => { clamped = true; });
	if (clamped) issues.push(timelineImportIssue('ardour', 'envelope-gain-clamped', 'Region envelope gain is limited to the clip gain range.', 'converted'));
	return result;
}

export function ardourMixStrip(route: XmlElement, root: XmlElement, sampleRate: number,
	issues: TimelineInterchangeDocument['issues'][number][]): ArdourMixStrip {
	const automation: TimelineInterchangeAutomation[] = [], effects: Readonly<Record<string, unknown>>[] = [], sends: NonNullable<TimelineInterchangeStrip['sends']>[number][] = [];
	const routeId = route.attributes.id ?? childElement(route, 'IO')?.attributes.id ?? '';
	const routeInactive = ['0', 'no', 'false'].includes(route.attributes.active ?? childElement(route, 'IO')?.attributes.active ?? '');
	const muteMaster = childElement(route, 'MuteMaster'), mutePoint = muteMaster?.attributes['mute-point'];
	const nativeMute = control(route, 'mute', 0) !== 0 || flag(route.attributes.muted) || flag(muteMaster?.attributes.muted);
	const processors = childElements(route, 'Processor');
	const curves = (node: XmlElement, parameter: TimelineInterchangeAutomation['parameter'], convert: (value: number) => number = value => value) => {
		const result: TimelineInterchangeAutomation[] = [];
		for (const list of walkXml(node)) {
			if (list.name !== 'AutomationList' || !childElement(list, 'events')?.text.trim()) continue;
			if (['Off', '0'].includes(list.attributes.state ?? '')) continue;
			try {
				const points = ardourAutomationPoints(list, root, sampleRate).map(point => ({ ...point, value: convert(point.value) }));
				result.push({ parameter, points });
				if (!['Linear', 'Discrete', undefined].includes(list.attributes['interpolation-style'])) issues.push(timelineImportIssue('ardour', 'automation-interpolation-converted', 'Ardour curved interpolation retains its points with linear interpolation.', 'converted'));
			} catch (error) { issues.push(timelineImportIssue('ardour', 'automation-clock-unsupported', 'An unsupported automation clock was omitted.', 'omitted', { reason: String(error) })); }
		}
		return result;
	};
	const add = (node: XmlElement, parameter: TimelineInterchangeAutomation['parameter'], convert?: (value: number) => number) => {
		automation.push(...curves(node, parameter, convert));
	};
	const gainProcessors = processors.filter(node => ['amp', 'trim'].includes(node.attributes.type ?? '')
		&& !['0', 'no', 'false'].includes(node.attributes.active ?? ''));
	const ioGain = childElement(route, 'IO')?.attributes.gain;
	const legacyGain = ioGain === undefined ? 1 : finite(ioGain);
	const automated = gainProcessors.filter(node => [...walkXml(node)].some(child => child.name === 'AutomationList' && childElement(child, 'events')?.text.trim() && !['Off', '0'].includes(child.attributes.state ?? '')));
	if (automated.length === 1) {
		const multiplier = gainProcessors.filter(node => node !== automated[0]).reduce((gain, node) => gain * control(node, 'gaincontrol', 1), legacyGain);
		add(automated[0]!, 'gain', value => value * multiplier);
	} else if (automated.length > 1) issues.push(timelineImportIssue('ardour', 'combined-gain-automation-omitted', 'Simultaneously automated trim and fader require curve composition; the static gain is retained.'));
	const pannable = childElement(route, 'Pannable');
	const mainOut = processors.find(node => node.attributes.type === 'main-outs');
	const panBypassed = flag(mainOut && childElement(mainOut, 'PannerShell')?.attributes.bypassed);
	const io = childElement(route, 'IO');
	const oldPanners = io ? childElements(childElement(io, 'Panner') ?? io, 'StreamPanner') : [];
	if (pannable && !panBypassed) for (const child of pannable.children) {
		if (child.name === 'Automation') { for (const list of childElements(child, 'AutomationList')) {
			if (list.attributes['automation-id'] === 'pan-azimuth') add(list, 'pan', value => value * 2 - 1);
		} } else if (child.name === 'Controllable' && child.attributes.name === 'pan-azimuth') add(child, 'pan', value => value * 2 - 1);
	}
	for (const child of route.children) {
		if (child.name === 'Automation' && !routeInactive) for (const list of childElements(child, 'AutomationList')) {
			if (list.attributes['automation-id'] === 'mute') add(list, 'mute');
		}
		if (!routeInactive && child.name === 'Controllable' && child.attributes.name === 'mute') add(child, 'mute');
	}
	const muteAutomation = automation.filter(lane => lane.parameter === 'mute');
	let position: 'pre-fader' | 'post-fader' = 'pre-fader';
	for (const [index, processor] of processors.entries()) {
		const type = processor.attributes.type ?? '';
		if (type === 'amp') position = 'post-fader';
		if (['intsend', 'send'].includes(type)) {
			const target = processor.attributes['send-to'] ?? processor.attributes.sendtoroute;
			if (!target) { issues.push(timelineImportIssue('ardour', 'external-send-omitted', 'A hardware send has no internal destination.')); continue; }
			const id = `${routeId}:send:${index}`;
			const amp = childElement(processor, 'Amplifier') ?? processor;
			const prefix = position === 'pre-fader' ? gainProcessors.filter(node => processors.indexOf(node) < index) : [];
			const factors = [...[amp, ...prefix].map(node => {
				const lanes = curves(node, { sendId: id });
				if (lanes.length > 1) throw new RangeError('An Ardour gain processor has ambiguous automation.');
				return { gain: control(node, 'gaincontrol', 1), points: lanes[0]?.points ?? [] };
			}), ...ardourSendMuteFactor(mutePoint, position, nativeMute, muteAutomation, routeInactive)];
			sends.push({ id, target, level: factors.reduce((gain, factor) => gain * factor.gain, 1), enabled: processor.attributes.active !== '0', position });
			const points = composeArdourGainCurves(factors);
			if (points) automation.push({ parameter: { sendId: id }, points });
		} else if (!['amp', 'trim', 'meter', 'main-outs', 'diskreader', 'diskwriter', 'intreturn', 'capture'].includes(type)) {
			effects.push(interchangeMissingEffect('ardour', `${routeId}:processor:${index}`, processor.attributes.name ?? type, processor, processor.attributes.active !== '0'));
			issues.push(timelineImportIssue('ardour', 'effect-state-preserved', 'An Ardour processor retains its parameters, automation and serialized state as a bypassed rack entry.', 'converted'));
		}
	}
	const names = new Map(childElements(childElement(root, 'Routes') ?? root, 'Route').map(node => [node.attributes.name ?? '', node]));
	const outputs = childElements(route, 'IO').filter(node => node.attributes.direction === 'Output');
	const connections = outputs.flatMap(io => [...walkXml(io)].filter(node => node.name === 'Connection').map(node => node.attributes.other ?? '').filter(Boolean));
	const destinations = new Set(connections.map(connection => connection.split('/')[0]!));
	let output: string | null | undefined = outputs.length > 0 && connections.length === 0 ? null : undefined;
	if (destinations.size === 1) {
		const name = [...destinations][0]!, target = names.get(name);
		if (target && !ardourRouteHasFlag(target, 'MasterOut')) output = target.attributes.id;
		else if (!target && !name.startsWith('system:')) issues.push(timelineImportIssue('ardour', 'output-routing-converted', 'An external output is routed to the main output.', 'converted'));
	} else if (destinations.size > 1) issues.push(timelineImportIssue('ardour', 'output-fanout-converted', 'Several output destinations are replaced by main output.', 'converted'));
	const strip = { gain: gainProcessors.reduce((gain, node) => gain * control(node, 'gaincontrol', 1), legacyGain),
		pan: panBypassed ? 0 : control(pannable ?? route, 'pan-azimuth', oldPanners.length === 1 ? finite(oldPanners[0]!.attributes.x ?? '.5') : .5) * 2 - 1,
		mute: nativeMute || routeInactive,
		solo: control(route, 'solo', 0) !== 0 || flag(route.attributes['self-solo'] ?? route.attributes.soloed),
		effects, automation, sends, opaqueExtensions: { 'soundscaper.interchange-mix': { format: 'ardour', route } }, ...(output === undefined ? {} : { output }) };
	if (mutePoint !== undefined && (nativeMute || muteAutomation.length)) issues.push(timelineImportIssue('ardour', 'mute-points-converted',
		'The saved main and send mute points become destination gates; an independent main gate uses an auxiliary strip when needed.', 'converted'));
	return projectArdourMuteRouting(strip, routeId, route.attributes.name ?? '', mutePoint, nativeMute, muteAutomation, routeInactive, ardourRouteHasFlag(route, 'MasterOut'));
}

function flag(value: string | undefined): boolean { return ['1', 'yes', 'true'].includes(value ?? ''); }

function finite(value: string | undefined): number {
	if (value === undefined || !value.trim() || !Number.isFinite(Number(value))) throw new RangeError('Invalid Ardour automation value.');
	return Number(value);
}
function control(node: XmlElement, name: string, fallback: number): number {
	const value = childElements(node, 'Controllable').find(child => child.attributes.name === name)?.attributes.value;
	return value === undefined ? fallback : finite(value);
}
