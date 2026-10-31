/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import {linkedOriginalsFixtureCurrentV1 as fixture,options,withInput,GRANTED_FS_OP as OP} from './helpers/lightscaper-native-linked-originals-integration-fixture-current.ts';

void test('Lightscaper linked input escaped read refuses after its actual consumer retires without another native pull',options,async context=>{
	await fixture(context,async f=>{
		const entry=await f.prepare();let escaped:((offset:number,length:number)=>Promise<Uint8Array>)|undefined;
		await withInput(entry.input,f.mediaDatabasePath,view=>{escaped=view.read;});assert.ok(escaped);
		const before=f.count(OP.read);await assert.rejects(escaped(0,1));assert.equal(f.count(OP.read),before);
		await entry.input.close();
	});
});
