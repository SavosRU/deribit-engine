import 'dotenv/config'
import engine from './Engine'
import Debug from 'debug'

// eslint-disable-next-line no-unused-vars
let debug = Debug('deribit:engine')

describe('position', async () => {
  let exps

  beforeAll(async () => {
    // await engine.init()
    await engine.instruments()
    // await engine.initExpiration('27JUL18')
    exps = engine.expirations()
    await engine.positions(true)
  })

  it('update', async () => {
    expect(
      engine.symbol.BTC.opt['28DEC18'].strike[15000].call.position().size,
    ).toBeGreaterThan(1)
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
})
