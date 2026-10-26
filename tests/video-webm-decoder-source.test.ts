/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobSource, EncodedPacketSink, Input, WEBM } from 'mediabunny';
import { createHash } from 'node:crypto';
import { prepareVideoWebmDecoderSource } from '../src/common/editor/video-webm-decoder-source.ts';
import { demuxVideoTiming } from '../src/common/editor/video-timing-demux.ts';
import { createDesktopSelectedRangeBlob } from '../src/common/editor/desktop-selected-range-blob.ts';

const RECORDED_WEBM =
	'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';
function recording(): File { return new File([Buffer.from(RECORDED_WEBM, 'base64')], 'Screen recording.webm', { type: 'video/webm' }); }

test('a live MediaRecorder decoder source gains a complete duration without changing its original', async () => {
 const original=recording(), before=new Uint8Array(await original.arrayBuffer());
 const decoded=await prepareVideoWebmDecoderSource(original);
 assert.notEqual(decoded,original);
 const body=new Uint8Array(await decoded.arrayBuffer());
 const durationOffset=body.findIndex((value,index)=>value===0x44&&body[index+1]===0x89&&body[index+2]===0x88);
 assert.ok(durationOffset>0);assert.equal(new DataView(body.buffer).getFloat64(durationOffset+3),771);
 assert.equal(body.length,before.length+11);assert.deepEqual(new Uint8Array(await original.arrayBuffer()),before);
 assert.equal(original.name,'Screen recording.webm');assert.equal(original.size,1714);assert.equal(original.type,'video/webm');
 assert.deepEqual(await demuxVideoTiming(decoded),await demuxVideoTiming(original));
 assert.deepEqual(await packets(decoded),await packets(original));
});

test('non-WebM input returns its identity without reading source bytes', async context => {
 context.mock.method(Blob.prototype,'slice',():Blob=>{throw new Error('Unexpected native read');});
 const original=new File(['not webm'],'Camera.mp4',{type:'video/mp4'});
 assert.equal(await prepareVideoWebmDecoderSource(original),original);
});

test('declared Duration returns the original decoder body without indexing packets', async () => {
 const changed=await prepareVideoWebmDecoderSource(recording());
 const declared=new File([await changed.arrayBuffer()],'Existing.webm',{type:'video/webm'});
 assert.equal(await prepareVideoWebmDecoderSource(declared,{maximumTotalBytes:512}),declared);
});

test('bounded header and timing reads reject their shared exhausted budget', async () => {
 await assert.rejects(prepareVideoWebmDecoderSource(recording(),{maximumTotalBytes:8}),/budget/u);
});

test('aborted preparation retains its cancellation', async () => {
 const c=new AbortController();c.abort(new DOMException('Stopped','AbortError'));
 await assert.rejects(prepareVideoWebmDecoderSource(recording(),{signal:c.signal}),{name:'AbortError'});
});

test('selected desktop ranges retain their real capability instead of an empty Blob clone', async () => {
 const id='a'.repeat(64);let reads=0;
 const selected=createDesktopSelectedRangeBlob({id,name:'Screen.webm',mimeType:'video/webm',size:1714,lastModified:0,
 readProfile:'selected-range-v1',url:`soundscaper-app://bundle/_desktop/read/selected-range-v1/${id}/Screen.webm`},
 {fetch:()=>{reads++;return Promise.reject(new Error('Unexpected capability read'));}});
 assert.equal(await prepareVideoWebmDecoderSource(selected),selected);assert.equal(reads,0);
});

async function packets(blob:Blob){
 const input=new Input({source:new BlobSource(blob),formats:[WEBM]});
 try{const track=await input.getPrimaryVideoTrack();assert.ok(track);const out=[];
 for await(const p of new EncodedPacketSink(track).packets())out.push({time:p.timestamp,type:p.type,rgb:createHash('sha256').update(p.data).digest('hex'),alpha:createHash('sha256').update(p.sideData.alpha??new Uint8Array()).digest('hex')});
 return out;}finally{input.dispose();}
}

test('indexed or checksummed live sources keep all existing byte offsets', async () => {
	const original=new Uint8Array(await recording().arrayBuffer());
	for(const marker of[Uint8Array.of(0x11,0x4d,0x9b,0x74,0x80),Uint8Array.of(0x1c,0x53,0xbb,0x6b,0x80),Uint8Array.of(0xbf,0x84,0,0,0,0),Uint8Array.of(0xa7,0x81,0)]){
		const input=new File([original.subarray(0,48),marker,original.subarray(48)],'Indexed.webm',{type:'video/webm'});
		assert.equal(await prepareVideoWebmDecoderSource(input),input);
	}
	const checksum=withInfo(Uint8Array.of(0xbf,0x84,0,0,0,0));
	assert.equal(await prepareVideoWebmDecoderSource(checksum),checksum);
});

