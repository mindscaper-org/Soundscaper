/* SPDX-License-Identifier: AGPL-3.0-only */
import { dawArray, dawRecord, dawNumber, dawInteger, dawText } from './native-daw-import-values.ts';
import { interchangeMissingEffect } from './interchange-effect-state.ts';
import { interchangeClipEnvelope } from './interchange-clip-envelope.ts';
import { timelineImportIssue, type TimelineInterchangeAutomation, type TimelineInterchangeDocument, type TimelineInterchangeStrip } from './timeline-interchange-types.ts';

export function soundcraftClipEnvelope(clip: Readonly<Record<string, unknown>>, issues: TimelineInterchangeDocument['issues'][number][]) {
	let clamped = false;
	const result = interchangeClipEnvelope(dawArray(clip.gain_env ?? []).map(value => {
		const pair = dawArray(value); return { frame: dawInteger(pair[0], 'clip envelope frame'), value: dawNumber(pair[1], 0), interpolation: 'linear' as const };
	}), dawInteger(clip.length, 'clip length', 1), value => 10 ** (value / 20), () => { clamped = true; });
	if (clamped) issues.push(timelineImportIssue('soundcraft', 'envelope-gain-clamped', 'Clip envelope gain is limited to the clip gain range.', 'converted'));
	return result;
}

export function soundcraftMixStrip(track: Readonly<Record<string, unknown>>, issues: TimelineInterchangeDocument['issues'][number][]): TimelineInterchangeStrip {
	const mixer = dawRecord(track.mixer), id = String(track.id);
	if (mixer.phase_invert === true) issues.push(timelineImportIssue('soundcraft', 'polarity-omitted', 'Track polarity inversion is not imported.'));
	const effects = dawArray(mixer.inserts ?? []).flatMap((value, index) => {
		if (!value) return [];
		const insert = dawRecord(value);
		issues.push(timelineImportIssue('soundcraft', 'effect-state-preserved', 'An insert retains its identity, parameters and opaque state in a bypassed rack entry.', 'converted'));
		return [interchangeMissingEffect('soundcraft', `${id}:insert:${index}`, dawText(insert.plugin), insert, insert.active !== false && insert.bypass !== true)];
	});
	const route = (value: unknown): string | null | undefined => {
		if (value === undefined || value === 'Main') return undefined;
		if (value === 'None') return null;
		const object = dawRecord(value);
		if (object.Bus !== undefined) return `bus:${dawInteger(object.Bus, 'bus ID')}`;
		issues.push(timelineImportIssue('soundcraft', 'hardware-output-converted', 'A hardware output is routed to the main output.', 'converted'));
		return undefined;
	};
	const sends = dawArray(mixer.sends ?? []).flatMap((value, index) => {
		if (!value) return [];
		const send = dawRecord(value), target = route(send.target);
		if (!target) return [];
		return [{ id: `${id}:send:${index}`, target, level: 10 ** (dawNumber(send.level_db, 0) / 20), enabled: send.active !== false && send.mute !== true,
			position: send.pre_fader === true ? 'pre-fader' as const : 'post-fader' as const }];
	});
	const automation: TimelineInterchangeAutomation[] = [];
	for (const value of dawArray(track.automation ?? [])) {
		const lane = dawRecord(value);
		if (lane.enabled !== true || mixer.automation_mode === 'Off') continue;
		const param = lane.param;
		let parameter: TimelineInterchangeAutomation['parameter'] | null = null, unit: TimelineInterchangeAutomation['unit'] = 'linear';
		if (param === 'Volume') { parameter = 'gain'; unit = 'decibel'; }
		else if (param === 'Mute' && track.inactive !== true) parameter = 'mute';
		else if (param && typeof param === 'object') {
			const p = dawRecord(param);
			if (p.Pan === 0 && dawArray(mixer.pan).length === 1) parameter = 'pan';
			else if (p.SendLevel !== undefined) { parameter = { sendId: `${id}:send:${dawInteger(p.SendLevel, 'send slot')}` }; unit = 'decibel'; }
		}
		if (!parameter) { issues.push(timelineImportIssue('soundcraft', 'automation-target-unavailable', 'Per-channel pan, send-pan/mute and foreign effect automation are retained with the source strip state but cannot run in this mix model.')); continue; }
		automation.push({ parameter, unit, points: dawArray(lane.points).map(value => {
			const point = dawRecord(value); return { frame: dawInteger(point.at, 'automation position'), value: dawNumber(point.value, 0), interpolation: parameter === 'mute' ? 'hold' as const : 'linear' as const };
		}) });
	}
	const trim = 10 ** (dawNumber(mixer.trim_db, 0) / 20);
	if (trim !== 1) {
		for (let index = 0; index < automation.length; index++) {
			const lane = automation[index]!;
			if (lane.parameter === 'gain') automation[index] = { ...lane, points: lane.points.map(point => ({ ...point, value: point.value + dawNumber(mixer.trim_db, 0) })) };
		}
	}
	if (track.instrument) effects.push(interchangeMissingEffect('soundcraft', `${id}:instrument`, 'Instrument', track.instrument));
	return { output: route(mixer.output), sends, effects, automation, opaqueExtensions: { 'soundscaper.interchange-mix': { format: 'soundcraft', automation: track.automation ?? [], mixer: { ...mixer, inserts: [] }, folder: track.folder ?? null } } };
}

