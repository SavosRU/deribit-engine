import moment from 'moment'
import { REST, WS } from 'deribit-ws-js'
import Promise from 'bluebird'
import _ from 'lodash/fp'
import Debug from 'debug'
import log from './Logger'

// eslint-disable-next-line no-unused-vars
let debug = Debug('deribit:engine')

const Fee = {
  BTC: 0.0005,
}

export default class Engine {
  constructor(deribit, ws) {
    this._deribit = deribit ? deribit : new REST()
    this._ws = ws ? ws : new WS()
    this._positions = {}
    this.initialized = false
  }

  setPositions(positions) {
    this._positions = positions
  }

  getOrderBook(instrument) {
    return this._deribit
      .getOrderbook({ instrument })
      .then(r => this.orderBook(r))
      .catch(err => log.error(err))
  }

  async init() {
    if (!this.initialized) {
      this.initialized = true
      await this.instruments()
      this._ws.hook('order_book', msg => this.orderBook(msg))
      await this.update()
    }
  }

  orderBook(msg) {
    if (msg.edp && msg.btc) {
      this.symbol.BTC.ind = msg.btc
      return
    }

    if (!msg.instrument) {
      log.error('Missing instrument', msg)
      return
    }

    if (['C', 'P'].includes(msg.instrument.substring(msg.instrument.length - 1))) {
      this.optionOrderBook(msg)
    } else {
      this.futuresOrderBook(msg)
    }
  }

  optionOrderBook(r) {
    let [symbol, exp, strikeStr, type] = r.instrument.split('-')
    let t = type === 'C' ? 'call' : 'put'

    if (!this.symbol[symbol].opt[exp].strike['' + strikeStr]) {
      return
    }

    let strike = this.symbol[symbol].opt[exp].strike['' + strikeStr]
    let option = this.symbol[symbol].opt[exp].strike['' + strikeStr][t]

    option.bid = r.bids[0] && r.bids[0].price ? r.bids[0].price : null
    option.ask = r.asks[0] && r.asks[0].price ? r.asks[0].price : null
    option.mid = (option.bid + option.ask) / 2

    option.bids = r.bids
    option.asks = r.asks

    option.bidIV = r.bidIv
    option.askIV = r.askIv
    option.midIV = (r.bidIv + r.askIv) / 2

    strike.state = r.state
    option.settlement = r.settlementPrice

    let price = this.futurePrice(exp)

    if ((+strikeStr >= price && t === 'call') || (+strikeStr < price && t === 'put')) {
      strike.bidIV = option.bidIV
      strike.askIV = option.askIV
      strike.midIV = option.midIV
      strike.spreadIV = Math.abs(strike.bidIV - strike.askIV)
    }

    return r
  }

