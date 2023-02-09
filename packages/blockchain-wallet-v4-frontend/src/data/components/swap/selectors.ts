import BigNumber from 'bignumber.js'
import { lift } from 'ramda'

import { ExtractSuccess } from '@core/types'
import { selectors } from 'data'
import { convertBaseToStandard } from 'data/components/exchange/services'
import { RootState } from 'data/rootReducer'

import { InitSwapFormValuesType } from './types'

export const getCustodialEligibility = (state: RootState) =>
  state.components.swap.custodialEligibility

export const getSide = (state: RootState) => state.components.swap.side

export const getStep = (state: RootState) => state.components.swap.step

export const getLimits = (state: RootState) => state.components.swap.limits

export const getOrder = (state: RootState) => state.components.swap.order

export const getPairs = (state: RootState) => state.components.swap.pairs

export const getPayment = (state: RootState) => state.components.swap.payment

export const getQuote = (state: RootState) => state.components.swap.quote

export const getQuotePrice = (state: RootState) => state.components.swap.quotePrice

export const getFix = (state: RootState) => state.components.swap.fix

export const getTradesStatus = (state: RootState) => state.components.swap.trades.status

export const getCrossBorderLimits = (state: RootState) => state.components.swap.crossBorderLimits

export const getLatestPendingSwapTrade = (state: RootState) => {
  const trades = state.components.swap.trades.list
  return trades.find((trade) => {
    return trade.state === 'PENDING_DEPOSIT'
  })
}

export const getRates = (state: RootState) => {
  const initSwapFormValues = selectors.form.getFormValues('initSwap')(
    state
  ) as InitSwapFormValuesType
  const fromCoin = initSwapFormValues?.BASE?.coin || 'BTC'
  const toCoin = initSwapFormValues?.COUNTER?.coin || 'BTC'

  const fromRatesR = selectors.core.data.misc.getRatesSelector(fromCoin, state)
  const toRatesR = selectors.core.data.misc.getRatesSelector(toCoin, state)
  return lift(
    (fromRates: ExtractSuccess<typeof fromRatesR>, toRates: ExtractSuccess<typeof toRatesR>) => {
      return {
        fromRates,
        toRates
      }
    }
  )(fromRatesR, toRatesR)
}

export const getIncomingAmount = (state: RootState) => {
  const initSwapFormValues = selectors.form.getFormValues('initSwap')(
    state
  ) as InitSwapFormValuesType
  const toCoin = initSwapFormValues?.COUNTER?.coin || 'BTC'

  return getQuotePrice(state).map((quotePrice) =>
    new BigNumber(quotePrice.resultAmount).isLessThanOrEqualTo(0)
      ? 0
      : convertBaseToStandard(toCoin, quotePrice.resultAmount)
  )
}

export const getCoins = () =>
  Object.keys(window.coins).filter((coin) => {
    const { products, type } = window.coins[coin].coinfig
    return (
      (products.includes('PrivateKey') || products.includes('CustodialWalletBalance')) &&
      type.name !== 'FIAT'
    )
  })
