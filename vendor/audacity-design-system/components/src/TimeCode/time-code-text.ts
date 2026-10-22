import type { TimeCodeFormat } from './time-code-formats';
import { timeCodeFrameCount, timeCodeFrameFormat, timeCodeFrameSeconds, timeCodeLabelledFrameCount } from './time-code-frames';

/** Free text semantics ported from Audacity design system 20ce5547. */
export function parseTimeText(text: string, format: TimeCodeFormat, sampleRate = 44100, frameRate = 24): number | null {
	const input = text.trim().toLowerCase().replace(/,/gu, '.').replace(/\s+/gu, '');
	if (!input) return null;
	const frames = timeCodeFrameFormat(format, frameRate);
	if (frames && !frames.total) {
		const clock = /^(\d+):(\d{2}):(\d{2})[:;](\d{2,3})$/u.exec(input);
		if (clock) {
			const [hours, minutes, seconds, ordinal] = clock.slice(1).map(Number) as [number, number, number, number];
			if (minutes >= 60 || seconds >= 60 || ordinal >= frames.nominalRate) return null;
			const totalMinutes = hours * 60 + minutes;
			if (frames.drop && totalMinutes % 10 !== 0 && seconds === 0 && ordinal < frames.nominalRate / 15) return null;
			const value = timeCodeFrameSeconds([hours, minutes, seconds, ordinal], frames);
			return Number.isFinite(value) ? value : null;
		}
	}
	let seconds: number;
	if (/^[+]?(\d+\.?\d*|\.\d+)$/u.test(input)) {
		seconds = Number(input) / (format === 'samples' ? sampleRate : frames?.total ? frames.rate : 1);
	} else {
		const units = /^(?:(\d+\.?\d*)d)?(?:(\d+\.?\d*)h)?(?:(\d+\.?\d*)m)?(?:(\d+\.?\d*)s)?$/u.exec(input);
		if (units && units.slice(1).some(value => value !== undefined)) {
			seconds = Number(units[1] ?? 0) * 86400 + Number(units[2] ?? 0) * 3600 + Number(units[3] ?? 0) * 60 + Number(units[4] ?? 0);
		} else if (/^(\d+:)*(\d+\.?\d*|\.\d+)$/u.test(input)) {
			const parts = input.split(':').map(Number);
			if (parts.length > 4) return null;
			const weights = [1, 60, 3600, 86400];
			seconds = parts.reverse().reduce((sum, part, index) => sum + part * weights[index], 0);
		} else return null;
	}
	return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** Start free entry in the units selected by the visible field. */
export function formatTimeText(seconds: number, format: TimeCodeFormat, sampleRate = 44100, frameRate = 24): string {
	if (format === 'samples') return String(seconds * sampleRate);
	const frames = timeCodeFrameFormat(format, frameRate);
	if (!frames) return String(seconds);
	const count = timeCodeFrameCount(seconds, frames.rate, sampleRate);
	if (frames.total) return String(count);
	const labelled = timeCodeLabelledFrameCount(count, frames);
	const units = [Math.floor(labelled / frames.nominalRate / 3600), Math.floor(labelled / frames.nominalRate / 60) % 60,
		Math.floor(labelled / frames.nominalRate) % 60, labelled % frames.nominalRate]
		.map(value => String(value).padStart(2, '0'));
	return `${units.slice(0, 3).join(':')}${frames.drop ? ';' : ':'}${units[3]}`;
}
