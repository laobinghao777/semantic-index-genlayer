// Route EVM calls to the chain and GenVM calls to the public GenLayer node.
// Set a sender on eth_call: this RPC enforces a simulated gas balance check.
export const CHAIN_RPC='https://rpc.testnet-chain.genlayer.com';
export const NODE_RPC='https://rpc-bradbury.genlayer.com';
export function installRpcRouting(address) {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async (url,options={})=>{
    if(url!==NODE_RPC) return originalFetch(url,options);
    let body;
    try{body=JSON.parse(options.body);}catch{return originalFetch(url,options);}
    if(body.method==='eth_call' && body.params?.[0]) body.params[0].from ??= address;
    const target=body.method.startsWith('eth_')? CHAIN_RPC:NODE_RPC;
    const response=await originalFetch(target,{...options,body:JSON.stringify(body),signal:options.signal??AbortSignal.timeout(45000)});
    if(body.method==='eth_estimateGas'){
      const result=await response.clone().json();
      globalThis.__genlayerEstimateFailed=!!result.error;
    }
    return response;
  };
  return ()=>{globalThis.fetch=originalFetch;};
}
