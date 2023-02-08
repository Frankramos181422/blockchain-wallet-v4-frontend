import { put } from 'typed-redux-saga'

import { BSPaymentTypes, QuoteProfileName } from '@core/types'
import { errorHandler } from '@core/utils'
import { convertStandardToBase } from 'data/components/exchange/services'
import { isNabuError } from 'services/errors'

import { actions } from '../slice'
import { getPair } from '../utils'

const reportFailure = function* (e: unknown) {
  const errorPayload = isNabuError(e) ? e : errorHandler(e)
  yield* put(actions.fetchQuoteFailure(errorPayload))
}

export const proceedToSwapConfirmation = function* ({
  payload
}: ReturnType<typeof actions.proceedToSwapConfirmation>) {
  const { amount, base, counter } = payload

  yield* put(
    actions.setStep({
      options: {
        baseAccountType: base.type,
        baseCoin: base.coin,
        counterAccountType: counter.type,
        counterCoin: counter.coin
      },
      step: 'PREVIEW_SWAP'
    })
  )

  const pair = getPair(base, counter)

  try {
    yield* put(
      actions.startPollQuote({
        amount: convertStandardToBase(counter.coin, amount),
        counter,
        pair,
        paymentMethod: BSPaymentTypes.FUNDS,
        profile: QuoteProfileName.SIMPLEBUY
      })
    )
  } catch (e) {
    yield* reportFailure(e)
  }
}
