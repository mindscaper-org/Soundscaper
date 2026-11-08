/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ContextMenuItem } from '../vendor/audacity-design-system/components/src/ContextMenuItem/ContextMenuItem.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for(const initiallyDisabled of [true,false])test(`submenu cannot expose actions ${initiallyDisabled?'when already disabled':'after its parent disables'}`,async()=>{
	const dom=installReactTestDom(),root=createRoot(dom.container as unknown as HTMLElement);
	const globals=globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean};
	const beforeAct=globals.IS_REACT_ACT_ENVIRONMENT;globals.IS_REACT_ACT_ENVIRONMENT=true;
	// This one-parent fixture has no competing sibling hover listener.
	Object.defineProperty(document,'dispatchEvent',{configurable:true,value:(_event:Event):boolean=>true});
	const render=(disabled:boolean)=><ContextMenuItem label="Open recent" disabled={disabled} hasSubmenu><ContextMenuItem label="Other project" onClick={()=>undefined}/></ContextMenuItem>;
	const parent=()=>dom.container.querySelectorAll('[role="menuitem"]')[0]!;
	try{
		await act(async()=>{root.render(render(initiallyDisabled));});
		await act(async()=>{reactProps(parent()).onMouseEnter?.({});});
		if(!initiallyDisabled){
			assert.equal(dom.container.querySelectorAll('[role="menu"]').length,1);
			await act(async()=>{root.render(render(true));});
		}
		assert.equal(dom.container.querySelectorAll('[role="menu"]').length,0,'disabled parent owns no actionable child popup');
		await act(async()=>{root.render(render(false));});
		assert.equal(dom.container.querySelectorAll('[role="menu"]').length,0,'becoming available does not revive a retired popup');
		await act(async()=>{reactProps(parent()).onMouseEnter?.({});});
		assert.equal(dom.container.querySelectorAll('[role="menu"]').length,1,'a new admitted hover still opens its submenu');
	}finally{
		await act(async()=>{root.unmount();});globals.IS_REACT_ACT_ENVIRONMENT=beforeAct;dom.restore();
	}
});
