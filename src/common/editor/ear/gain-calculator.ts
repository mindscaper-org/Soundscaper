/* SPDX-License-Identifier: AGPL-3.0-only */
import { admBedSpeakers, type AdmBedSpeaker } from '../adm-bed-layout.ts';
import { EAR_LAYOUTS, isEarLayout } from './layouts.ts';
import manifest from './source-manifest.json';

interface EarExports extends WebAssembly.Exports {
	memory: WebAssembly.Memory;
	_initialize: () => void;
	ear_initialize: (layout: number) => number;
	ear_speaker_name: (index: number) => number;
	ear_label_pointer: () => number;
	ear_pack_pointer: () => number;
	ear_gains_pointer: () => number;
	ear_error: () => number;
	ear_direct: (azimuth: number, elevation: number, lfe: number) => number;
	ear_object: (azimuth: number, elevation: number, distance: number) => number;
	ear_close: () => void;
}

export interface EarPosition { readonly azimuth: number; readonly elevation: number; readonly distance: number }
export interface EarGainCalculator {
	readonly channelCount: number;
	direct(speaker: AdmBedSpeaker, packRef?: string): readonly number[];
	object(position: EarPosition): readonly number[];
	close(): void;
}

/** Each render owns an isolated, fixed-memory instance of the pinned EBU core. */
export async function createEarGainCalculator(bytes: Uint8Array, layout: unknown): Promise<EarGainCalculator> {
	if (!isEarLayout(layout)) throw new RangeError('The EBU EAR output layout is unsupported.');
	const owned = Uint8Array.from(bytes);
	const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', owned)),
		(byte) => byte.toString(16).padStart(2, '0')).join('');
	if (digest !== manifest.wasm.sha256) throw new Error('The EBU EAR renderer failed its integrity check.');
	const { instance } = await WebAssembly.instantiate(owned, {
		env: { _tzset_js: () => undefined },
		wasi_snapshot_preview1: {
			fd_write: () => 0, fd_close: () => 0, fd_seek: () => 0,
			environ_sizes_get: () => 0, environ_get: () => 0,
			proc_exit: () => { throw new Error('The EBU EAR renderer terminated.'); },
		},
	});
	const api = instance.exports as EarExports;
	api._initialize();
	const count = api.ear_initialize(EAR_LAYOUTS.indexOf(layout));
	const readText = (pointer: number): string => {
		const memory = new Uint8Array(api.memory.buffer);
		return new TextDecoder().decode(memory.subarray(pointer, memory.indexOf(0, pointer)));
	};
	if (count < 1) throw new Error(`EBU EAR: ${readText(api.ear_error())}`);
	const names = Array.from({ length: count }, (_, index) => readText(api.ear_speaker_name(index)));
	const order = admBedSpeakers(layout).map(({ speakerLabel }) => names.indexOf(speakerLabel));
	if (count !== order.length || order.some((index) => index < 0)) {
		api.ear_close();
		throw new Error('The EBU EAR output channel order does not match the delivery layout.');
	}
	let closed = false;
	const active = (): void => { if (closed) throw new Error('The EBU EAR renderer is closed.'); };
	const result = (status: number): readonly number[] => {
		if (status !== 0) throw new Error(`EBU EAR: ${readText(api.ear_error())}`);
		const gains = new Float32Array(api.memory.buffer, api.ear_gains_pointer(), count);
		const ordered = order.map((index) => gains[index]!);
		if (ordered.some((gain) => !Number.isFinite(gain))) throw new Error('The EBU EAR gains are invalid.');
		return ordered;
	};
	const writeText = (pointer: number, value: string): void => {
		const encoded = new TextEncoder().encode(value);
		if (encoded.length >= 64) throw new RangeError('The EBU EAR speaker identifier is too long.');
		const target = new Uint8Array(api.memory.buffer, pointer, 64);
		target.fill(0); target.set(encoded);
	};
	return Object.freeze({ channelCount: count,
		direct(speaker: AdmBedSpeaker, packRef = '') {
			active(); validatePosition({ ...speaker, distance: 1 });
			writeText(api.ear_label_pointer(), speaker.speakerLabel);
			writeText(api.ear_pack_pointer(), packRef);
			return result(api.ear_direct(speaker.azimuth, speaker.elevation, Number(speaker.lowFrequencyEffects)));
		},
		object(position: EarPosition) {
			active(); validatePosition(position);
			return result(api.ear_object(position.azimuth, position.elevation, position.distance));
		},
		close() { if (!closed) { closed = true; api.ear_close(); } },
	});
}

function validatePosition(position: EarPosition): void {
	if (!Number.isFinite(position.azimuth) || Math.abs(position.azimuth) > 180
		|| !Number.isFinite(position.elevation) || Math.abs(position.elevation) > 90
		|| !Number.isFinite(position.distance) || position.distance < 0 || position.distance > 1) {
		throw new RangeError('The EBU EAR source position is invalid.');
	}
}
