/* SPDX-License-Identifier: AGPL-3.0-only */
import { childElement, childElements, walkXml, booleanAttribute, type XmlElement } from './dawproject-xml.ts';
import { createEffect } from './effects.js';
import { effectParameterInventory } from './effect-parameter-descriptors.ts';
import { interchangeMissingEffect } from './interchange-effect-state.ts';
import { addDeliveryReportItem } from './delivery-report.ts';
import type { DawprojectDocument, DawprojectTrack } from './dawproject-import.ts';
import type { Build, ParameterTarget } from './dawproject-import-structure.ts';
import type { StripRef } from './parameter-address.ts';

/** Generic devices use explicit parameter mappings; foreign native state never masquerades as host state. */
export function appendDawprojectDevices(document: DawprojectDocument, build: Build, states: ReadonlyMap<string, string> = new Map()): void {
	let retainedStateBytes = 0;
	const automationByParameter = new Map<string, XmlElement[]>();
	for (const node of walkXml(document.root)) {
		const parameter = node.name === 'Points' ? childElement(node, 'Target')?.attributes.parameter : undefined;
		if (!parameter) continue;
		const timelines = automationByParameter.get(parameter) ?? []; timelines.push(node); automationByParameter.set(parameter, timelines);
	}
	const visit = (track: DawprojectTrack) => {
		for (const child of track.children) visit(child);
		const channel = track.channel;
		if (!channel) return;
		const leaf = track.id && !build.folderByDawId.has(track.id) ? build.trackByDawId.get(track.id) : undefined;
		const busId = channel.id ? build.busByChannelId.get(channel.id) : undefined;
		const owner = channel.role === 'master' ? build.master : leaf ?? [...build.groups, ...build.sends].find(bus => bus.id === busId);
		if (!owner) return;
		const strip: StripRef = channel.role === 'master' ? { kind: 'master' } : leaf ? { kind: 'track', id: leaf.id } : { kind: 'mixer-node', id: owner.id };
		const effects: Readonly<Record<string, unknown>>[] = [];
		for (const device of channel.deviceTrees ?? []) {
			if (effects.length >= 256) throw new RangeError('Imported rack exceeds 256 devices.');
			const id = build.createStableId('effect'), name = device.attributes.deviceName ?? device.attributes.name ?? device.name;
			const enabled = (!childElement(device, 'Enabled') || booleanAttribute(childElement(device, 'Enabled')!, 'value') !== false) && booleanAttribute(device, 'loaded') !== false;
			const ids = new Set([...walkXml(device)].map(node => node.attributes.id).filter(Boolean));
			const automation = [...new Set([...ids].flatMap(id => automationByParameter.get(id!) ?? []))];
			const file = childElement(device, 'State'), path = file?.attributes.path;
			const state = path ? states.get(path) : undefined;
			const stateBytes = state === undefined ? 0 : state.length / 4 * 3 - (state.endsWith('==') ? 2 : state.endsWith('=') ? 1 : 0);
			const retainState = state !== undefined && retainedStateBytes + stateBytes <= 64 * 1024 * 1024;
			if (retainState) retainedStateBytes += stateBytes;
			const payload = { device, automation, ...(retainState ? { state: { path, encoding: 'base64', data: state } } : {}) };
			const mappings: { node: XmlElement; parameterId: string; elementId?: string; convert?: (value: number) => number }[] = [];
			const read = (owner: XmlElement, tag: string, fallback: number, parameterId?: string, elementId?: string) => {
				const node = childElement(owner, tag);
				if (node && parameterId) mappings.push({ node, parameterId, ...(elementId ? { elementId } : {}) });
				return number(node, fallback);
			};
			let effect: Readonly<Record<string, unknown>>;
			try {
				let type: string, params: Record<string, unknown>;
				if (device.name === 'Equalizer') {
					type = 'eq';
					const types: Record<string, string> = { bell: 'peaking', lowShelf: 'lowshelf', highShelf: 'highshelf', highPass: 'highpass', lowPass: 'lowpass', notch: 'notch' };
					const bands = childElements(device, 'Band').map((band, index) => {
						const bandId = `${id}:band:${index}`, bandType = types[band.attributes.type ?? ''];
						if (!bandType) throw new RangeError('Unsupported EQ band type.');
						const order = Number(band.attributes.order ?? 2), slope = order * 6;
						if (['highpass', 'lowpass'].includes(bandType) && ![12, 24, 36, 48].includes(slope)) throw new RangeError('Unsupported EQ filter order.');
						const freq = childElement(band, 'Freq');
						const convert = freq?.attributes.unit === 'semitones' ? (value: number) => 440 * 2 ** ((value - 69) / 12) : (value: number) => value;
						if (freq) mappings.push({ node: freq, parameterId: 'frequency', elementId: bandId, convert });
						return { id: bandId, type: bandType, enabled: (!childElement(band, 'Enabled') || booleanAttribute(childElement(band, 'Enabled')!, 'value') !== false), slope: ['highpass', 'lowpass'].includes(bandType) ? slope : 12,
							frequency: convert(number(freq, 1000)), gain: read(band, 'Gain', 0, 'gain', bandId), q: read(band, 'Q', 1, 'q', bandId) };
					});
					if (number(childElement(device, 'InputGain'), 0) !== 0) throw new RangeError('EQ input gain requires a separate gain stage.');
					params = { bands, outputGain: read(device, 'OutputGain', 0, 'outputGain') };
				} else if (device.name === 'Compressor') {
					type = 'compressor';
					if ((childElement(device, 'AutoMakeup') && booleanAttribute(childElement(device, 'AutoMakeup')!, 'value') === true) || number(childElement(device, 'InputGain'), 0) !== 0) throw new RangeError('Automatic makeup and input gain require an explicit adapter.');
					const ratio = childElement(device, 'Ratio');
					if (ratio?.attributes.unit === 'percent') throw new RangeError('Percent compressor ratio is ambiguous without an exporter profile.');
					params = { threshold: read(device, 'Threshold', -24, 'threshold'), ratio: read(device, 'Ratio', 4, 'ratio'), knee: 0,
						attack: read(device, 'Attack', .003, 'attack'), release: read(device, 'Release', .25, 'release'), makeupGain: read(device, 'OutputGain', 0) };
				} else if (device.name === 'NoiseGate') {
					type = 'gate'; params = { threshold: read(device, 'Threshold', -50, 'threshold'), attack: read(device, 'Attack', .005, 'attack'),
						release: read(device, 'Release', .1, 'release'), hold: 0, rangeDb: read(device, 'Range', -80, 'rangeDb') };
				} else if (device.name === 'Limiter') {
					if (number(childElement(device, 'InputGain'), 0) !== 0 || number(childElement(device, 'OutputGain'), 0) !== 0) throw new RangeError('Limiter gain stages require an explicit adapter.');
					type = 'limiter'; params = { ceiling: read(device, 'Threshold', -1, 'ceiling'), lookahead: read(device, 'Attack', .005), release: read(device, 'Release', .1, 'release') };
				} else throw new RangeError('A compatible installed plug-in adapter is required.');
				effect = createEffect(type, { id, enabled, params, state: { interchange: payload } });
				for (const mapping of mappings) {
					if (!mapping.node.attributes.id) continue;
					const descriptor = effectParameterInventory(strip, effect, { sampleRate: build.sampleRate }).descriptors.find(value => value.address.kind === 'effect'
						&& value.address.parameterId === mapping.parameterId && value.address.elementId === mapping.elementId);
					if (!descriptor?.automatable) continue;
					const target: ParameterTarget = { kind: leaf ? 'track' : 'group', id: owner.id, parameter: 'effect', unit: mapping.node.attributes.unit ?? null,
						address: descriptor.address, minimum: descriptor.minimum, maximum: descriptor.maximum, convert: mapping.convert ?? (value => value) };
					build.parameters.set(mapping.node.attributes.id, target);
				}
				addDeliveryReportItem(build.draft, { code: 'dawproject.device-converted', disposition: 'converted', severity: 'warning', data: { name, type }, message: 'A generic device uses the editor realtime processor. Parameter values are mapped explicitly; DSP, knee, gate ratio and limiter attack behavior can differ. The original device and automation are retained.' });
			} catch (error) {
				effect = interchangeMissingEffect('dawproject', id, name, payload, enabled);
				addDeliveryReportItem(build.draft, { code: 'dawproject.device-state-preserved', disposition: 'converted', severity: 'warning', data: { name, reason: String(error), statePresent: retainState }, message: 'The device identity, parameter values and automation are retained in a bypassed rack entry; compatible native state requires a format-specific installed plug-in adapter.' });
			}
			if (path && !retainState) addDeliveryReportItem(build.draft, { code: 'dawproject.device-state-missing', disposition: 'missing', severity: 'warning', data: { path }, message: 'The plug-in state file is external, missing or beyond the state budget. Its reference is retained.' });
			effects.push(effect);
		}
		owner.effects = effects;
	};
	for (const track of document.tracks) visit(track);
}

function number(node: XmlElement | null, fallback: number): number {
	const units: Record<string, readonly string[]> = { Freq: ['hertz', 'semitones'], Gain: ['decibel'], InputGain: ['decibel'], OutputGain: ['decibel'], Threshold: ['decibel'], Range: ['decibel'], Attack: ['seconds'], Release: ['seconds'], Q: ['linear'], Ratio: ['linear', 'percent'] };
	if (node?.attributes.unit && units[node.name] && !units[node.name]!.includes(node.attributes.unit)) throw new RangeError('Unsupported generic effect parameter unit.');
	const value = node?.attributes.value;
	if (value === undefined) return fallback;
	if (!value.trim() || !Number.isFinite(Number(value))) throw new RangeError('Invalid generic effect parameter.');
	return Number(value);
}
