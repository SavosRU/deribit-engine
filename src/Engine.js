import moment from 'moment'
import deribit from './Deribit'
import Promise from 'bluebird'
import _ from 'lodash/fp'
import Debug from 'debug'
import log from './Logger'

// eslint-disable-next-line no-unused-vars
let debug = Debug('deribit:engine')

const Fee = {
  BTC: 0.0005,
}

let initialized = false

class Engine {
  constructor() {
    this._deribit = deribit
    this._positions = {}
  }

  setPositions(positions) {
    this._positions = positions
  }

  orderBook(instrument) {
    return deribit.getorderbook(instrument).tap(res => {
      let r = res.result

      let i = r.instrument.split('-')
      let t = i[3] === 'C' ? 'call' : 'put'
      let strike = this.symbol[i[0]].opt[i[1]].strike['' + i[2]]
      let option = this.symbol[i[0]].opt[i[1]].strike['' + i[2]][t]

      option.bid = r.bids[0] && r.bids[0].price ? r.bids[0].price : null
      option.ask = r.asks[0] && r.asks[0].price ? r.asks[0].price : null
      option.mid = (option.bid + option.ask) / 2

      option.bids = r.bids
      option.asks = r.asks

      option.bidIV = r.bidIv
      option.askIV = r.askIv
      option.midIV = r.markIv

      option.settlement = r.settlementPrice

      let atm = this.ATM(i[1], i[0])

      if ((+i[2] >= atm && t === 'call') || (+i[2] < atm && t === 'put')) {
        strike.bidIV = option.bidIV
        strike.askIV = option.askIV
        strike.midIV = option.midIV
        strike.spreadIV = Math.abs(strike.bidIV - strike.askIV)
      }
    })
  }

  buy(...args) {
    if (process.env.DERIBIT_TRADING) {
      return this._deribit.buy(...args)
    } else {
      return Promise.reject(new Error('Enable DERIBIT_TRADING env'))
    }
  }

  sell(...args) {
    if (process.env.DERIBIT_TRADING) {
      return this._deribit.sell(...args)
    } else {
      return Promise.reject(new Error('Enable DERIBIT_TRADING env'))
    }
  }

  async init() {
    if (!initialized) {
      initialized = true
      await this.instruments()
      await this.update()
    }
  }

  updateInterval(interval = 5) {
    setInterval(async () => {
      await this.update()
    }, interval * 1000)
  }

  async update() {
    await Promise.map(this.expirations(), one => this.initExpiration(one))
  }

  async instruments() {
    let { result } = await deribit.getinstruments()

    this.symbol = _.flow(
      _.map('baseCurrency'),
      _.uniq,
      _.transform((r, symbol) => {
        r[symbol] = { fut: {}, opt: {}, ind: 0 }
      }, {}),
    )(result)

    // Futures

    _.flow(
      _.map(symbol => {
        _.flow(
          _.filter({
            kind: 'future',
            baseCurrency: symbol,
            currency: 'USD',
          }),
          _.map(
            _.flow(
              _.get('instrumentName'),
              _.split('-'),
              _.nth(1),
            ),
          ),
          _.transform((r, exp) => {
            r[exp] = {
              code: exp,
              date: moment(exp, 'DDMMMYY'),
              days: moment.duration(moment(exp, 'DDMMMYY').diff(moment())).as('days'),
              bid: 0,
              ask: 0,
              mid: 0,
            }
          }, {}),
          r => {
            this.symbol[symbol].fut = r
          },
        )(result)
      }),
    )(Object.keys(this.symbol))

    // Options

    _.flow(
      _.map(symbol => {
        _.flow(
          _.filter({
            kind: 'option',
            baseCurrency: symbol,
            currency: 'USD',
          }),
          _.map(
            _.flow(
              _.get('instrumentName'),
              _.split('-'),
              _.nth(1),
            ),
          ),
          _.uniq,
          _.reduce((r, exp) => {
            let strikes = _.flow(
              _.filter({
                kind: 'option',
                baseCurrency: symbol,
                currency: 'USD',
              }),
              _.filter(e => {
                return _.includes(exp, e.instrumentName)
              }),
              _.map('strike'),
              _.uniq,
              _.sortBy(Number),
            )(result)

            this.symbol[symbol].opt[exp] = {
              code: exp,
              date: moment(exp, 'DDMMMYY'),
              days: moment.duration(moment(exp, 'DDMMMYY').diff(moment())).as('days'),
              IV: 0,
              ATM: 0,
              range: { bid: 0, ask: 0 },
              strike: _.transform((r, strike) => {
                r[strike] = {
                  bidIV: 0,
                  askIV: 0,
                  midIV: 0,
                  spreadIV: 0,
                  call: {
                    bid: 0,
                    ask: 0,
                    mid: 0,
                    bidIV: 0,
                    askIV: 0,
                    midIV: 0,
                    settlement: 0,
                    d: 0,
                    g: 0,
                    v: 0,
                    t: 0,
                    position: () => {
                      return (
                        this._positions[`${symbol}-${exp}-${strike}-C`] || {
                          size: 0,
                          avg: 0,
                          avgUSD: 0,
                        }
                      )
                    },
                  },
                  put: {
                    bid: 0,
                    ask: 0,
                    mid: 0,
                    bidIV: 0,
                    askIV: 0,
                    midIV: 0,
                    settlement: 0,
                    d: 0,
                    g: 0,
                    v: 0,
                    t: 0,
                    position: () => {
                      return (
                        this._positions[`${symbol}-${exp}-${strike}-P`] || {
                          size: 0,
                          avg: 0,
                          avgUSD: 0,
                        }
                      )
                    },
                  },
                  strike,
                }
              }, {})(strikes),
            }
          }, {}),
        )(result)
      }),
    )(Object.keys(this.symbol))
  }

