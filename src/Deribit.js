import { RestClient } from 'deribit-api'

let url = process.env.DERIBIT_LIVENET
  ? 'https://www.deribit.com'
  : 'https://test.deribit.com'

export default new RestClient(process.env.DERIBIT_KEY, process.env.DERIBIT_SECRET, url)
