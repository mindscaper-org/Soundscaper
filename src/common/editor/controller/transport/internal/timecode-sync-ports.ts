/* SPDX-License-Identifier: AGPL-3.0-only */
import type { TimecodeRate, TimecodeReading } from '../../../timecode-sync-format.ts';

export interface TimecodeSyncSettings {
	readonly receive: 'off' | 'mtc' | 'ltc';
	readonly sendMtc: boolean;
	readonly sendLtc: boolean;
	readonly rate: TimecodeRate;
	/** Timecode seconds at timeline zero. Shared by send and receive. */
	readonly offsetSeconds: number;
	readonly midiInput: string;
	readonly midiOutput: string;
	readonly audioInput: string;
	readonly audioOutput: string;
	readonly inputChannel: number;
	readonly outputChannel: number;
}
export const DEFAULT_TIMECODE_SYNC_SETTINGS: TimecodeSyncSettings = Object.freeze({
	receive: 'off', sendMtc: false, sendLtc: false, rate: '25', offsetSeconds: 0,
	midiInput: '', midiOutput: '', audioInput: '', audioOutput: '', inputChannel: 0, outputChannel: 0,
});
export interface TimecodeTransportPosition {
	readonly seconds: number;
	readonly playing: boolean;
	readonly speed: number;
}
export interface TimecodeIoSession {
	sendMidi(bytes: number[], timestamp: number): void;
	clearMidi(): void;
	updateLtc(position: TimecodeTransportPosition): void;
	close(): Promise<void>;
}
export interface TimecodeDevices {
	readonly midiInputs: readonly { id: string; name: string }[];
	readonly midiOutputs: readonly { id: string; name: string }[];
	readonly audioInputs: readonly { id: string; name: string }[];
	readonly audioOutputs: readonly { id: string; name: string }[];
}
export interface TimecodeSyncIo {
	/** Activate user-gesture-bound clocks synchronously; release unused preparation. */
	prepare?(settings: TimecodeSyncSettings): () => Promise<void>;
	devices(midi: boolean): Promise<TimecodeDevices>;
	open(settings: TimecodeSyncSettings, receive: (reading: TimecodeReading, timestamp: number) => void, fail: (error: unknown) => void, signal?: AbortSignal): Promise<TimecodeIoSession>;
}
