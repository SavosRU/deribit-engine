import moment from 'moment'
import deribit from './Deribit'
import { IV } from './bs'
import Promise from 'bluebird'
import _ from 'lodash/fp'
import Debug from 'debug'
import log from './Logger'

// eslint-disable-next-line no-unused-vars
let debug = Debug('deribit:engine')

const Fee = {
  BTC: 0.0005,
}

class Engine {
  constructor() {}

  summary(instrument) {
    return deribit.getsummary(instrument).tap(r => {
      let i = r.result.instrumentName.split('-')
      let t = i[3] === 'C' ? 'call' : 'put'
      let addr = this.symbol[i[0]].opt[i[1]].strike['' + i[2]][t]

      addr.bid = r.result.bidPrice ? r.result.bidPrice : null
      addr.ask = r.result.askPrice ? r.result.askPrice : null
      addr.mid = (addr.bid + addr.ask) / 2
    })
  }

  async init() {
    await this.instruments()
    await this.update()
    setInterval(async () => {
      await this.update()
    }, 5000)
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
                  bid: 0,
                  ask: 0,
                  mid: 0,
                  spread: 0,
                  call: {
                    bid: 0,
                    ask: 0,
                    mid: 0,
                    d: 0,
                    g: 0,
                    v: 0,
                    t: 0,
                    pos: 0,
                    avg: 0,
                    avgUSD: 0,
                  },
                  put: {
                    bid: 0,
                    ask: 0,
                    mid: 0,
                    d: 0,
                    g: 0,
                    v: 0,
                    t: 0,
                    pos: 0,
                    avg: 0,
                    avgUSD: 0,
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

  async positions() {
    await deribit
      .positions()
      .then(r => r.result)
      .then(
        _.flow(
          _.filter({ kind: 'option' }),
          _.map(p => {
            let i = p.instrument.split('-')
            let t = i[3] === 'C' ? 'call' : 'put'
            let addr = this.symbol[i[0]].opt[i[1]].strike['' + i[2]][t]
            addr.pos = p.size
            addr.avg = p.averagePrice
            addr.avgUSD = p.averageUsdPrice
            addr.pnl = p.floatingPl
            addr.pnlUSD = p.floatingUsdPl
            addr.td = p.delta
          }),
        ),
      )
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
    return chain.strike[atm].mid
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
      .catch(log.error)

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
        return this.summary(instrument).then(r => {
          if (i.strike >= fut.mid) {
            chain.strike[i.strike].bid = r.result.bidPrice
              ? IV(i.type, fut.ask, i.strike, chain.days, r.result.bidPrice * fut.ask) *
                100
              : null

            chain.strike[i.strike].ask = r.result.askPrice
              ? IV(i.type, fut.bid, i.strike, chain.days, r.result.askPrice * fut.bid) *
                100
              : null
          } else {
            chain.strike[i.strike].bid = r.result.bidPrice
              ? IV(i.type, fut.bid, i.strike, chain.days, r.result.bidPrice * fut.bid) *
                100
              : null

            chain.strike[i.strike].ask = r.result.askPrice
              ? IV(i.type, fut.ask, i.strike, chain.days, r.result.askPrice * fut.ask) *
                100
              : null
          }

          chain.strike[i.strike].mid =
            (chain.strike[i.strike].ask + chain.strike[i.strike].bid) / 2

          chain.strike[i.strike].spread = Math.abs(
            chain.strike[i.strike].ask - chain.strike[i.strike].bid,
          )
        })
      },
      { concurrency: 2 },
    ).catch(log.error)

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
