/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacketSink, Input, OggOutputFormat, Output, WEBM } from 'mediabunny';
import { opusPaddingAvFixture } from './ordinary-ogg-opus-fixture.ts';

/** Decode the unchanged Opus packets through Ogg, independently of Matroska CodecDelay rounding. */
export async function opusPaddingReferenceOgg(): Promise<Uint8Array<ArrayBuffer>> {
	const input = new Input({ source: new BlobSource(opusPaddingAvFixture()), formats: [WEBM] });
	try {
		const track = await input.getPrimaryAudioTrack();
		assert.ok(track);
		const config = await track.getDecoderConfig();
		assert.ok(config);
		const packets = [];
		for await (const packet of new EncodedPacketSink(track).packets()) packets.push(packet);
		assert.equal(packets.length, 6);
		const target = new BufferTarget(), output = new Output({ format: new OggOutputFormat(), target });
		const source = new EncodedAudioPacketSource('opus');
		output.addAudioTrack(source);
		await output.start();
		for (let index = 0; index < packets.length; index++) {
			// The fixture has six 20 ms packets, 312 leading frames and 648 final padding frames.
			await source.add(packets[index]!.clone({ timestamp: index * .02 - 312 / 48_000,
				duration: index === packets.length - 1 ? 312 / 48_000 : .02 }), { decoderConfig: config });
		}
		await output.finalize();
		assert.ok(target.buffer);
		return new Uint8Array(target.buffer);
	} finally { input.dispose(); }
}
