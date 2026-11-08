/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdir,rename,rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { readLightscaperNativePhotoLinkedUnavailableCurrentV1 as unavailable } from '../desktop/lightscaper-native-photo-linked-unavailable-current-v1.ts';
import { linkedOriginalsFixtureCurrentV1 as fixture,options } from './helpers/lightscaper-native-linked-originals-integration-fixture-current.ts';

async function failure(work:Promise<unknown>):Promise<unknown>{let caught:unknown,failed=false;await work.then(()=>undefined,error=>{failed=true;caught=error;});assert.equal(failed,true);return caught;}

void test('Lightscaper linked unavailable classification admits only its private witness without reflecting forged errors or opaque reasons',options,()=>{
	let reflected=0;const poison=new Proxy({}, {get(){reflected++;throw new Error('must not reflect');},ownKeys(){reflected++;return[];}});
	for(const value of [poison,{kind:'unavailable',reason:'file-missing'},new Error('ENOENT'),Object.assign(new Error(),{code:7,nativeCode:2}),Symbol('opaque'),null])assert.equal(unavailable(value),null);
	assert.equal(reflected,0);
});

void test('Lightscaper actual revoked grant produces closed unavailable only after stored linked Photo and custody admission',options,async context=>{
	await fixture(context,async f=>{
		const entry=await f.prepare();await f.publish(entry);assert.equal(await f.grants.revoke(f.grant.grantId),true);
		assert.equal(unavailable(await failure(f.tickets.transport.open(f.request(entry)))),'grant-revoked');
		assert.equal(unavailable(await failure(f.tickets.transport.open({...f.request(entry),photoId:'not-the-stored-photo'}))),null);
	});
});

void test('Lightscaper genuine native missing file is unavailable while changed root identity stays a hard failure',options,async context=>{
	await fixture(context,async f=>{
		const entry=await f.prepare();await f.publish(entry);await rm(entry.file);
		assert.equal(unavailable(await failure(f.tickets.transport.open(f.request(entry)))),'file-missing');
		const old=join(f.directory,'held-original-root');await rename(f.rootPath,old);await mkdir(f.rootPath);
		try{assert.equal(unavailable(await failure(f.tickets.transport.open(f.request(entry)))),null);}
		finally{await rm(f.rootPath,{recursive:true});await rename(old,f.rootPath);}
	});
});