  expirations(symbol = 'BTC') {
    return _.flow(
      _.map(_.pick(['code', 'days'])),
      _.sortBy('days'),
      _.map('code'),
    )(this.symbol[symbol].opt)
  }

  async positions(update = false) {
    if (update) {
      return await deribit
        .positions()
        .then(r => r.result)
        .then(
          _.flow(
            _.filter({ kind: 'option' }),
            _.transform((r, p) => {
              r[p.instrument] = {
                size: p.size,
                avg: p.averagePrice,
                avgUSD: p.averageUsdPrice,
                pnl: p.floatingPl,
                pnlUSD: p.floatingUsdPl,
                td: p.delta,
              }
            }, {}),
          ),
        )
        .then(p => {
          this._positions = p
          return p
        })
    } else {
      return this._positions
    }
  }

  futureCode(exp, symbol = 'BTC') {
    if (this.symbol[symbol].fut[exp]) {
      return exp
    }

    return _.flow(
      _.map(_.pick(['days', 'code'])),
      _.sortBy('days'),
      _.last,
      _.get('code'),
    )(this.symbol[symbol].fut)
  }

  futurePrice(exp, symbol = 'BTC') {
    return this.symbol[symbol].fut[this.futureCode(exp)].mid
  }

  ATM(exp, symbol = 'BTC') {
    let chain = this.symbol[symbol].opt[exp]
    let price = this.symbol[symbol].fut[this.futureCode(exp)].mid

    return _.flow(
      _.sortBy(strike => Math.abs(strike - price)),
      _.head,
    )(Object.keys(chain.strike))
  }

  ATMIV(exp, symbol = 'BTC') {
    let chain = this.symbol[symbol].opt[exp]
    let atm = this.ATM(exp)
    return chain.strike[atm].midIV
  }

  async initExpiration(exp, symbol = 'BTC') {
    let chain = this.symbol[symbol].opt[exp]
    chain.days = moment.duration(moment(chain.date).diff(moment())).as('days')

    let futCode = this.futureCode(exp)
    let fut = this.symbol[symbol].fut[futCode]
    fut.days = moment.duration(moment(fut.date).diff(moment())).as('days')

    await deribit
      .getsummary(`${symbol}-${futCode}`)
      .then(r => {
        let i = this.symbol[symbol].fut[futCode]
        i.bid = r.result.bidPrice
        i.ask = r.result.askPrice
        i.mid = r.result.midPrice
      })
      .catch(err => log.error(err))

    let callsPuts = _.flow(
      _.keys,
      _.map(strike => {
        return {
          symbol,
          exp,
          strike,
          type: strike >= fut.mid ? 'call' : 'put',
          letter: strike >= fut.mid ? 'C' : 'P',
        }
      }),
    )(chain.strike)

    await Promise.map(
      callsPuts,
      i => {
        let instrument = `${i.symbol}-${i.exp}-${i.strike}-${i.letter}`
        return this.orderBook(instrument)
      },
      { concurrency: 2 },
    ).catch(err => log.error(err))

    chain.IV = this.ATMIV(exp)
    chain.ATM = this.ATM(exp)
    chain.range = { bid: this.ATMStraddle(exp, 'bid'), ask: this.ATMStraddle(exp, 'ask') }
    debug(`Init expiration ${exp} finished`)
  }

  typeOTM(strike, exp, symbol = 'BTC') {
    let futCode = this.futureCode(exp)
    let price = this.symbol[symbol].fut[futCode].mid
    return strike >= price ? 'call' : 'put'
  }

  ATMStraddle(exp, bidask = 'ask', symbol = 'BTC') {
    let chain = this.symbol[symbol].opt[exp]
    let price = this.symbol[symbol].fut[this.futureCode(exp)].mid
    let atmPrice = chain.strike[chain.ATM][this.typeOTM(chain.ATM, exp)][bidask]
    let atmDiff = Math.abs(chain.ATM - price)
    let fee = 2 * Fee[symbol]
    fee = bidask === 'bid' ? -fee : fee
    atmDiff = price <= chain.ATM ? atmDiff : -atmDiff
    return 2 * atmPrice * price + atmDiff + fee * price
  }
}

export default new Engine()
