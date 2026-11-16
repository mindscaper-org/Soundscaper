/* SPDX-License-Identifier: AGPL-3.0-only */
import { childElement, childElements, walkXml, type XmlElement } from './dawproject-xml.ts';
import { interchangeMissingEffect } from './interchange-effect-state.ts';
import { interchangeClipEnvelope } from './interchange-clip-envelope.ts';
import { timelineImportIssue, type TimelineInterchangeStrip, type TimelineInterchangeAutomation, type TimelineInterchangeDocument } from './timeline-interchange-types.ts';
import { ardourMidiTempos } from './ardour-import-midi.ts';
import { createInterchangeMidiClock } from './interchange-midi-clock.ts';
import type { InterchangeAutomationPoint } from './interchange-automation.ts';

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
	if (!list || ['0', 'no'].includes(region.attributes['envelope-active'] ?? envelope?.attributes.active ?? '')) return [];
	if (!['Linear', 'Discrete', undefined].includes(list.attributes['interpolation-style'])) issues.push(timelineImportIssue('ardour', 'envelope-interpolation-converted', 'The region envelope retains its control points with linear interpolation.', 'converted'));
	let clamped = false;
	const result = interchangeClipEnvelope(ardourAutomationPoints(list, root, sampleRate), durationFrames, value => value, () => { clamped = true; });
	if (clamped) issues.push(timelineImportIssue('ardour', 'envelope-gain-clamped', 'Region envelope gain is limited to the clip gain range.', 'converted'));
	return result;
}

