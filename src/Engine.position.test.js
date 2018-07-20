import 'dotenv/config'
import Engine from './Engine'
import { REST } from 'deribit-ws-js'
import Debug from 'debug'

// eslint-disable-next-line no-unused-vars
let debug = Debug('deribit:engine')

describe('position', async () => {
  let exps
  let engine

  beforeAll(async () => {
    let rest = new REST(
      process.env.DERIBIT_KEY,
      process.env.DERIBIT_SECRET,
      false,
      1000,
      false,
    )
    engine = new Engine(rest)
    await engine.instruments()
    // await engine.initExpiration('31AUG18')
    // await engine.init()
    exps = engine.expirations()
    await engine.positions(true)
  })

  it('update', async () => {
    expect(
      engine.symbol.BTC.opt['28DEC18'].strike[15000].call.position().size,
    ).toBeGreaterThan(1)
  })

  it('future', async () => {
    let fp = engine.symbol.BTC.fut['27JUL18'].position()
    expect(fp).toHaveProperty('avgUSD')
  })

  it('delta', async () => {
    expect(await engine.delta()).toBeGreaterThan(1)
  })

  it('delta exp', async () => {
    let allOptions = await engine.delta()
    let oneExp = await engine.delta(exps[1])
    expect(allOptions).toBeGreaterThan(0)
    expect(oneExp).not.toBe(allOptions)
  })

  it('buy', async () => {
    await engine._deribit.buy({
      instrument: 'BTC-28DEC18-15000-C',
      quantity: 1,
      price: 1,
    })
  })

  it('positions', async () => {
    await engine.positions(true)
  })
})
