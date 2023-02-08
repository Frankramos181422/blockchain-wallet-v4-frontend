import BigNumber from 'bignumber.js'
import { lift } from 'ramda'

import { ExtractSuccess } from '@core/types'
import { selectors } from 'data'
import { RootState } from 'data/rootReducer'

import { convertBaseToStandard } from '../exchange/services'
import { InitSwapFormValuesType, SwapAmountFormValues } from './types'

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

  const walletCurrencyR = selectors.core.settings.getCurrency(state)
  const fromRatesR = selectors.core.data.misc.getRatesSelector(fromCoin, state)
  const toRatesR = selectors.core.data.misc.getRatesSelector(toCoin, state)
  return lift(
    (
      walletCurrency: ExtractSuccess<typeof walletCurrencyR>,
      fromRates: ExtractSuccess<typeof fromRatesR>,
      toRates: ExtractSuccess<typeof toRatesR>
    ) => {
      return {
        fromRates,
        toRates
      }
    }
  )(walletCurrencyR, fromRatesR, toRatesR)
}

export const getIncomingAmount = (state: RootState) => {
  const quotePriceR = getQuotePrice(state)
  const initSwapFormValues = selectors.form.getFormValues('initSwap')(
    state
  ) as InitSwapFormValuesType
  const swapAmountFormValues = selectors.form.getFormValues('swapAmount')(
    state
  ) as SwapAmountFormValues
  const amount = swapAmountFormValues?.cryptoAmount || 0
  const toCoin = initSwapFormValues?.COUNTER?.coin || 'BTC'

  // TODO we might need to show here resultAmount

  return lift((quotePrice: ExtractSuccess<typeof quotePriceR>) => {
    const exRate = new BigNumber(convertBaseToStandard(toCoin, quotePrice.price))
    const feeMajor = convertBaseToStandard(toCoin, quotePrice.networkFee)

    const amt = exRate.times(amount).minus(feeMajor)
    const isNegative = amt.isLessThanOrEqualTo(0)

    return {
      amt: isNegative ? 0 : amt,
      isNegative
    }
  })(quotePriceR)
}

export const getCoins = () =>
  Object.keys(window.coins).filter((coin) => {
    const { products, type } = window.coins[coin].coinfig
    return (
      (products.includes('PrivateKey') || products.includes('CustodialWalletBalance')) &&
      type.name !== 'FIAT'
    )
  })