test('a finite Cluster after a live Cluster keeps its embedded Position byte offset', async () => {
	const bytes=new Uint8Array(await recording().arrayBuffer());
	const suffix=bytes.subarray(320),length=suffix.length+7;
	const header=Uint8Array.of(0x1f,0x43,0xb6,0x75,0x40|(length>>8),length&255);
	const input=new File([bytes.subarray(0,320),header,Uint8Array.of(0xe7,0x81,0,0xa7,0x82,1,16),suffix],
		'Mixed clusters.webm',{type:'video/webm'});
	const timing=await demuxVideoTiming(input);assert.ok(timing);
	assert.equal(timing.presentationTicks.length,23);
	assert.equal(await prepareVideoWebmDecoderSource(input),input);
});

test('a finite Segment retains identity without parsing its packet payload', async () => {
	const bytes=new Uint8Array(await recording().arrayBuffer());
	bytes.set([1,0,0,0,0,0,6,0x82],40);
	const input=new File([bytes],'Finite.webm',{type:'video/webm'});
	assert.equal(await prepareVideoWebmDecoderSource(input,{maximumTotalBytes:128}),input);
});

test('growing the Info size field retains all encoded RGB and alpha', async () => {
	const input=withInfo(Uint8Array.from([0xec,0xe1,...new Uint8Array(97)]));
	const output=await prepareVideoWebmDecoderSource(input);
	assert.equal(output.size,input.size+12);assert.deepEqual(await packets(output),await packets(input));
	assert.deepEqual(await demuxVideoTiming(output),await demuxVideoTiming(input));
});

test('a nonzero first video timestamp contributes to the declared absolute end', async () => {
	const bytes=new Uint8Array(await recording().arrayBuffer());bytes[138]=100;
	const output=await prepareVideoWebmDecoderSource(new File([bytes],'Offset.webm',{type:'video/webm'}));
	assert.equal(await durationValue(output),871);
});

test('reordered video presentation uses the minimum absolute timestamp as its origin', async () => {
	const bytes=new Uint8Array(await recording().arrayBuffer());bytes[138]=100;
	// The second block precedes the first in presentation order, but stays at a positive absolute time.
	bytes[325]=255;bytes[326]=246;
	const input=new File([bytes],'Reordered.webm',{type:'video/webm'});
	const output=await prepareVideoWebmDecoderSource(input);
	assert.equal(await durationValue(output),871,'the absolute final end is100+738+33, independent of decode order');
	assert.deepEqual(new Uint8Array(await output.arrayBuffer()).subarray(89),bytes.subarray(78),
		'all video, alpha, timestamps and reference payloads after Info remain byte-identical');
});

test('an unsupported single frame or laced profile stays with the native backend', async () => {
	const bytes=new Uint8Array(await recording().arrayBuffer());
	const single=new File([bytes.subarray(0,320)],'Single.webm',{type:'video/webm'});
	assert.equal(await prepareVideoWebmDecoderSource(single),single);
	bytes[147]=2;const laced=new File([bytes],'Laced.webm',{type:'video/webm'});
	assert.equal(await prepareVideoWebmDecoderSource(laced),laced);
});

test('truncation inside a recognized live packet is never rewritten as complete media', async () => {
	const input=new File([await recording().slice(0,-2).arrayBuffer()],'Cut.webm',{type:'video/webm'});
	await assert.rejects(prepareVideoWebmDecoderSource(input),/ended inside/u);
});

test('a virtual custom Blob is never concatenated as native empty bytes', async () => {
	class Virtual extends Blob { override get size():number{return 1714;}override get type():string{return 'video/webm';} }
	const input=new Virtual();assert.equal(await prepareVideoWebmDecoderSource(input),input);
});

test('cancellation during a native ranged read is observed before publication', async context => {
	const input=recording(),controller=new AbortController(),slice=Blob.prototype.slice;
	context.mock.method(Blob.prototype,'slice',function(this:Blob,...args:Parameters<Blob['slice']>):Blob{
		controller.abort(new DOMException('Stopped in read','AbortError'));return slice.apply(this,args);
	});
	await assert.rejects(prepareVideoWebmDecoderSource(input,{signal:controller.signal}),{name:'AbortError'});
});

function withInfo(extra:Uint8Array<ArrayBuffer>):File{
	const bytes=Buffer.from(RECORDED_WEBM,'base64'),length=25+extra.length;
	assert.ok(length<127);
	return new File([bytes.subarray(0,52),Uint8Array.of(0x80|length),bytes.subarray(53,78),extra,bytes.subarray(78)],'Metadata.webm',{type:'video/webm'});
}
async function durationValue(input:Blob):Promise<number>{
	const bytes=new Uint8Array(await input.arrayBuffer());
	const offset=bytes.findIndex((byte,index)=>byte===0x44&&bytes[index+1]===0x89&&bytes[index+2]===0x88);
	assert.ok(offset>=0);return new DataView(bytes.buffer).getFloat64(offset+3);
}
