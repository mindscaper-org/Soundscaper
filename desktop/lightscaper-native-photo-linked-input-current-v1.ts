/* SPDX-License-Identifier: AGPL-3.0-only */
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import type { LinkedGrantFileCaptureCurrentV1, LinkedGrantFileCurrentV1 } from './lightscaper-native-photo-linked-grants-borrows-current-v1.ts';
import { captureNativeFilesystemOptions, checkNativeFilesystemSignal as check } from './lightscaper-native-photo-granted-filesystem-signal-current-v1.ts';
import { combineLinkedGrantFailuresCurrentV1 as combine } from './lightscaper-native-photo-linked-grants-failures-current-v1.ts';
export interface LightscaperNativePhotoLinkedInputViewCurrentV1 {
	readonly sourceId: string; readonly byteLength: number; readonly contentSha256: string;
	read(offset: number, length: number): Promise<Uint8Array>;
}
export interface LightscaperNativePhotoLinkedInputCurrentV1 {
	readonly facts: Readonly<{ sourceId: string; displayName: string; byteLength: number; contentSha256: string; modifiedTime: null }>;
	close(): Promise<void>;
}
export interface LinkedInputStateCurrentV1 {
	readonly owner: object; readonly namespace: string; readonly captured: LinkedGrantFileCaptureCurrentV1; readonly file: LinkedGrantFileCurrentV1;
	readonly input: Readonly<LightscaperNativePhotoLinkedInputCurrentV1>; readonly checkOwner: () => void;
	readonly borrowers: Set<Promise<unknown>>; consumed: boolean; closing: Promise<void> | null;
}
const INPUTS = new WeakMap<object, LinkedInputStateCurrentV1>();
const canonical = (path: string): string => { const actual=realpathSync(path); return process.platform==='win32'?actual.toLowerCase():actual; };
/** Called only after the owning genuine native file has been fully hashed. */
export function createLinkedInputCurrentV1(owner: object, namespace: string, captured: LinkedGrantFileCaptureCurrentV1,
	file: LinkedGrantFileCurrentV1, sha256: string, displayName: string, checkOwner: () => void,
	retire: (state: LinkedInputStateCurrentV1, close: () => Promise<void>) => Promise<void>): Readonly<LightscaperNativePhotoLinkedInputCurrentV1> {
	const facts=Object.freeze({sourceId:`linked-${randomBytes(32).toString('hex')}`,displayName,byteLength:file.byteLength,contentSha256:sha256,modifiedTime:null});
	const input=Object.freeze({facts,close:():Promise<void>=>{
		if(state.closing)return state.closing; let resolve!:()=>void,reject!:(reason:unknown)=>void;
		state.closing=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
		void Promise.allSettled([...state.borrowers]).then(()=>retire(state,()=>file.close())).then(resolve,reject);return state.closing;
	}}); const state:LinkedInputStateCurrentV1={owner,namespace:canonical(namespace),captured,file,input,checkOwner,borrowers:new Set(),consumed:false,closing:null}; INPUTS.set(input,state); return input;
}
export function readLinkedInputCurrentV1(value: unknown, owner: object, namespace: string, consume = false): LinkedInputStateCurrentV1 {
	const state=value!==null&&typeof value==='object'?INPUTS.get(value):undefined;
	if(!state||state.owner!==owner||state.namespace!==canonical(namespace)||state.closing)throw new TypeError('A genuine current same-namespace linked input is required.');
	state.checkOwner();state.file.assertCurrent();if(consume){if(state.consumed)throw new Error('Linked publication input is already consumed.');state.consumed=true;}return state;
}
/** Genuine private lookup and registration precede options/callback admission.
 * Consumer settlement and accepted actual reads are joined, never raced. */
export function withLightscaperNativePhotoLinkedInputCurrentV1<Result>(value: unknown,mediaDatabasePath:string,
	consume:(view:Readonly<LightscaperNativePhotoLinkedInputViewCurrentV1>)=>Result|PromiseLike<Result>,options?:Readonly<{signal?:AbortSignal}>):Promise<Result>{
	const state=value!==null&&typeof value==='object'?INPUTS.get(value):undefined;
	if(!state||state.namespace!==canonical(mediaDatabasePath)||state.closing)return Promise.reject(new TypeError('A genuine current linked input is required.'));
	if(state.borrowers.size)return Promise.reject(new Error('Linked input consumer is busy.'));
	let resolve!:(value:Result|PromiseLike<Result>)=>void,reject!:(reason:unknown)=>void;
	const pending=new Promise<Result>((yes,no)=>{resolve=yes;reject=no;});state.borrowers.add(pending);
	void(async()=>{
		const active=new Set<Promise<unknown>>();let busy=false,failed=false,ended=false,primary:unknown,result!:Result;
		try{
			state.checkOwner();state.file.assertCurrent();const signal=captureNativeFilesystemOptions(options);check(signal);
			if(typeof consume!=='function')throw new TypeError('Linked input requires its actual owning consumer.');
			const current=():void=>{if(ended)throw new Error('Linked input consumer has retired.');check(signal);if(state.closing)throw new Error('Linked input is closing.');state.checkOwner();state.file.assertCurrent();};
			const view=Object.freeze({sourceId:state.input.facts.sourceId,byteLength:state.file.byteLength,contentSha256:state.input.facts.contentSha256,
				read:(offset:number,length:number):Promise<Uint8Array>=>{
					if(busy)return Promise.reject(new Error('Linked input pull is busy.'));busy=true;
					const work=(async()=>{current();if(!Number.isSafeInteger(offset)||Object.is(offset,-0)||offset<0||!Number.isSafeInteger(length)||length<1||length>1048576||offset>state.file.byteLength-length)throw new RangeError('Linked input pull exceeds its bounded range.');
						const bytes=await state.file.read(offset,length);try{current();return bytes;}catch(error){bytes.fill(0);throw error;}})();
					active.add(work);void work.then(()=>{active.delete(work);busy=false;},()=>{active.delete(work);busy=false;});return work;
				}});
			result=await consume(view);ended=true;check(signal);state.checkOwner();state.file.assertCurrent();
		}catch(error){failed=true;primary=error;}
		ended=true;const joins=await Promise.allSettled([...active]),failures=joins.flatMap(item=>item.status==='rejected'?[item.reason as unknown]:[]);
		if(failures.length)throw combine([...(failed?[primary]:[]),...failures],'Linked consumer and actual pull failed.');if(failed)throw primary;return result;
	})().then(result=>{state.borrowers.delete(pending);resolve(result);},(error:unknown)=>{state.borrowers.delete(pending);reject(error);});return pending;
}
