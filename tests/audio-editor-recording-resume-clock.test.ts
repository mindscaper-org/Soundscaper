/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { StreamingRecorderProcessor } from '../src/common/editor/recording-worklet.js';
interface Port { onmessage(event: { data: Record<string, unknown> }): void; postMessage(message: unknown): void }
function isPort(value: unknown): value is Port { return Boolean(value && typeof value === 'object' && 'onmessage' in value && typeof value.onmessage === 'function' && 'postMessage' in value && typeof value.postMessage === 'function'); }
function fixture(fixedStopFrame = false) {
	const processor = new StreamingRecorderProcessor({ processorOptions: { channelCount: 1, chunkFrames: 128, fixedStopFrame } });
	const port: unknown = processor.port; assert.ok(isPort(port));
	const messages: Record<string, unknown>[] = [];
	port.postMessage = (message: unknown) => { assert.ok(message && typeof message === 'object'); messages.push(Object.fromEntries(Object.entries(message))); if ('type' in message && message.type === 'audio-chunk' && 'chunkId' in message) port.onmessage({ data: { type: 'chunk-ack', chunkId: message.chunkId } }); };
	const send = (data: Record<string, unknown>) => { port.onmessage({ data }); };
	const process = (value = .25) => { processor.process([[new Float32Array(128).fill(value)]], [[new Float32Array(128)]]); };
	const chunks = () => messages.filter(message => message.type === 'audio-chunk').map(message => { assert.ok(Array.isArray(message.channels)); const channel: unknown = message.channels[0]; assert.ok(channel instanceof Float32Array); return { frame: message.frameStart, samples: [...channel] }; });
	send({ type: 'start', startFrame: 0, stopFrame: 1024 }); process(); send({ type: 'pause' });
	return { processor, messages, send, process, chunks };
}
test('future Resume keeps the PDC warmup out of captured PCM on an exact source frame', () => {
	const f=fixture(); f.send({type:'resume',confirmResume:true,requestId:7,startFrame:450});
	f.process(1); f.process(1); f.process(.5); f.send({type:'flush'});
	assert.deepEqual(f.chunks().map(c=>[c.frame,c.samples.length]),[[0,128],[450,62]]);
	assert.ok(f.chunks()[1]?.samples.every(value=>value===.5));
	assert.ok(f.messages.some(m=>m.type==='resume-scheduled'&&m.requestId===7&&m.startFrame===450));
});
test('ordinary immediate Resume remains synchronous and captures the first resumed block', () => {
	const f=fixture(); f.process(1);f.send({type:'resume'});f.process(.5);
	assert.deepEqual(f.chunks().map(c=>[c.frame,c.samples.length]),[[0,128],[256,128]]);
});
test('an ordinary bounded punch includes the whole scheduled pause when moving its end', () => {
	const f=fixture();f.send({type:'resume',confirmResume:true,requestId:7,startFrame:512});
	f.process();f.process();f.process();f.process();f.send({type:'flush'});
	assert.equal(f.processor.stopFrame,1408);
	assert.deepEqual(f.chunks().map(c=>c.frame),[0,512]);
});
test('a timed deadline stays absolute during a scheduled Resume', () => {
	const f=fixture(true);f.send({type:'resume',confirmResume:true,requestId:7,startFrame:1152});
	for(let i=0;i<8;i++)f.process(1);
	assert.equal(f.processor.recording,false);assert.equal(f.processor.stopFrame,1024);
	assert.deepEqual(f.chunks().map(c=>c.frame),[0]);
});
for(const action of ['pause','stop'])test(`${action} cancels a confirmed future Resume before its source frame`,()=>{
	const f=fixture();f.send({type:'resume',confirmResume:true,requestId:7,startFrame:512});f.send({type:action});
	for(let i=0;i<6;i++)f.process(1);f.send({type:'flush'});
	assert.deepEqual(f.chunks().map(c=>c.frame),[0]);
});
test('a missed future Resume truthfully remains paused and reports the available frame',()=>{
	const f=fixture();f.process();f.process();f.send({type:'resume',confirmResume:true,requestId:7,startFrame:128});f.process(1);
	assert.deepEqual(f.chunks().map(c=>c.frame),[0]);
	assert.ok(f.messages.some(m=>m.type==='resume-missed'&&m.requestId===7&&Number(m.firstAvailableFrame)>=384));
});
test('a newer confirmed Resume supersedes the older future frame before capture',()=>{
	const f=fixture();f.send({type:'resume',confirmResume:true,requestId:7,startFrame:384});
	f.send({type:'resume',confirmResume:true,requestId:8,startFrame:640});
	for(let i=0;i<5;i++)f.process(.75);f.send({type:'flush'});
	assert.deepEqual(f.chunks().map(c=>c.frame),[0,640]);
});
