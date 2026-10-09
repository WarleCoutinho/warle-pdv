import type {StoreSettings} from '../../src/types/settings';
export type LifecycleStatus={status:'testing'|'ready_for_setup'|'production';generation:number;needsSetup:boolean;installationId:string;legacyWebDataAvailable?:boolean;testDataSummary?:Record<string,number>};
export type NativeBackupResult={proofId:string;created:true;verified:true;recoverable:true;portableCodes:number;legacyCodes:number;schemaVersion:number;generation:number;status:string;installationId:string;databaseHash:string;logicalHash:string};
export type ImportPreview={previewId:string;summary:Record<string,number|string>;metrics:Record<string,unknown>;warnings:string[]};
export interface LifecycleOperations{
 'lifecycle.status':{input:Record<string,never>;output:LifecycleStatus};
 'lifecycle.setup':{input:{settings:StoreSettings;username:string;name:string;password:string;confirmation:string;mode:'testing'|'production';confirmed:boolean};output:LifecycleStatus};
 'lifecycle.activate':{input:{confirmed:boolean};output:LifecycleStatus};
 'backup.create':{input:{secret:string};output:NativeBackupResult|null};
 'backup.verify':{input:{secret:string};output:Omit<NativeBackupResult,'proofId'>|null};
 'backup.restore':{input:{secret:string;proofId:string;confirmed:boolean};output:LifecycleStatus|null};
 'import.legacyPreview':{input:Record<string,never>;output:ImportPreview};
 'import.preview':{input:Record<string,never>;output:ImportPreview|null};
 'import.apply':{input:{secret:string;previewId:string;proofId:string;confirmed:boolean};output:{metrics:Record<string,unknown>;warnings:string[]}};
 'lifecycle.prepare':{input:{secret:string;proofId:string;first:boolean;second:boolean;phrase:string};output:LifecycleStatus};
 'credits.recoverReceipt':{input:{query:string;code:string};output:null};
}
export type LifecycleOperation=keyof LifecycleOperations;
export const lifecycleNames=['lifecycle.status','lifecycle.setup','lifecycle.activate','backup.create','backup.verify','backup.restore','import.preview','import.legacyPreview','import.apply','lifecycle.prepare','credits.recoverReceipt'] as const;