  futuresOrderBook(r) {
    let [symbol, exp] = r.instrument.split('-')

    if (!this.symbol[symbol].fut[exp]) {
      return
    }

    let i = this.symbol[symbol].fut[exp]
    i.state = r.state
    i.bid = r.bids[0].price || null
    i.ask = r.asks[0].price || null
    i.mid = i.bid && i.ask ? (i.bid + i.ask) / 2 : i.bid
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
    let result = await this._deribit.getInstruments()

    this.symbol = this.symbol || {}

    _.flow(
      _.map('baseCurrency'),
      _.uniq,
      _.map(curr => {
        if (!this.symbol[curr]) {
          this.symbol[curr] = { fut: {}, opt: {}, ind: 0 }
        }
      }),
    )(result)

    // Futures

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
        _.map(exp => {
          let f = this.symbol[symbol].fut
          if (!f[exp]) {
            f[exp] = {
              code: exp,
              date: moment(exp, 'DDMMMYY'),
              days: moment.duration(moment(exp, 'DDMMMYY').diff(moment())).as('days'),
              state: null,
              bid: null,
              ask: null,
              mid: null,
              position: () => {
                let r = this._positions[`${symbol}-${exp}`] || {
                  size: 0,
                  sizeBTC: 0,
                  avg: 0,
                  avgUSD: 0,
                  pnl: 0,
                  pnlUSD: 0,
                  td: 0,
                }

                r.pnlUSD = r.pnl * this.futurePrice(exp, symbol)

                return r
              },
            }
          }
        }),
      )(result)
    })(Object.keys(this.symbol))

    // Options

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
        _.map(exp => {
          // Expirations

          this.symbol[symbol].opt[exp] = this.symbol[symbol].opt[exp] || {
            code: exp,
            date: moment(exp, 'DDMMMYY'),
            days: moment.duration(moment(exp, 'DDMMMYY').diff(moment())).as('days'),
            state: null,
            IV: null,
            ATM: null,
            range: { bid: null, ask: null },
            strike: {},
          }

          // Strikes

          let expAddr = this.symbol[symbol].opt[exp].strike

          _.flow(
            _.filter({
              kind: 'option',
              baseCurrency: symbol,
              currency: 'USD',
            }),
            _.filter(e => _.includes(exp, e.instrumentName)),
            _.map('strike'),
            _.uniq,
            _.sortBy(Number),
            _.map(strike => {
              if (expAddr[strike]) {
                return
              }

              expAddr[strike] = {
                strike,
                bidIV: null,
                askIV: null,
                midIV: null,
                spreadIV: null,
                call: {
                  bid: null,
                  ask: null,
                  mid: null,
                  bidIV: null,
                  askIV: null,
                  midIV: null,
                  settlement: null,
                  d: null,
                  g: null,
                  v: null,
                  t: null,
                  position: () => {
                    return (
                      this._positions[`${symbol}-${exp}-${strike}-C`] || {
                        size: 0,
                        avg: 0,
                        avgUSD: 0,
                        pnl: 0,
                        pnlUSD: 0,
                        td: 0,
                      }
                    )
                  },
                },
                put: {
                  bid: null,
                  ask: null,
                  mid: null,
                  bidIV: null,
                  askIV: null,
                  midIV: null,
                  settlement: null,
                  d: null,
                  g: null,
                  v: null,
                  t: null,
                  position: () => {
                    return (
                      this._positions[`${symbol}-${exp}-${strike}-P`] || {
                        size: 0,
                        avg: 0,
                        avgUSD: 0,
                        pnl: 0,
                        pnlUSD: 0,
                        td: 0,
                      }
                    )
                  },
                },
              }
            }),
          )(result)
        }),
      )(result)
    })(Object.keys(this.symbol))
  }

  expirations(symbol = 'BTC') {
    return _.flow(
      _.map(_.pick(['code', 'days', 'state'])),
      _.filter(o => o.state === 'open' || o.state === null),
      _.sortBy('days'),
      _.map('code'),
    )(this.symbol[symbol].opt)
  }

  expirationsAll(symbol = 'BTC') {
    return _.flow(
      _.map(_.pick(['code', 'days'])),
      _.sortBy('days'),
      _.map('code'),
    )(this.symbol[symbol].opt)
  }

  async delta(exp, update = false) {
    return _.flow(
      _.toPairs,
      _.filter(p => {
        return exp ? p[0].includes(exp) : true
      }),
      _.sumBy(p => p[1].td),
    )(await this.positions(update))
  }

  async positions(update = false) {
    if (update) {
      return await this._deribit
        .positions()
        .then(
          _.flow(
            _.transform((r, p) => {
              if (p.kind === 'option') {
                r[p.instrument] = {
                  size: p.size,
                  avg: p.averagePrice,
                  avgUSD: p.averageUsdPrice,
                  pnl: p.floatingPl,
                  pnlUSD: p.floatingUsdPl,
                  td: p.delta,
                }
              }

              if (p.kind === 'future') {
                r[p.instrument] = {
                  size: p.size,
                  avg: p.averagePrice,
                  avgUSD: p.averagePrice,
                  pnl: p.profitLoss,
                  pnlUSD: p.floatingUsdPl,
                  td: p.delta,
                }
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
    let price = this.futurePrice(exp, symbol)

    return _.flow(
      _.sortBy(strike => Math.abs(strike - price)),
      _.head,
      Number,
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

    await this.getOrderBook(`${symbol}-${futCode}`)

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
      i => this.getOrderBook(`${i.symbol}-${i.exp}-${i.strike}-${i.letter}`),
      { concurrency: 2 },
    ).catch(err => log.error(err))

    chain.IV = this.ATMIV(exp)
    chain.ATM = this.ATM(exp)
    chain.range = { bid: this.ATMStraddle(exp, 'bid'), ask: this.ATMStraddle(exp, 'ask') }
    debug(`Init expiration ${exp} finished`)
  }

  typeOTM(exp, symbol = 'BTC') {
    let price = this.futurePrice(exp, symbol)
    let chain = this.symbol[symbol].opt[exp]
    return chain.ATM >= price ? 'call' : 'put'
  }

  ATMStraddle(exp, bidask = 'ask', symbol = 'BTC') {
    let chain = this.symbol[symbol].opt[exp]
    let price = this.futurePrice(exp, symbol)
    let atmPrice = chain.strike[chain.ATM][this.typeOTM(exp)][bidask]
    let atmDiff = Math.abs(chain.ATM - price)
    let fee = 2 * Fee[symbol]
    fee = bidask === 'bid' ? -fee : fee
    return 2 * atmPrice * price + atmDiff + fee * price
  }
}
