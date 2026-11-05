/* SPDX-License-Identifier: AGPL-3.0-only */

import { metadataBlobBytes } from './audio-metadata-values.ts';

export function apeFooter(bytes: Uint8Array, inspectItems = true): Readonly<{ size: number; header: boolean }> | null {
	if (new TextDecoder().decode(bytes.subarray(0, 8)) !== 'APETAGEX') return null;
	if (bytes.length !== 32) throw new RangeError('Invalid APEv2 trailer.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const size = view.getUint32(12, true);
	if (view.getUint32(8, true) !== 2000 || size < 32) throw new RangeError('Invalid APEv2 trailer.');
	if (inspectItems && (size > 16 * 1024 ** 2 || view.getUint32(16, true) > 256)) throw new RangeError('APEv2 metadata exceeds its bounded inspection limit.');
	return { size, header: Boolean(view.getUint32(20, true) & 0x8000_0000) };
}

/** Native WavPack readers also admit a complete APEv2 tag before the audio. */
export async function leadingApeTagEnd(file: Blob, signal?: AbortSignal): Promise<number> {
	signal?.throwIfAborted();
	const header = await metadataBlobBytes(file, 0, Math.min(32, file.size), signal);
	const info = apeFooter(header, false);
	if (!info) return 0;
	const flags = new DataView(header.buffer).getUint32(20, true);
	const footerAbsent = Boolean(flags & 0x4000_0000);
	const end = info.size + (footerAbsent ? 0 : 32);
	if (!info.header || !(flags & 0x2000_0000)
		|| end > file.size - 32) throw new RangeError('The leading APEv2 header is invalid or exceeds its file.');
	if (footerAbsent) return end;
	const footer = await metadataBlobBytes(file, end - 32, end, signal);
	const declared = apeFooter(footer, false);
	if (!declared || !declared.header || declared.size !== info.size
		|| new DataView(footer.buffer).getUint32(16, true) !== new DataView(header.buffer).getUint32(16, true)
		|| new DataView(footer.buffer).getUint32(20, true) & 0x2000_0000) {
		throw new RangeError('The leading APEv2 footer is missing or inconsistent.');
	}
	return end;
}

/** ID3v1 can follow APEv2, but never starts inside an encoded WavPack block. */
export async function apeTagEnd(file: Blob, audioStart: number, signal?: AbortSignal): Promise<number> {
	const footer = await metadataBlobBytes(file, file.size - 32, file.size, signal);
	if (apeFooter(footer, false)) return file.size;
	if (file.size >= 160) {
		const marker = await metadataBlobBytes(file, file.size - 128, file.size - 125, signal);
		if (new TextDecoder().decode(marker) === 'TAG' && await isExternalWavPackTrailer(file, audioStart, file.size - 128, signal)) return file.size - 128;
	}
	return file.size;
}

async function isExternalWavPackTrailer(file: Blob, offset: number, position: number, signal?: AbortSignal): Promise<boolean> {
	while (offset < position) {
		const header = await metadataBlobBytes(file, offset, offset + 32, signal);
		if (new TextDecoder().decode(header.subarray(0, 4)) !== 'wvpk') return true;
		const size = new DataView(header.buffer).getUint32(4, true) + 8;
		if (size < 32 || size > file.size - offset) return true;
		offset += size;
		if (offset > position) return false;
	}
	return true;
}
