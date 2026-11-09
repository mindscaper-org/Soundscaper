/* SPDX-License-Identifier: AGPL-3.0-only */
import { admitMacroAudioInput, macroAudioInputKey, type MacroAudioInputResolver } from '../../macro-audio-input.ts';

interface EncodedAudio { readonly name: string; readonly bytes: ArrayBuffer }
interface InputFile { readonly name: string; readonly size: number; arrayBuffer(): Promise<ArrayBuffer>; slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> } }
export interface MacroAudioInputFileService {
	readonly isDesktop: boolean;
	chooseFiles(request: { purpose: string; multiple?: boolean }): Promise<unknown[]>;
	withReadDescriptors(descriptors: unknown[], options: { signal: AbortSignal }, consume: (files: readonly InputFile[]) => Promise<EncodedAudio>): Promise<EncodedAudio>;
}
interface DecodedAudio {
	readonly sampleRate: number; readonly numberOfChannels: number;
	getChannelData(channel: number): Float32Array;
}

/** One user-picked encoded reference per name, reused across an entire file batch. */
export function createMacroAudioInputResolver(
	fileService: MacroAudioInputFileService,
	decode: (bytes: ArrayBuffer, sampleRate: number) => Promise<DecodedAudio>,
): MacroAudioInputResolver {
	const selected = new Map<string, Promise<EncodedAudio>>();
	return async (keyValue, sampleRate, signal) => {
		signal.throwIfAborted();
		if (!fileService.isDesktop) throw new Error('Input audio files for macro programs require the desktop app.');
		const key = macroAudioInputKey(keyValue);
		let encoded = selected.get(key);
		if (!encoded) {
			if (selected.size >= 4) throw new RangeError('A macro may use at most four input audio files.');
			encoded = (async () => {
				const descriptors = await fileService.chooseFiles({ purpose: 'audio', multiple: false });
				if (!descriptors.length) throw new DOMException('Input selection was cancelled.', 'AbortError');
				return fileService.withReadDescriptors(descriptors, { signal }, async files => {
					signal.throwIfAborted();
					const file = files[0];
					if (!file || file.size > 16 * 1024 * 1024) throw new RangeError('Choose an input audio file smaller than 16 MiB.');
					const bytes = new Uint8Array(file.size);
					for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
						signal.throwIfAborted();
						bytes.set(new Uint8Array(await file.slice(offset, Math.min(file.size, offset + 1024 * 1024)).arrayBuffer()), offset);
					}
					return { name: file.name, bytes: bytes.buffer };
				});
			})();
			selected.set(key, encoded);
		}
		const input = await encoded; signal.throwIfAborted();
		const decoded = await decode(input.bytes.slice(0), sampleRate); signal.throwIfAborted();
		return admitMacroAudioInput({ name: input.name, sampleRate: decoded.sampleRate,
			channels: Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel)) }, sampleRate);
	};
}
