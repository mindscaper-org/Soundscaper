/* SPDX-License-Identifier: AGPL-3.0-only */
/** Original, synthetic RIFX test data. Not an After Effects qualification fixture. */
export interface AepFixtureChunk { readonly id: string; readonly body: Uint8Array }
const encoder = new TextEncoder();
export function aepBytes(size: number, write: (view: DataView) => void): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(size); write(new DataView(bytes.buffer)); return bytes;
}
export function aepChunk(id: string, body: Uint8Array): AepFixtureChunk { return { id, body }; }
export function aepString(text: string): AepFixtureChunk { return aepChunk('Utf8', encoder.encode(text)); }
export function aepChunks(chunks: readonly AepFixtureChunk[]): Uint8Array<ArrayBuffer> {
	const size = chunks.reduce((sum, chunk) => sum + 8 + chunk.body.length + chunk.body.length % 2, 0), bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(encoder.encode(chunk.id), offset); new DataView(bytes.buffer).setUint32(offset + 4, chunk.body.length);
		bytes.set(chunk.body, offset + 8); offset += 8 + chunk.body.length + chunk.body.length % 2;
	}
	return bytes;
}
export function aepList(type: string, children: readonly AepFixtureChunk[]): AepFixtureChunk {
	const data = aepChunks(children), body = new Uint8Array(data.length + 4); body.set(encoder.encode(type)); body.set(data, 4); return aepChunk('LIST', body);
}
export function aepFile(children: readonly AepFixtureChunk[], trailer = ''): Uint8Array<ArrayBuffer> {
	const data = aepChunks(children), tail = encoder.encode(trailer), bytes = new Uint8Array(12 + data.length + tail.length);
	bytes.set(encoder.encode('RIFX')); new DataView(bytes.buffer).setUint32(4, data.length + 4); bytes.set(encoder.encode('Egg!'), 8); bytes.set(data, 12); bytes.set(tail, 12 + data.length); return bytes;
}
export function aepNamed(name: string, chunk: AepFixtureChunk): readonly AepFixtureChunk[] { return [aepChunk('tdmn', encoder.encode(name)), chunk]; }
export function aepNumeric(name: string, values: readonly number[], keys: readonly { readonly time: number; readonly value: readonly number[]; readonly hold?: boolean }[] = []): readonly AepFixtureChunk[] {
	const dims = values.length, header = aepBytes(124, view => { view.setUint8(0, 0xdb); view.setUint8(1, 0x99); view.setUint8(3, dims); view.setUint32(12, 25600); view.setUint8(68, keys.length ? 1 : 0); });
	const value = aepChunk('cdat', aepBytes(dims * 8, view => values.forEach((entry, index) => view.setFloat64(index * 8, entry))));
	const records = keys.map(key => aepBytes(8 + 40 * dims, view => { view.setInt32(0, key.time); view.setUint8(4, 1); view.setUint8(5, key.hold ? 3 : 1); key.value.forEach((entry, index) => view.setFloat64(8 + index * 8, entry)); }));
	const data = new Uint8Array(records.reduce((sum, record) => sum + record.length, 0)); records.forEach((record, index) => data.set(record, index * record.length));
	const animation = aepList('list', [aepChunk('lhd3', aepBytes(52, view => { view.setUint32(0, 0xd00bee); view.setUint32(8, keys.length); view.setUint32(16, 8 + 40 * dims); })), aepChunk('ldat', data)]);
	return aepNamed(name, aepList('tdbs', [aepChunk('tdsb', aepBytes(4, view => view.setUint32(0, 1))), aepChunk('tdb4', header), keys.length ? animation : value]));
}
export function aepLayer(id: number, sourceId: number, name: string, properties: readonly AepFixtureChunk[] = [], parent = 0, content: readonly AepFixtureChunk[] = [], kind = 0): AepFixtureChunk {
	return aepList('Layr', [aepChunk('ldta', aepBytes(164, view => {
		view.setUint32(0, id); view.setInt32(8, 1); view.setUint32(16, 25600); view.setUint32(24, 25600); view.setInt32(28, 128000); view.setUint32(32, 25600);
		view.setUint8(39, 7); view.setUint32(40, sourceId); view.setUint8(99, 2); view.setUint32(108, 1); view.setUint32(128, kind); view.setUint32(132, parent);
	})), aepString(name), aepList('tdgp', [...aepNamed('ADBE Transform Group', aepList('tdgp', properties)), ...content])]);
}
export function aepComposition(id: number, name: string, layers: readonly AepFixtureChunk[], ntsc = false): AepFixtureChunk {
	return aepList('Item', [aepChunk('idta', aepBytes(64, view => { view.setUint16(0, 4); view.setUint32(16, id); })), aepString(name),
		aepChunk('cdta', aepBytes(204, view => { view.setUint32(4, ntsc ? 800 : 1024); view.setUint32(8, ntsc ? 23976 : 25600); view.setUint32(36, 0xffffffff); view.setUint32(44, ntsc ? 120000 : 128000); view.setUint16(140, 64); view.setUint16(142, 48); view.setUint32(144, 1); view.setUint32(148, 1); })), ...layers]);
}
export function aepSolid(id = 3): AepFixtureChunk {
	const options = aepBytes(64, view => { [1, 0.25, 0.5, 0.75].forEach((value, index) => view.setFloat32(10 + index * 4, value)); }); options.set(encoder.encode('Original solid'), 26);
	const source = aepBytes(222, view => { view.setUint32(30, 64); view.setUint32(34, 48); view.setUint32(42, 1); }); source.set(encoder.encode('Soli'), 22);
	return aepList('Item', [aepChunk('idta', aepBytes(64, view => { view.setUint16(0, 7); view.setUint32(16, id); })), aepString(''), aepList('Pin ', [aepChunk('sspc', source), aepChunk('opti', options)])]);
}
export function aepImageFixture(): Uint8Array<ArrayBuffer> {
	const source = aepBytes(222, view => { view.setUint32(30, 1); view.setUint32(34, 1); view.setUint32(42, 1); });
	source.set(encoder.encode('File'), 22);
	const footage = aepList('Item', [aepChunk('idta', aepBytes(64, view => { view.setUint16(0, 7); view.setUint32(16, 3); })), aepString('Pixel.png'),
		aepList('Pin ', [aepChunk('sspc', source), aepChunk('opti', new Uint8Array(58)), aepList('Als2', [aepChunk('alas', encoder.encode(JSON.stringify({ fullpath: '/never/automatically/open/Pixel.png' })))])])]);
	return aepFile([aepList('Fold', [aepComposition(1, 'Image', [aepLayer(10, 3, 'Pixel')]), footage])]);
}
export function nativeAepFixture(): Uint8Array<ArrayBuffer> {
	return aepFile([aepList('Fold', [aepComposition(1, 'Duplicate', [aepLayer(10, 3, 'Original solid', [...aepNumeric('ADBE Position', [32, 24, 0]), ...aepNumeric('ADBE Opacity', [1], [{ time: 0, value: [1] }, { time: 25600, value: [0.5] }])])]), aepComposition(2, 'Duplicate', [aepLayer(20, 1, 'Nested')], true), aepSolid()])]);
}
