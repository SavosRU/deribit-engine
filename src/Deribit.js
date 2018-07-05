import { RestClient } from 'deribit-api'
export default new RestClient(process.env.DERIBIT_KEY, process.env.DERIBIT_SECRET)