export function ardourMixStrip(route: XmlElement, root: XmlElement, sampleRate: number,
	issues: TimelineInterchangeDocument['issues'][number][]): TimelineInterchangeStrip {
	const automation: TimelineInterchangeAutomation[] = [], effects: Readonly<Record<string, unknown>>[] = [], sends: NonNullable<TimelineInterchangeStrip['sends']>[number][] = [];
	const routeId = route.attributes.id ?? childElement(route, 'IO')?.attributes.id ?? '';
	const processors = childElements(route, 'Processor');
	const add = (node: XmlElement, parameter: TimelineInterchangeAutomation['parameter'], convert: (value: number) => number = value => value) => {
		for (const list of walkXml(node)) {
			if (list.name !== 'AutomationList' || !childElement(list, 'events')?.text.trim()) continue;
			if (['Off', '0'].includes(list.attributes.state ?? '')) continue;
			try {
				const points = ardourAutomationPoints(list, root, sampleRate).map(point => ({ ...point, value: convert(point.value) }));
				automation.push({ parameter, points });
				if (!['Linear', 'Discrete', undefined].includes(list.attributes['interpolation-style'])) issues.push(timelineImportIssue('ardour', 'automation-interpolation-converted', 'Ardour curved interpolation retains its points with linear interpolation.', 'converted'));
			} catch (error) { issues.push(timelineImportIssue('ardour', 'automation-clock-unsupported', 'An unsupported automation clock was omitted.', 'omitted', { reason: String(error) })); }
		}
	};
	const gainProcessors = processors.filter(node => ['amp', 'trim'].includes(node.attributes.type ?? ''));
	const automated = gainProcessors.filter(node => [...walkXml(node)].some(child => child.name === 'AutomationList' && childElement(child, 'events')?.text.trim() && !['Off', '0'].includes(child.attributes.state ?? '')));
	if (automated.length === 1) {
		const multiplier = gainProcessors.filter(node => node !== automated[0]).reduce((gain, node) => gain * control(node, 'gaincontrol', 1), 1);
		add(automated[0]!, 'gain', value => value * multiplier);
	} else if (automated.length > 1) issues.push(timelineImportIssue('ardour', 'combined-gain-automation-omitted', 'Simultaneously automated trim and fader require curve composition; the static gain is retained.'));
	const pannable = childElement(route, 'Pannable');
	if (pannable) for (const child of pannable.children) {
		if (child.name === 'Automation') { for (const list of childElements(child, 'AutomationList')) {
			if (list.attributes['automation-id'] === 'pan-azimuth') add(list, 'pan', value => value * 2 - 1);
		} } else if (child.name === 'Controllable' && child.attributes.name === 'pan-azimuth') add(child, 'pan', value => value * 2 - 1);
	}
	for (const child of route.children) {
		if (child.name === 'Automation' && route.attributes.active !== 'no') for (const list of childElements(child, 'AutomationList')) {
			if (list.attributes['automation-id'] === 'mute') add(list, 'mute');
		}
		if (route.attributes.active !== 'no' && child.name === 'Controllable' && child.attributes.name === 'mute') add(child, 'mute');
	}
	let position: 'pre-fader' | 'post-fader' = 'pre-fader';
	for (const [index, processor] of processors.entries()) {
		const type = processor.attributes.type ?? '';
		if (type === 'amp') position = 'post-fader';
		if (['intsend', 'send'].includes(type)) {
			const target = processor.attributes['send-to'] ?? processor.attributes.sendtoroute;
			if (!target) { issues.push(timelineImportIssue('ardour', 'external-send-omitted', 'A hardware send has no internal destination.')); continue; }
			const id = `${routeId}:send:${index}`;
			const amp = childElement(processor, 'Amplifier') ?? processor;
			sends.push({ id, target, level: control(amp, 'gaincontrol', 1), enabled: processor.attributes.active !== '0', position }); add(amp, { sendId: id });
		} else if (!['amp', 'trim', 'meter', 'main-outs', 'diskreader', 'diskwriter', 'intreturn', 'capture'].includes(type)) {
			effects.push(interchangeMissingEffect('ardour', `${routeId}:processor:${index}`, processor.attributes.name ?? type, processor, processor.attributes.active !== '0'));
			issues.push(timelineImportIssue('ardour', 'effect-state-preserved', 'An Ardour processor retains its parameters, automation and serialized state as a bypassed rack entry.', 'converted'));
		}
	}
	const names = new Map(childElements(childElement(root, 'Routes') ?? root, 'Route').map(node => [node.attributes.name ?? '', node]));
	const outputs = childElements(route, 'IO').filter(node => node.attributes.direction === 'Output');
	const connections = outputs.flatMap(io => [...walkXml(io)].filter(node => node.name === 'Connection').map(node => node.attributes.other ?? '').filter(Boolean));
	const destinations = new Set(connections.map(connection => connection.split('/')[0]!));
	let output: string | null | undefined;
	if (destinations.size === 1) {
		const name = [...destinations][0]!, target = names.get(name);
		if (target && !/MasterOut/u.test(target.attributes.flags ?? '')) output = target.attributes.id;
		else if (!target && !name.startsWith('system:')) issues.push(timelineImportIssue('ardour', 'output-routing-converted', 'An external output is routed to the main output.', 'converted'));
	} else if (destinations.size > 1) issues.push(timelineImportIssue('ardour', 'output-fanout-converted', 'Several output destinations are replaced by main output.', 'converted'));
	return { gain: gainProcessors.reduce((gain, node) => gain * control(node, 'gaincontrol', 1), 1),
		pan: control(childElement(route, 'Pannable') ?? route, 'pan-azimuth', .5) * 2 - 1,
		mute: control(route, 'mute', 0) !== 0 || route.attributes.muted === '1' || route.attributes.active === 'no', solo: control(route, 'solo', 0) !== 0,
		effects, automation, sends, opaqueExtensions: { 'soundscaper.interchange-mix': { format: 'ardour', route } }, ...(output === undefined ? {} : { output }) };
}

function finite(value: string | undefined): number {
	if (value === undefined || !value.trim() || !Number.isFinite(Number(value))) throw new RangeError('Invalid Ardour automation value.');
	return Number(value);
}
function control(node: XmlElement, name: string, fallback: number): number {
	const value = childElements(node, 'Controllable').find(child => child.attributes.name === name)?.attributes.value;
	return value === undefined ? fallback : finite(value);
}
