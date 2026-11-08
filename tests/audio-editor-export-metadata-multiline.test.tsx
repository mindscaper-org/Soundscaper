/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ExportDialogMetadataPanel from '../src/common/editor/ui/inspector/ExportDialogMetadataPanel.jsx';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for(const original of ['Opening\nRoom tone','Ordinary title'])test(`export metadata keeps the native editor for ${JSON.stringify(original)}`,async()=>{
	const project=createSoundscaperProject({id:'export-title',metadata:{title:original}});
	const settings=createExportDialogInitialSettings(project);
	assert.equal(settings.metadataTitle,original);
	const dom=installReactTestDom(),root=createRoot(dom.container as unknown as HTMLElement);
	const globals=globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean};
	const previousAct=globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact=Object.getOwnPropertyDescriptor(globalThis,'React');
	globals.IS_REACT_ACT_ENVIRONMENT=true;
	Object.defineProperty(globalThis,'React',{configurable:true,value:React});
	const changed:unknown[]=[];
	function Fixture(){
		const [current,setCurrent]=useState(settings);
		return <ExportDialogMetadataPanel isOpen copy={ENGLISH_COPY} format="wav" project={project} settings={current}
			activeTab="general" onTabChange={()=>undefined} onClose={()=>undefined}
			onChange={(name:string,value:unknown)=>{changed.push(value);setCurrent(prior=>({...prior,[name]:value}));}}/>;
	}
	const title=()=>{
		const label=dom.container.querySelectorAll('label').find(node=>node.querySelector('span')?.textContent===ENGLISH_COPY.metadataTitle);
		assert.ok(label);
		const field=label.querySelector('input')??label.querySelector('textarea');
		assert.ok(field);return field;
	};
	try{
		await act(async()=>{root.render(<Fixture/>);});
		const field=title();
		assert.equal(field.tagName,original.includes('\n')?'TEXTAREA':'INPUT');
		field.focus();
		for(const value of [`${original}!`,'Plain title']){
			await act(async()=>{reactProps(field).onChange?.({target:{value}});});
			assert.equal(changed.at(-1),value,'export overrides update immediately during typing');
			assert.equal(title()===field,true,'editing keeps its focused native control');
			assert.equal(dom.container.ownerDocument.activeElement===field,true);
		}
	}finally{
		await act(async()=>{root.unmount();});
		if(previousReact)Object.defineProperty(globalThis,'React',previousReact);else Reflect.deleteProperty(globalThis,'React');
		globals.IS_REACT_ACT_ENVIRONMENT=previousAct;dom.restore();
	}
});
