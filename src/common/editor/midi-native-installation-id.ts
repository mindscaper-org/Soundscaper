/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { MidiNativeInstrument } from './midi-native-instrument.ts';

export function midiNativeInstallationId(instrument: Pick<MidiNativeInstrument, 'binarySha256' | 'stablePluginId'>): string {
	return `i${bytesToHex(sha256(new TextEncoder().encode(`${instrument.binarySha256}\0${instrument.stablePluginId}`))).slice(0, 15)}`;
}
