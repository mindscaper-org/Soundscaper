/* SPDX-License-Identifier: AGPL-3.0-only */
import { NativeWriter,NativeReader,captureComponents,captureIdentity } from './lightscaper-native-photo-granted-filesystem-codec-current-v1.ts';
import type { NativePath,NativeFileIdentity } from './lightscaper-native-photo-granted-filesystem-current-v1.ts';
import type { LinkedGrantFileCaptureCurrentV1 } from './lightscaper-native-photo-linked-grants-borrows-current-v1.ts';
export interface LinkedLocatorCurrentV1 {readonly revision:number;readonly root:NativeFileIdentity;readonly file:NativeFileIdentity;readonly components:readonly NativePath[]}
export function encodeLinkedLocatorCurrentV1(capture:LinkedGrantFileCaptureCurrentV1,file:NativeFileIdentity):Uint8Array{
	const root=capture.row.identity,components=capture.components;
	const bytes=4+8+8+[root.volume,root.object,file.volume,file.object].reduce((sum,value)=>sum+value.length,0)+1+components.reduce((sum,value)=>sum+5+value.bytes.byteLength,0);
	if(bytes>65536)throw new RangeError('Linked native locator exceeds its fixed record bound.');
	return new NativeWriter().raw(Buffer.from('LLO1')).number(capture.row.grant.revision,8).identity(root).identity(file).components(components).finish();
}
export function decodeLinkedLocatorCurrentV1(value:Uint8Array):Readonly<LinkedLocatorCurrentV1>{
	if(!(value instanceof Uint8Array)||value.byteLength<1||value.byteLength>65536)throw new TypeError('Linked locator exceeds its atomic SQL bound.');
	const reader=new NativeReader(value);if(Buffer.from(reader.raw(4)).toString('ascii')!=='LLO1')throw new Error('Linked locator version is unsupported.');
	const revision=reader.number(8),root=reader.identity(),file=reader.identity(),count=reader.number(1),names:NativePath[]=[];
	if(count<1||count>16)throw new TypeError('Linked locator components exceed their bound.');for(let i=0;i<count;i++)names.push(reader.path());reader.end();
	return Object.freeze({revision,root:captureIdentity(root),file:captureIdentity(file),components:captureComponents(names,false)});
}
export function equalLinkedIdentityCurrentV1(a:NativeFileIdentity,b:NativeFileIdentity):boolean{return a.volume===b.volume&&a.object===b.object;}
