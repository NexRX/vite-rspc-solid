
// Auto-generated file - do not edit
import type * as rpc from 'C:/Users/Nex/Documents/Repos/Personal/ReDrive/src-frontend/types/backend-rpc.d.ts';
import { createClient, FetchTransport, type Client } from "@rspc/client";


// Generate Client and Config
const transport = new FetchTransport("http://localhost:4000/rspc");
const clientConfig = {...{}, transport};
export const client = createClient<rpc.Procedures>(clientConfig);


/** 
 * query RPC call to `hello`
 * @param input {rpc.Info}
 * @returns {string}
 */
export function hello(input: rpc.Info) {
  return client.query(["hello", input]);
}


/** 
 * query RPC call to `user.list`
 * Takes no input
 * @returns {void}
 */
export function userList() {
  return client.query(["user.list"]);
}


/** 
 * query RPC call to `version`
 * Takes no input
 * @returns {string}
 */
export function version() {
  return client.query(["version"]);
}
