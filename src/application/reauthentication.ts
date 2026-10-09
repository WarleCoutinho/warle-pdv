type Listener=(request:{resolve:(password:string)=>void;reject:()=>void})=>void;
let listener:Listener|undefined;let pending:Promise<string>|undefined;
export function subscribeReauthentication(next:Listener){listener=next;return()=>{if(listener===next)listener=undefined;};}
export function requestReauthentication():Promise<string>{if(pending)return pending;if(!listener)return Promise.reject(new Error('REAUTHENTICATION_REQUIRED'));pending=new Promise<string>((resolve,reject)=>listener!({resolve,reject:()=>reject(new Error('REAUTHENTICATION_REQUIRED'))})).finally(()=>{pending=undefined;});return pending;}
