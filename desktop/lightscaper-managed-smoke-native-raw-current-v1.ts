/* SPDX-License-Identifier: AGPL-3.0-only */
import {createHash} from 'node:crypto';
import {LightscaperNativePhotoRawCurrentV1 as Raw,type LightscaperNativePhotoRawDecodedCurrentV1 as Decoded} from './lightscaper-native-photo-raw-current-v1.ts';
import {LightscaperNativePhotoRawProcessCurrentV1 as Process} from './lightscaper-native-photo-raw-process-current-v1.ts';
/** Paired managed-smoke installation only. Every call forwards the actual
 * trusted owner/consumer unchanged; no decoder output or retirement is made. */
export function installLightscaperManagedSmokeRawObserverCurrentV1(){
 const original=Raw.prototype.withDecoded,retire=Process.prototype.retire,active=new Set<Promise<unknown>>(),retired=new WeakSet<Process>();
 const samples:Array<Readonly<{mode:string;tier:string|null;format:string;outputSha256:string;width:number;height:number}>>=[];
 let decoded=0,wiped=0,retirements=0,closed=false,closing:Promise<void>|undefined;const failures:unknown[]=[];
 const wrapper:Raw['withDecoded']=function<Result>(this:Raw,value:unknown,consume:(view:Readonly<Decoded>)=>Result|Promise<Result>,options:Readonly<{signal?:AbortSignal}>={}):Promise<Result>{
  let plane:Uint8Array<ArrayBuffer>|undefined;
  const accepted=Reflect.apply(original,this,[value,(view:Readonly<Decoded>):Result|Promise<Result>=>{
   if(decoded>=32||view.engine!=='lightscaper-libraw-native'||view.upstream!=='0.22.2'||view.width>32||view.height>32||view.byteLength>32768)throw new Error('Native RAW smoke decoded outside its actual tiny fixture.');
   if(createHash('sha256').update(view.bytes).digest('hex')!==view.contentSha256)throw new Error('Observed actual native RAW plane SHA differs.');
   plane=view.bytes;decoded++;samples.push(Object.freeze({mode:view.mode,tier:view.tier,format:view.format,outputSha256:view.contentSha256,width:view.width,height:view.height}));return consume(view);
  },options]) as Promise<Result>;
  active.add(accepted);void accepted.then(()=>{try{if(plane){if(plane.some(byte=>byte!==0))throw new Error('Actual native RAW plane did not wipe after its real consumer retired.');wiped++;}}catch(error){failures.push(error);}active.delete(accepted);},(error:unknown)=>{try{if(plane&&plane.every(byte=>byte===0))wiped++;}catch(cleanup){failures.push(cleanup);}failures.push(error);active.delete(accepted);});return accepted;
 };
 const retirement:Process['retire']=function(this:Process,force:boolean){const work=Reflect.apply(retire,this,[force]) as ReturnType<Process['retire']>;void work.then(exit=>{if(!retired.has(this)&&exit.code===0&&exit.signal===null){retired.add(this);retirements++;}},()=>undefined);return work;};
 Raw.prototype.withDecoded=wrapper;Process.prototype.retire=retirement;
 const settle=async():Promise<void>=>{while(active.size)await Promise.allSettled([...active]);if(failures.length)throw new AggregateError([...failures],'Actual native RAW qualification work failed.');};
 return Object.freeze({settle,snapshot:()=>Object.freeze({engine:'lightscaper-libraw-native' as const,upstream:'0.22.2' as const,decoded,wiped,retired:retirements,active:active.size,samples:Object.freeze([...samples])}),
  close():Promise<void>{if(closing)return closing;closed=true;closing=settle().finally(()=>{if(Raw.prototype.withDecoded===wrapper)Raw.prototype.withDecoded=original;if(Process.prototype.retire===retirement)Process.prototype.retire=retire;});return closing;},isClosed:()=>closed});
}
