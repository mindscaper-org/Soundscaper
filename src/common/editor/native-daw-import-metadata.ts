/* SPDX-License-Identifier: AGPL-3.0-only */
import { dawArray, dawRecord, dawInteger, dawNumber, dawText } from './native-daw-import-values.ts';
import { childElement, childElements, type XmlElement } from './dawproject-xml.ts';
import { ardourMidiTempos } from './ardour-import-midi.ts';
import { rationalFromDouble } from './dawproject-format.ts';
import { timelineImportIssue, type TimelineInterchangeDocument } from './timeline-interchange-types.ts';
import { createInterchangeMidiClock, type InterchangeMidiTempo } from './interchange-midi-clock.ts';

export function soundcraftMetadata(root: Readonly<Record<string, unknown>>, issues: TimelineInterchangeDocument['issues'][number][]) {
	const markers: NonNullable<TimelineInterchangeDocument['markers']>[number][] = [];
	for (const value of dawArray(root.markers ?? [])) {
		const marker = dawRecord(value);
		if (marker.start === undefined) { issues.push(timelineImportIssue('soundcraft', 'markers-omitted', 'A marker without a sample position is omitted.')); continue; }
		const frame = dawInteger(marker.start, 'marker position'), endFrame = dawInteger(marker.end ?? frame, 'marker end');
		markers.push({ frame, name: dawText(marker.name), ...(endFrame > frame ? { endFrame } : {}) });
	}
	const tempos = root.tempo === undefined ? [] : dawArray(dawRecord(root.tempo).tempos).map(value => {
		const tempo = dawRecord(value); return { beat: dawInteger(tempo.tick, 'tempo tick') / 960, bpm: dawNumber(tempo.bpm, NaN) };
	});
	const meters = root.tempo === undefined ? [] : dawArray(dawRecord(root.tempo).meters ?? []).map(value => {
		const meter = dawRecord(value); return { beat: dawInteger(meter.tick, 'meter tick') / 960, numerator: dawInteger(meter.numerator, 'meter numerator', 1), denominator: dawInteger(meter.denominator, 'meter denominator', 1) };
	});
	return { markers, ...(tempos.length ? { tempoMap: tempoMap(tempos) } : {}), ...(meters.length ? { signatureMap: signatureMap(meters, 'soundcraft', issues) } : {}) };
}

export function ardourMetadata(root: XmlElement, sampleRate: number, issues: TimelineInterchangeDocument['issues'][number][]) {
	const markers: NonNullable<TimelineInterchangeDocument['markers']>[number][] = [];
	const frame = (value: string | undefined) => {
		if (!value || !/^(?:a)?\d+$/u.test(value)) throw new RangeError('Unsupported Ardour location clock.');
		return Math.round(Number(value.replace(/^a/u, '')) * (value.startsWith('a') ? sampleRate / 282240000 : 1));
	};
	for (const location of childElements(childElement(root, 'Locations') ?? root, 'Location')) {
		try {
			const start = frame(location.attributes.start), end = frame(location.attributes.end ?? location.attributes.start);
			markers.push({ frame: start, name: location.attributes.name ?? '', ...(end > start ? { endFrame: end } : {}) });
		} catch { issues.push(timelineImportIssue('ardour', 'location-clock-omitted', 'A location with an unsupported clock is omitted.')); }
	}
	if (!childElement(root, 'TempoMap')) return { markers };
	try {
		const map = childElement(root, 'TempoMap')!;
		const meters = childElements(childElement(map, 'Meters') ?? map, 'Meter').map(node => {
			const quarters = /^(\d+):(\d+)$/u.exec(node.attributes.quarters ?? '');
			if (!quarters) throw new RangeError('Unsupported Ardour meter position.');
			return { beat: Number(quarters[1]) + Number(quarters[2]) / 1920, numerator: Number(node.attributes['divisions-per-bar']), denominator: Number(node.attributes['note-value']) };
		});
		return { markers, tempoMap: tempoMap(ardourMidiTempos(root)), ...(meters.length ? { signatureMap: signatureMap(meters, 'ardour', issues) } : {}) };
	}
	catch { issues.push(timelineImportIssue('ardour', 'tempomap-omitted', 'Only modern stepped Ardour tempo maps are supported; the default project tempo is used.')); return { markers }; }
}

function tempoMap(tempos: readonly InterchangeMidiTempo[]) {
	createInterchangeMidiClock(tempos);
	return { mode: 'musical' as const, events: tempos.map((tempo, index) => ({ id: `imported-tempo-${index}`, beat: rationalFromDouble(tempo.beat), bpm: rationalFromDouble(tempo.bpm) })) };
}

function signatureMap(input: readonly Readonly<{ beat: number; numerator: number; denominator: number }>[], format: 'ardour' | 'soundcraft', issues: TimelineInterchangeDocument['issues'][number][]) {
	const meters = [...input].sort((a, b) => a.beat - b.beat);
	if (meters[0]?.beat !== 0) meters.unshift({ beat: 0, numerator: 4, denominator: 4 });
	const events: { id: string; bar: number; numerator: number; denominator: number }[] = [];
	let previousBeat = 0, bar = 0, quartersPerBar = 4;
	for (const meter of meters) {
		const span = (meter.beat - previousBeat) / quartersPerBar;
		if (!Number.isSafeInteger(span) || span < 0 || !Number.isSafeInteger(meter.numerator) || meter.numerator < 1 || meter.numerator > 32 || ![1, 2, 4, 8, 16, 32].includes(meter.denominator)) {
			issues.push(timelineImportIssue(format, 'meter-omitted', 'An unsupported or off-bar meter change is omitted.')); continue;
		}
		bar += span; previousBeat = meter.beat; quartersPerBar = meter.numerator * 4 / meter.denominator;
		if (events.at(-1)?.bar === bar) events.pop();
		events.push({ id: `imported-signature-${events.length}`, bar, numerator: meter.numerator, denominator: meter.denominator });
	}
	return { events };
}
