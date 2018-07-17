import 'dotenv/config'
import Engine from './Engine'
import { REST } from 'deribit-ws-js'
import Debug from 'debug'

// eslint-disable-next-line no-unused-vars
let debug = Debug('deribit:engine')

describe('engine', async () => {
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

    await engine.init()
    // await engine.instruments()
    // await engine.initExpiration('27JUL18')
    exps = engine.expirations()
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

  it('futurePrice', async () => {
    expect(engine.futurePrice(exps[1])).toBeGreaterThan(1)
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

    expect(exp.strike[strikes[0]]).toHaveProperty('bidIV')
    expect(exp.strike[strikes[0]]).toHaveProperty('askIV')
    expect(exp.strike[strikes[0]]).toHaveProperty('midIV')
    expect(exp.strike[strikes[0]]).toHaveProperty('strike', +strikes[0])
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
      expect(engine.ATMIV(exp)).toBeGreaterThan(1)
    })
  })

  it('get ATM straddle price', () => {
    expect(engine.ATMStraddle('27JUL18', 'bid')).toBeGreaterThan(0)
    expect(engine.ATMStraddle('27JUL18', 'ask')).toBeGreaterThan(0)
  })
})
