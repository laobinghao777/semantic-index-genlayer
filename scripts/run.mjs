import {execute,reconcile,state,snapshot,safeError} from './runtime.mjs';
try{
 if(state.pending!==null&&state.pending!==undefined)await reconcile();
 const action=process.argv[2];
 if(action)await execute(action,process.argv.slice(3));
 console.log(JSON.stringify(await snapshot(),null,2));
}catch(e){console.error(safeError(e));process.exitCode=1;}
