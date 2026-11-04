// Light entry for `zimi exec-server`: never import the SDK root (`#/index`) here,
// or the executor would load the full engine registration at startup.
export { runExecServer } from '@zimi-ai/agent-core-v2/remote/server';
