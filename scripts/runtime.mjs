import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAccount, createClient, isSuccessful} from 'genlayer-js';
import {testnetBradbury} from 'genlayer-js/chains';
import {createPublicClient, http, formatEther, parseEther, keccak256} from 'viem';
import {installRpcRouting, CHAIN_RPC, NODE_RPC} from './rpc.mjs';

export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const statePath=path.join(ROOT,'logs/app-state.json');
export const stringify=(x)=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
const deploymentPath=path.join(ROOT,'deployment.json');
const publicDeployment=fs.existsSync(deploymentPath)?JSON.parse(fs.readFileSync(deploymentPath,'utf8')):{};
export const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{version:1,contract:publicDeployment.contract??null,transactions:[]};
export const save=()=>{fs.mkdirSync(path.dirname(statePath),{recursive:true});fs.writeFileSync(statePath+'.tmp',stringify(state));fs.renameSync(statePath+'.tmp',statePath);};
const localKeyPath=fs.existsSync(path.join(ROOT,'pk.txt'))?path.join(ROOT,'pk.txt'):path.join(ROOT,'..','..','pk.txt');
const key=fs.readFileSync(localKeyPath,'utf8').trim().replace(/^0x/,'');
if(!/^[\da-f]{64}$/i.test(key))throw new Error('pk.txt must contain one private key');
const signer=createAccount(`0x${key}`);
export const address=signer.address;
if(state.wallet && state.wallet!==address)throw new Error('Wallet changed: deployment ledger belongs to another wallet');
state.wallet=address;
installRpcRouting(address);
export const chainClient=createPublicClient({chain:testnetBradbury,transport:http(CHAIN_RPC,{timeout:25000,retryCount:1})});
let currentRecord;
const account={...signer,signTransaction:async(tx,options)=>{
  if(!currentRecord)throw new Error('No tracked operation');
  if(globalThis.__genlayerEstimateFailed)throw new Error('Gas estimation failed; refusing to sign the SDK fallback transaction');
  if(tx.chainId!==4221 || tx.to?.toLowerCase()!==testnetBradbury.consensusMainContract.address.toLowerCase())throw new Error('Unexpected transaction target/network');
  const maxCost=BigInt(tx.value??0)+BigInt(tx.gas??0)*BigInt(tx.gasPrice??0);
  if(maxCost>parseEther('0.3'))throw new Error('Transaction exceeds 0.3 GEN maximum');
  currentRecord.maxCostWei=maxCost.toString();
  const raw=await signer.signTransaction(tx,options);
  currentRecord.evmHash=keccak256(raw);currentRecord.status='signed';save();
  return raw;
}};
export const client=createClient({chain:testnetBradbury,endpoint:NODE_RPC,account});
export const balance=()=>chainClient.getBalance({address});
export async function verifyNetwork(){
  const [id,block,manager]=await Promise.all([chainClient.getChainId(),chainClient.getBlock({blockNumber:0n}),chainClient.readContract({address:testnetBradbury.consensusMainContract.address,abi:testnetBradbury.consensusMainContract.abi,functionName:'getAddressManager'})]);
  if(id!==4221||block.hash!=='0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4'||manager.toLowerCase()!=='0x3f71ae080bd6270a91dbcc7960d88797828538e0')throw new Error('Bradbury Phase 2 identity mismatch');
  const b=await balance();
  state.initialBalanceWei??=b.toString();state.genesis=block.hash;save();return b;
}
export function safeError(error){
  // Never print SDK request bodies, account objects, or raw signed transactions.
  return String(error.shortMessage??error.message??'Operation failed').replace(/0x[0-9a-fA-F]{64,}/g,'[redacted]').slice(0,700);
}
async function fees(){
  const policy=await client.getCurrentFeePolicy();
  // Match the live network's successful transaction allocation (30–600, 300 per role).
  const quote=await client.estimateTransactionFees({leaderTimeunitsAllocation:300n,validatorTimeunitsAllocation:300n,executionBudgetPerRound:parseEther('0.025'),totalMessageFees:0n,appealRounds:0n,rotations:[0n]});
  if(quote.feeValue>parseEther('0.2'))throw new Error('Protocol prepayment exceeds 0.2 GEN');
  return {distribution:quote.distribution,feeValue:quote.feeValue};
}
async function finish(record){
  console.log(`Tracking ${record.action}: ${record.txId}`);
  const receipt=await client.waitForFinalization({hash:record.txId,interval:5000,retries:120,fullTransaction:true});
  fs.writeFileSync(path.join(ROOT,`logs/receipt-${record.txId}.json`),stringify(receipt));
  record.finalizedAt=new Date().toISOString();
  record.status=isSuccessful(receipt)?'finalized':'execution_failed';
  record.protocolStatus=receipt.statusName;record.executionResult=receipt.txExecutionResultName;
  const after=await balance();record.afterWei=after.toString();record.netCostWei=(BigInt(record.beforeWei)-after).toString();record.netCostGEN=formatEther(BigInt(record.netCostWei));
  if(record.evmHash){
    const evm=await chainClient.getTransactionReceipt({hash:record.evmHash});
    record.gasUsed=evm.gasUsed.toString();record.gasPriceWei=evm.effectiveGasPrice.toString();record.evmFeeWei=(evm.gasUsed*evm.effectiveGasPrice).toString();
  }
  if(record.action==='deploy' && isSuccessful(receipt)){
    state.contract=receipt.txDataDecoded?.contractAddress??receipt.recipient;
    if(!/^0x[0-9a-f]{40}$/i.test(state.contract??'')||/^0x0{40}$/i.test(state.contract))throw new Error('Deployment has no valid contract address');
    record.contract=state.contract;
  }
  state.lastBalanceWei=after.toString();state.pending=null;save();
  if(!isSuccessful(receipt))throw new Error(`Execution failed: ${record.protocolStatus}/${record.executionResult}`);
  console.log(`${record.action}: finalized, net ${record.netCostGEN} GEN`);
  return record;
}
function refreshState(){
  if(!currentRecord&&fs.existsSync(statePath))Object.assign(state,JSON.parse(fs.readFileSync(statePath,'utf8')));
}
export async function execute(action,args=[]){
  const lockPath=path.join(ROOT,'logs/signer.lock');
  fs.mkdirSync(path.dirname(lockPath),{recursive:true});
  let lock;
  try{lock=fs.openSync(lockPath,'wx');}catch{throw new Error('Another signer operation is active; do not resend.');}
  try{refreshState();return await executeTracked(action,args);}
  finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
}
async function executeTracked(action,args=[]){
  if(state.pending!==null&&state.pending!==undefined)throw new Error('A transaction is pending. Reconcile it before sending another.');
  if(action!=='deploy'&&!state.contract)throw new Error('Deploy the application first');
  if(action==='deploy'&&state.contract)throw new Error('Application is already deployed');
  if(!['deploy','create_case','add_entry','analyze'].includes(action))throw new Error('Unknown action');
  await verifyNetwork();
  const before=await balance();
  if(BigInt(state.initialBalanceWei)-before>parseEther('1'))throw new Error('Session budget of 1 GEN exhausted');
  const fee=await fees();
  if(before<fee.feeValue+parseEther('0.05'))throw new Error('Insufficient test GEN reserve');
  const record={action,args,contract:state.contract??null,startedAt:new Date().toISOString(),beforeWei:before.toString(),feeDepositWei:fee.feeValue.toString(),status:'preparing'};
  state.transactions.push(record);state.pending=state.transactions.length-1;currentRecord=record;save();
  try{
    record.txId=action==='deploy'?await client.deployContract({code:new Uint8Array(fs.readFileSync(path.join(ROOT,'contract.py'))),args:[],consensusMaxRotations:0,fees:fee}):await client.writeContract({address:state.contract,functionName:action,args,consensusMaxRotations:0,fees:fee});
    record.status='pending';save();
    return await finish(record);
  }catch(e){
    record.error=safeError(e);
    // If signing happened, do not send again on restart or timeout.
    if(!record.evmHash){record.status='not_sent';state.pending=null;}
    save();throw new Error(record.error);
  }finally{currentRecord=null;}
}
export async function reconcile(){
  if(state.pending===null || state.pending===undefined)return;
  const record=state.transactions[state.pending];
  if(!record.txId && record.evmHash){
    const receipt=await chainClient.getTransactionReceipt({hash:record.evmHash});
    if(receipt.status==='reverted'){
      const after=await balance();record.status='reverted';record.afterWei=after.toString();record.netCostWei=(BigInt(record.beforeWei)-after).toString();record.netCostGEN=formatEther(BigInt(record.netCostWei));record.evmFeeWei=(receipt.gasUsed*receipt.effectiveGasPrice).toString();record.finalizedAt=new Date().toISOString();state.pending=null;state.lastBalanceWei=after.toString();save();return record;
    }
    const {parseEventLogs}=await import('viem');
    const events=parseEventLogs({abi:testnetBradbury.consensusMainContract.abi,logs:receipt.logs,strict:false});
    const event=events.find(e=>['NewTransaction','CreatedTransaction'].includes(e.eventName));
    record.txId=event?.args?.txId??event?.args?.transactionId;
    if(!record.txId)throw new Error('Envelope exists but transaction ID requires manual reconciliation');
    save();
  }
  if(!record.txId)throw new Error('Pending operation requires review; no automatic resubmission');
  return finish(record);
}
export async function readBriefs(){
  if(!state.contract)return {total:0,items:[]};
  return JSON.parse(await client.readContract({address:state.contract,functionName:'list_cases',args:[0,50]}));
}
export async function snapshot(){
  refreshState();
  const b=await balance();
  const settled=state.transactions.reduce((sum,r)=>sum+BigInt(r.netCostWei??0),0n);
  return {wallet:address,contract:state.contract??null,chainId:4221,network:'Bradbury Phase 2',balanceGEN:formatEther(b),netCostGEN:formatEther(settled),balanceChangeGEN:formatEther(BigInt(state.initialBalanceWei??b)-b),transactions:state.transactions.map(({args,...r})=>r),pending:state.pending!==null&&state.pending!==undefined,...await readBriefs()};
}