export function soundcraftMixBuses(root: Readonly<Record<string, unknown>>): NonNullable<TimelineInterchangeDocument['buses']>[number][] {
	return dawArray(root.busses ?? []).map(value => {
		const bus = dawRecord(value); return { id: `bus:${dawInteger(bus.id, 'bus ID')}`, name: dawText(bus.name), channelCount: bus.format === 'Mono' ? 1 : 2,
			output: null as string | null };
	});
}

export function soundcraftAuxiliaryStrips(root: Readonly<Record<string, unknown>>, issues: TimelineInterchangeDocument['issues'][number][]) {
	const buses = soundcraftMixBuses(root);
	const folders: NonNullable<TimelineInterchangeDocument['folders']>[number][] = [];
	let master: TimelineInterchangeStrip | undefined;
	for (const value of dawArray(root.tracks)) {
		const track = dawRecord(value);
		if (!['Aux', 'Master', 'Folder'].includes(dawText(track.kind))) continue;
		const mixer = dawRecord(track.mixer), pans = dawArray(mixer.pan);
		const strip = { ...soundcraftMixStrip(track, issues), gain: 10 ** ((dawNumber(mixer.volume_db, 0) + dawNumber(mixer.trim_db, 0)) / 20),
			pan: pans.length === 1 ? dawNumber(pans[0], 0) : 0, mute: mixer.mute === true || track.inactive === true, solo: mixer.solo === true };
		if (track.kind === 'Master') { master = strip; continue; }
		const id = `${track.kind === 'Folder' ? 'folder' : 'aux'}:${String(track.id)}`;
		if (track.kind === 'Folder') folders.push({ id, name: dawText(track.name), parentFolderId: track.folder == null ? null : `folder:${String(track.folder)}`, mute: strip.automation?.some(curve => curve.parameter === 'mute') ? false : strip.mute, solo: strip.solo });
		buses.push({ ...strip, id, name: dawText(track.name), channelCount: track.format === 'Mono' ? 1 : 2, output: strip.output });
		if (mixer.input && typeof mixer.input === 'object') {
			const target = dawRecord(mixer.input).Bus, index = buses.findIndex(bus => bus.id === `bus:${String(target)}`);
			if (index >= 0) {
				const bus = buses[index]!;
				buses[index] = bus.output ? { ...bus, sends: [...bus.sends ?? [], { id: `${bus.id}:receive:${id}`, target: id, level: 1, enabled: true, position: 'post-fader' }] } : { ...bus, output: id };
			}
		}
	}
	return { buses, master, folders };
}
