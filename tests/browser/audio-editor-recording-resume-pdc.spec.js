/* SPDX-License-Identifier: AGPL-3.0-only */
import {expect,test} from './audio-editor-test-fixtures.js';
import {bootEditor,waitForProjectActivation} from './audio-editor-test-helpers.js';
import {createSoundscaperProject} from '../../src/soundscaper/editor-project.ts';
import {createAudioSource,createAudioClip,createAudioTrack} from '../../src/common/editor/project-media-factory.ts';
import {createProjectStore} from '../../src/common/editor/storage.js';
import {exportScapeProject} from '../../src/common/editor/scape-project.js';
for(const lookahead of [0,100])test(`ordinary Record Resume postfader loopback lookahead=${lookahead}`,async({page})=>{
	// Loop actual programme output into a real microphone MediaStream; capture PCM is not stubbed.
	await page.addInitScript(()=>{
		const Native=AudioContext,Node=AudioWorkletNode,connect=AudioNode.prototype.connect;
		const state=window.__resumePdc={context:null,stream:null,events:[],chunks:[]};
		function shared(){if(!state.context||state.context.state==='closed'){state.context=new Native({sampleRate:48000});state.destination=state.context.createMediaStreamDestination();state.stream=state.destination.stream;}return state.context;}
		window.AudioContext=new Proxy(Native,{construct(){return shared();}});
		AudioNode.prototype.connect=function(destination,...ports){const result=Reflect.apply(connect,this,[destination,...ports]);if(this.context===state.context&&destination===state.context.destination&&this!==state.destination)Reflect.apply(connect,this,[state.destination,...ports]);return result;};
		window.AudioWorkletNode=new Proxy(Node,{construct(target,args){const node=Reflect.construct(target,args);if(args[1]==='kw-audio-recorder'){node.port.addEventListener('message',event=>{const m=event.data;if(['paused','resumed','started'].includes(m.type))state.events.push({...m});if(m.type==='audio-chunk'){const channel=m.channels[0];let energy=0,peak=0;for(const value of channel){energy+=value*value;peak=Math.max(peak,Math.abs(value));}state.chunks.push({frame:m.frameStart,frames:m.frames,rms:Math.sqrt(energy/channel.length),peak});}});node.port.start();}return node;}});
		Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
			enumerateDevices:async()=>[{kind:'audioinput',deviceId:'default',groupId:'loopback',label:'Real programme loopback'}],
			getUserMedia:async()=>{shared();await state.context.resume();return state.stream;}
		}});
	});
	const source=createAudioSource({id:'source',sampleRate:48000,channelCount:1,frameCount:240000});
	const project=createSoundscaperProject({id:`resume-pdc-${lookahead}`,sampleRate:48000,sources:[source],clips:[createAudioClip({id:'bed',title:'Programme',sourceId:source.id,durationFrames:source.frameCount})],tracks:[createAudioTrack({id:'track',name:'Programme',clipIds:['bed'],effects:lookahead?[{id:'compressor',type:'audacity-compressor',enabled:true,params:{lookaheadMs:lookahead}}]:[]})]});
	const store=createProjectStore({indexedDB:null,preferOpfs:false,databaseName:crypto.randomUUID()});let buffer;try{const writer=await store.beginSourceWrite(source.storageKey,source);for(let offset=0;offset<source.frameCount;offset+=source.chunkFrames)await writer.write([Float32Array.from({length:Math.min(source.chunkFrames,source.frameCount-offset)},(_,n)=>.2*Math.sin(2*Math.PI*512*(n+offset)/48000))]);await writer.commit();buffer=Buffer.from(await(await exportScapeProject(project,store)).blob.arrayBuffer());}finally{await store.close();}
	const editor=await bootEditor(page,'/embed/en/');await editor.locator('[data-aup4-input]').setInputFiles({name:'Programme.sscape',mimeType:'application/zip',buffer});await expect(editor).toHaveAttribute('data-project-id',project.id);await waitForProjectActivation(editor);
	const record=editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');await expect(record).toBeEnabled();await record.click();
	await expect(record).toHaveAccessibleName('Pause recording');
	await expect.poll(()=>page.evaluate(()=>window.__resumePdc.chunks.some(c=>c.rms>.02))).toBe(true);
	await record.click();await expect(record).toHaveAccessibleName('Resume recording');await expect.poll(()=>page.evaluate(()=>window.__resumePdc.events.some(e=>e.type==='paused'))).toBe(true);
	const paused=await page.evaluate(()=>window.__resumePdc.context.currentTime);await expect.poll(()=>page.evaluate(()=>window.__resumePdc.context.currentTime)).toBeGreaterThan(paused+.2);
	await record.click();await expect(record).toHaveAccessibleName('Pause recording');
	await expect.poll(()=>page.evaluate(()=>{const resumed=window.__resumePdc.events.find(e=>e.type==='resumed');return resumed&&window.__resumePdc.chunks.some(c=>c.frame>=resumed.frame);})).toBe(true);
	await expect.poll(()=>page.evaluate(()=>{const state=window.__resumePdc,resumed=state.events.find(e=>e.type==='resumed');return resumed&&state.chunks.some(c=>c.frame>=resumed.frame+4096&&c.rms>.02);})).toBe(true);
	const actual=await page.evaluate(()=>{const state=window.__resumePdc,resumed=state.events.find(e=>e.type==='resumed');return{events:state.events,chunks:state.chunks.filter(c=>c.frame>=resumed.frame),before:state.chunks.filter(c=>c.frame<resumed.frame)};});await editor.getByRole('button',{name:'Stop',exact:true}).click();expect(actual.chunks[0].rms,'Resume must not insert a silent recording block before the backing graph becomes audible').toBeGreaterThan(.02);
});
