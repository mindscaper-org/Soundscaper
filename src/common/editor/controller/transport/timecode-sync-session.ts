/* SPDX-License-Identifier: AGPL-3.0-only */
import { encodeMtcFullFrame, encodeMtcQuarterFrames } from '../../timecode-mtc.ts';
import { TIMECODE_RATES, timecodeDayFrames, timecodeRate, type TimecodeReading } from '../../timecode-sync-format.ts';
import { DEFAULT_TIMECODE_SYNC_SETTINGS, type TimecodeSyncIo, type TimecodeSyncSettings, type TimecodeIoSession } from './internal/timecode-sync-ports.ts';
export { DEFAULT_TIMECODE_SYNC_SETTINGS } from './internal/timecode-sync-ports.ts';
export type { TimecodeDevices, TimecodeSyncSettings, TimecodeSyncIo } from './internal/timecode-sync-ports.ts';

export interface TimecodeSyncPosition {
	readonly projectId: string | null;
	readonly sampleRate: number;
	readonly positionFrame: number;
	readonly playing: boolean;
	readonly speed: number;
	readonly blocked: boolean;
	readonly receiveBlocked?: boolean;
}
export interface TimecodeSyncSnapshot {
	readonly settings: TimecodeSyncSettings;
	readonly active: boolean;
	readonly locked: boolean;
	readonly error: string;
}
interface Dependencies {
	readonly io: TimecodeSyncIo;
	readonly read: () => TimecodeSyncPosition;
	readonly seek: (frame: number) => unknown;
	readonly play: () => Promise<unknown>;
	readonly pause: () => Promise<unknown>;
	readonly now?: () => number;
	readonly schedule?: (tick: () => void) => () => void;
}

const SIGNAL_TIMEOUT_MS = 500;
interface ReceivedTimecode {
	readonly reading: TimecodeReading;
	readonly timestamp: number;
}

