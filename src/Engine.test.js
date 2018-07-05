import 'dotenv/config'
import engine from './Engine'
import Promise from 'bluebird'
import Debug from 'debug'

// eslint-disable-next-line no-unused-vars
let debug = Debug('deribit:engine')

describe('engine', async () => {
  let exps

  beforeAll(async () => {
    await engine.instruments()
    exps = engine.expirations()
    await Promise.map(exps, one => engine.initExpiration(one))
  })

  it('index', async () => {
    expect(engine.symbol).toHaveProperty('BTC')
    expect(engine.symbol).toHaveProperty('BTC.ind', 0)
  })

  it('futures', async () => {
    // expect(engine.symbol).toBe({})

    expect(engine.symbol).toHaveProperty('BTC')
    expect(engine.symbol).toHaveProperty('BTC.fut')

    expect(Object.keys(engine.symbol.BTC.fut).length).toBeGreaterThan(1)
  })

  it('expirations', () => {
    expect(exps.length).toBeGreaterThan(1)
    expect(exps[0]).toMatch(/18/)
  })

  it('options', async () => {
    // expect(engine.symbol.BTC.opt).toBe()

    expect(engine.symbol).toHaveProperty('BTC')
    expect(engine.symbol).toHaveProperty('BTC.opt')

    let opt = engine.symbol.BTC.opt

    let exp = opt[exps[1]]

    expect(exp).toHaveProperty('date')
    expect(exp).toHaveProperty('strike')

    let strikes = Object.keys(exp.strike)
    expect(strikes.length).toBeGreaterThan(3)

    expect(exp.strike[strikes[0]]).toHaveProperty('bid')
    expect(exp.strike[strikes[0]]).toHaveProperty('ask')
    expect(exp.strike[strikes[0]]).toHaveProperty('mid')
    expect(exp.strike[strikes[0]]).toHaveProperty('strike', +strikes[0])
  })

  it('positions', async () => {
    await engine.positions()
  })

  describe('tap', async () => {
    it('getInstrument', async () => {
      let exp = exps[1]
      await engine.summary(`BTC-${exp}-10000-C`)
      let e = engine.symbol.BTC.opt[exp].strike['10000'].call
      expect(e.ask).toBeGreaterThan(0)
    })
  })

  describe('initExp', async () => {
    let exp

    beforeAll(() => {
      exp = engine.expirations()[1]
    })

    it('days', async () => {
      expect(engine.symbol.BTC.opt[exp].days).toBeGreaterThan(1)
    })

    it('getATMIV', async () => {
      expect(engine.symbol.BTC.opt[exp].IV).toBeGreaterThan(1)
    })
  })

  it('get ATM straddle price', () => {
    expect(engine.ATMStraddle('27JUL18', 'bid')).toBeGreaterThan(0)
    expect(engine.ATMStraddle('27JUL18', 'ask')).toBeGreaterThan(0)
  })
})
