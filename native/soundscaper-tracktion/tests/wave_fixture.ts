/* SPDX-License-Identifier: AGPL-3.0-only */

export function wavFixture(): Buffer {
	const samples = 64;
	const rate = 48_000;
	const pcm = Buffer.alloc(44 + samples * 4);
	pcm.write('RIFF');
	pcm.writeUInt32LE(pcm.byteLength - 8, 4);
	pcm.write('WAVEfmt ', 8);
	pcm.writeUInt32LE(16, 16);
	pcm.writeUInt16LE(1, 20);
	pcm.writeUInt16LE(2, 22);
	pcm.writeUInt32LE(rate, 24);
	pcm.writeUInt32LE(rate * 4, 28);
	pcm.writeUInt16LE(4, 32);
	pcm.writeUInt16LE(16, 34);
	pcm.write('data', 36);
	pcm.writeUInt32LE(samples * 4, 40);
	for (let frame = 0; frame < samples; frame += 1) {
		pcm.writeInt16LE(4096, 44 + frame * 4);
		pcm.writeInt16LE(-2048, 46 + frame * 4);
	}
	return pcm;
}
