/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import VideoEffectNumberInput from '../src/common/editor/ui/inspector/VideoEffectNumberInput.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('video exact-number Escape retires native repeats until the owned pointer is released', async () => {
	const dom=installReactTestDom();
	const root=createRoot(dom.container as unknown as HTMLElement);
	const globals=globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct=globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact=Object.getOwnPropertyDescriptor(globalThis,'React');
	globals.IS_REACT_ACT_ENVIRONMENT=true;
	Object.defineProperty(globalThis,'React',{configurable:true,value:React});
	const previews:number[]=[];
	const commits:number[]=[];
	function Fixture(){
		const [value,setValue]=useState(0);
		const original=useRef(0);
		return <VideoEffectNumberInput value={value} minimum={-1} maximum={1} step={.01} label="Exact value: Brightness" disabled={false}
			onBegin={()=>{original.current=value;}} onPreview={next=>{previews.push(next);setValue(next);}}
			onCommit={()=>{commits.push(value);}} onCancel={()=>{setValue(original.current);}}/>;
	}
	try {
		await act(async()=>{root.render(<Fixture/>);});
		const field=dom.one('input');
		const outside=dom.container.ownerDocument.createElement('button');
		dom.container.appendChild(outside); outside.focus();
		const pointer=(pointerId:number)=>({pointerId,button:0,isPrimary:true,currentTarget:field,preventDefault(){}});
		const change=(value:string)=>({currentTarget:{value,valueAsNumber:Number(value)}});
		await act(async()=>{reactProps(field).onPointerDown?.({...pointer(0),button:2});});
		assert.strictEqual(dom.container.ownerDocument.activeElement,outside,'an auxiliary press keeps the existing focus');
		await act(async()=>{reactProps(field).onPointerDown?.(pointer(1));});
		assert.strictEqual(dom.container.ownerDocument.activeElement,field,'the admitted native pointer edit owns keyboard cancellation');
		await act(async()=>{reactProps(field).onChange?.(change('.02'));});
		await act(async()=>{reactProps(field).onKeyDown?.({key:'Escape',nativeEvent:{isComposing:false},preventDefault(){},stopPropagation(){}});});
		await act(async()=>{reactProps(field).onChange?.(change('.03'));});
		await act(async()=>{reactProps(field).onPointerUp?.(pointer(1));});
		await act(async()=>{reactProps(field).onBlur?.({});});
		assert.deepEqual(previews,[.02],'the canceled native press cannot start another preview');
		assert.deepEqual(commits,[],'Escape keeps the original value through release and blur');
		await act(async()=>{reactProps(field).onPointerDown?.(pointer(2));});
		await act(async()=>{reactProps(field).onChange?.(change('.01'));});
		await act(async()=>{reactProps(field).onPointerUp?.(pointer(2));});
		assert.deepEqual(previews,[.02,.01],'the next independent press remains editable');
		assert.deepEqual(commits,[.01]);
	} finally {
		await act(async()=>{root.unmount();});
		if(previousReact)Object.defineProperty(globalThis,'React',previousReact);else Reflect.deleteProperty(globalThis,'React');
		globals.IS_REACT_ACT_ENVIRONMENT=previousAct;
		dom.restore();
	}
});
