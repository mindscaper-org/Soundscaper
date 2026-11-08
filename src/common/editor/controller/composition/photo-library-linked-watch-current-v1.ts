/* SPDX-License-Identifier: AGPL-3.0-only */
/** Opt-in, displayed-page polling. No timer is installed until start(), no
 * backlog is queued, and retirement joins the actual accepted native check. */
export class PhotoLibraryLinkedWatchCurrentV1{
 readonly #notice:(error:unknown)=>void;#timer:ReturnType<typeof setTimeout>|undefined;#active:Readonly<{stop:AbortController;joined:Promise<void>}>|undefined;
 #poll:((signal:AbortSignal)=>Promise<void>)|undefined;#closed=false;#closing:Promise<void>|undefined;
 constructor(notice:(error:unknown)=>void){if(typeof notice!=='function')throw new TypeError('Linked watch requires its error observer.');this.#notice=notice;}
 start(poll:(signal:AbortSignal)=>Promise<void>):void{if(this.#closed)throw new Error('Linked watch is closed.');if(this.#poll||this.#active)throw new Error('Linked watch is already active.');if(typeof poll!=='function')throw new TypeError('Linked watch requires a bounded page callback.');this.#poll=poll;this.#tick();}
 #tick():void{
  const poll=this.#poll;if(!poll||this.#closed||this.#active)return;this.#timer=undefined;
  const stop=new AbortController();let finish!:()=>void;const joined=new Promise<void>(resolve=>{finish=resolve;}),entry=Object.freeze({stop,joined});this.#active=entry;
  void Promise.resolve().then(()=>{stop.signal.throwIfAborted();return poll(stop.signal);}).catch((error:unknown)=>{
   if(stop.signal.aborted&&Object.is(error,stop.signal.reason))return;this.#poll=undefined;try{this.#notice(error);}catch{/* Observers cannot replace actual retirement. */}
  }).finally(()=>{if(this.#active===entry)this.#active=undefined;finish();if(this.#poll&&!this.#closed)this.#timer=setTimeout(()=>{this.#tick();},1000);});
 }
 stop():Promise<void>{this.#poll=undefined;if(this.#timer!==undefined){clearTimeout(this.#timer);this.#timer=undefined;}const active=this.#active;if(active&&!active.stop.signal.aborted)active.stop.abort(new DOMException('Linked watch stopped.','AbortError'));return active?.joined??Promise.resolve();}
 close():Promise<void>{if(this.#closing)return this.#closing;this.#closed=true;this.#closing=this.stop();return this.#closing;}
}
