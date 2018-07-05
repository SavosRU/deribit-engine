import WS from 'ws'
import { RestClient } from 'deribit-api'

let address = process.env.LIVENET
  ? 'wss://www.deribit.com/ws/api/v1'
  : 'wss://test.deribit.com/ws/api/v1'

export default new RestClient(process.env.DERIBIT_KEY, process.env.DERIBIT_SECRET)
export let ws = new WS(address)
export let wsj = i => {
  ws.send(JSON.stringify(i))
}
export let ping = () => {
  wsj({ action: '/api/v1/public/ping' })
}
