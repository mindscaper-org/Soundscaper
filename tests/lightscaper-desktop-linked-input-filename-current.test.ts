/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {linkedInputStageFixtureCurrentV1 as fixture,options} from './helpers/lightscaper-native-linked-input-stage-integration-fixture-current.ts';
void test('Genuine linked OPFS File preserves native selected basename for complete Current import planning',options,async context=>fixture(context,async f=>{
 await f.write('Original native name.DNG');const{input,lease}=await f.acquire('Original native name.DNG');try{assert.equal(lease.body.name,input.facts.displayName);assert.equal(lease.facts.modifiedTime,null);}finally{await lease.close();}
}));