/** Own one opt-in sync session; permissions, timers and asynchronous chase share a generation. */
export function createTimecodeSyncSession(d: Dependencies) {
	const now = d.now ?? (() => performance.now());
	const schedule = d.schedule ?? ((tick: () => void) => {
		const timer = globalThis.setInterval(tick, 10);
		return () => globalThis.clearInterval(timer);
	});
	let snapshot: TimecodeSyncSnapshot = Object.freeze({ settings: DEFAULT_TIMECODE_SYNC_SETTINGS, active: false, locked: false, error: '' });
	const listeners = new Set<() => void>();
	let generation = 0, disposed = false;
	let devices: TimecodeIoSession | null = null;
	let retirement: Promise<void> | null = null;
	let admission: AbortController | null = null;
	let cancelTimer: (() => void) | null = null;
	let projectId: string | null = null;
	let lastReceive = -Infinity;
	let chasing = false;
	let pending: (ReceivedTimecode & { lost?: boolean }) | null = null;
	let processing: Promise<void> = Promise.resolve();
	let pumping = false;
	let lastSend: { seconds: number; time: number; playing: boolean; speed: number } | null = null;
	let quarterAt = 0, quarterPiece = 0, quarterBytes: number[] = [];

	function publish(update: Partial<TimecodeSyncSnapshot>): void {
		snapshot = Object.freeze({ ...snapshot, ...update });
		for (const listener of listeners) listener();
	}
	function fail(error: unknown): void {
		publish({ error: error instanceof Error ? error.message : String(error), locked: false });
		void configure(DEFAULT_TIMECODE_SYNC_SETTINGS, true).catch(() => {});
	}
	async function close(stopChase = false): Promise<void> {
		admission?.abort(); admission = null;
		cancelTimer?.(); cancelTimer = null;
		const session = devices; devices = null;
		lastSend = null; pending = null;
		const ownedProjectId = projectId;
		const wasChasing = chasing; chasing = false;
		if (retirement) return retirement;
		const closing = retire();
		retirement = closing;
		try { await closing; }
		finally { if (retirement === closing) retirement = null; }

		async function retire(): Promise<void> {
			const releasing = session?.close();
			const pausing = stopChase && wasChasing && canChase(ownedProjectId) ? d.pause() : undefined;
			const results = await Promise.allSettled([releasing, pausing]);
			for (const result of results) if (result.status === 'rejected') throw result.reason;
		}
	}
	function canChase(ownedProjectId: string | null): boolean {
		const position = d.read();
		return position.projectId === ownedProjectId && !position.blocked && !position.receiveBlocked;
	}
	async function configure(settings: TimecodeSyncSettings, retainError = false): Promise<void> {
		if (disposed) return;
		if (!TIMECODE_RATES.includes(settings.rate) || !Number.isFinite(settings.offsetSeconds) || Math.abs(settings.offsetSeconds) > 86400
			|| ![settings.inputChannel, settings.outputChannel].every(channel => Number.isInteger(channel) && channel >= 0 && channel < 32)
			|| !['off', 'mtc', 'ltc'].includes(settings.receive)) throw new RangeError('Invalid timecode synchronization settings.');
		const ownGeneration = ++generation;
		publish({ settings: Object.freeze({ ...settings }), active: false, locked: false, ...(retainError ? {} : { error: '' }) });
		let releasePreparation: (() => Promise<void>) | undefined;
		try {
			releasePreparation = settings.sendLtc || settings.receive === 'ltc' ? d.io.prepare?.(settings) : undefined;
			await close(true);
			if (generation !== ownGeneration) return;
			if (!settings.sendLtc && !settings.sendMtc && settings.receive === 'off') return;
			const position = d.read();
			if (!position.projectId || position.blocked) throw new Error('Timecode synchronization requires an idle, open project.');
			if (settings.receive !== 'off' && position.receiveBlocked) throw new Error('Receiving timecode requires normal playback with loop playback and recording disabled.');
			projectId = position.projectId; lastReceive = -Infinity;
			const opening = new AbortController(); admission = opening;
			const openingInput: { latest: ReceivedTimecode | null } = { latest: null };
			const session = await d.io.open(settings, (reading, timestamp) => {
				if (ownGeneration !== generation || settings.receive === 'off') return;
				if (reading.direction !== 0 && now() - timestamp >= SIGNAL_TIMEOUT_MS) return;
				if (!snapshot.active) { openingInput.latest = { reading, timestamp }; return; }
				lastReceive = timestamp;
				pending = { reading, timestamp };
				pump();
			}, error => { if (ownGeneration === generation) fail(error); }, opening.signal);
			if (admission === opening) admission = null;
			if (ownGeneration !== generation || disposed) { await session.close(); return; }
			devices = session;
			const first = openingInput.latest;
			openingInput.latest = null;
			if (first && (first.reading.direction === 0 || now() - first.timestamp < SIGNAL_TIMEOUT_MS)) {
				lastReceive = first.timestamp;
				pending = first;
			}
			publish({ active: true });
			if (pending) pump();
			cancelTimer = schedule(tick);
			tick();
		} catch (error) {
			if (ownGeneration !== generation || disposed) return;
			await close(true);
			if (ownGeneration !== generation || disposed) return;
			publish({ active: false, error: error instanceof Error ? error.message : String(error) });
			throw error;
		} finally { await releasePreparation?.(); }
	}
	function pump(): void {
		if (pumping) return;
		pumping = true;
		const ownGeneration = generation, ownProjectId = projectId;
		processing = (async () => {
			while (pending && ownGeneration === generation) {
				const next = pending; pending = null;
				const position = d.read();
				if (position.projectId !== projectId || position.blocked || position.receiveBlocked) return;
				if (next.lost) { if (position.playing) await d.pause(); chasing = false; continue; }
				const age = now() - next.timestamp;
				if (next.reading.direction !== 0 && age >= SIGNAL_TIMEOUT_MS) continue;
				const moving = next.reading.direction === 1;
				let seconds = next.reading.frame / timecodeRate(next.reading.rate) - snapshot.settings.offsetSeconds;
				if (moving) seconds += Math.max(0, age) / 1000;
				const day = timecodeDayFrames(next.reading.rate) / timecodeRate(next.reading.rate);
				const unwrapped = seconds + Math.round((position.positionFrame / position.sampleRate - seconds) / day) * day;
				// Wire labels have no day field. Retain the nearest timeline day,
				// including a negative offset's wrapped origin and quantization remainder.
				if (unwrapped >= Math.min(0, snapshot.settings.offsetSeconds)) seconds = unwrapped;
				if (!moving || seconds < 0) {
					if (position.playing) await d.pause();
					if (generation !== ownGeneration || !canChase(ownProjectId)) return;
					d.seek(Math.max(0, Math.round(seconds * position.sampleRate)));
					chasing = false;
				} else {
					const target = Math.round(seconds * position.sampleRate);
					if (!position.playing || Math.abs(position.positionFrame - target) > position.sampleRate / timecodeRate(next.reading.rate) * 2) d.seek(target);
					chasing = true;
					if (!position.playing) await d.play();
					if (!canChase(ownProjectId)) return;
					if (generation !== ownGeneration) {
						await d.pause();
						return;
					}
				}
				if (!next.lost && !snapshot.locked) publish({ locked: true });
			}
		})().catch(error => { if (ownGeneration === generation) fail(error); }).finally(() => { pumping = false; if (pending) pump(); });
	}
	function tick(): void {
		if (!devices || !snapshot.active) return;
		try {
			const position = d.read(), time = now();
			if (position.projectId !== projectId || position.blocked || (snapshot.settings.receive !== 'off' && position.receiveBlocked)) {
				void configure(DEFAULT_TIMECODE_SYNC_SETTINGS).catch(fail); return;
			}
			if (snapshot.locked && time - lastReceive > SIGNAL_TIMEOUT_MS) {
				publish({ locked: false });
				if (chasing) {
					chasing = false;
					pending = { reading: { frame: Math.round((position.positionFrame / position.sampleRate + snapshot.settings.offsetSeconds) * timecodeRate(snapshot.settings.rate)), rate: snapshot.settings.rate, direction: 0 }, timestamp: time, lost: true };
					pump();
				}
			}
			const seconds = position.positionFrame / position.sampleRate + snapshot.settings.offsetSeconds;
			const playing = position.playing && position.speed > 0;
			const settings = snapshot.settings, rate = timecodeRate(settings.rate);
			const expected = lastSend ? lastSend.seconds + (lastSend.playing ? (time - lastSend.time) / 1000 * lastSend.speed : 0) : NaN;
			const changed = !lastSend || playing !== lastSend.playing || position.speed !== lastSend.speed || Math.abs(seconds - expected) > 0.5 / rate;
			if (settings.sendMtc && changed) {
				devices.clearMidi();
				devices.sendMidi(encodeMtcFullFrame(Math.floor(seconds * rate), settings.rate), time);
				quarterAt = time; quarterPiece = 0;
			}
			if (settings.sendMtc && playing) {
				const interval = 1000 / (rate * 4 * position.speed);
				// Never replay a backlog after a stalled renderer.
				if (quarterAt < time - interval) { quarterAt = time; quarterPiece = 0; }
				for (let count = 0; quarterAt < time + 30 && count < 32; count++) {
					if (quarterPiece === 0) quarterBytes = encodeMtcQuarterFrames(Math.floor((seconds + (quarterAt - time) / 1000 * position.speed) * rate), settings.rate);
					devices.sendMidi([0xf1, quarterBytes[quarterPiece]], quarterAt);
					quarterAt += interval; quarterPiece = (quarterPiece + 1) % 8;
				}
			}
			if (settings.sendLtc) devices.updateLtc({ seconds, playing, speed: position.speed });
			lastSend = { seconds, time, playing, speed: position.speed };
		} catch (error) { fail(error); }
	}
	return Object.freeze({
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		configure, tick,
		settled: async () => { while (pumping) await processing; },
		dispose: async () => { generation++; disposed = true; chasing = false; await close(); await processing; listeners.clear(); },
	});
}
export type TimecodeSyncSession = ReturnType<typeof createTimecodeSyncSession>;
