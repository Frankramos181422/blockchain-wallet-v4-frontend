import BigNumber from 'bignumber.js'
import { differenceInMilliseconds } from 'date-fns'
import { call, delay, put, race, select, take } from 'redux-saga/effects'

import { Exchange } from '@core'
import { APIType } from '@core/network/api'
import {
  BSPaymentTypes,
  CoinType,
  PaymentType,
  PaymentValue,
  Product,
  QuoteProfileName,
  SwapQuoteType
} from '@core/types'
import { errorHandler } from '@core/utils'
import { actions, selectors } from 'data'
import { SWAP_ACCOUNTS_SELECTOR } from 'data/coins/model/swap'
import { getCoinAccounts } from 'data/coins/selectors'
import { generateProvisionalPaymentAmount } from 'data/coins/utils'
import { convertBaseToStandard, convertStandardToBase } from 'data/components/exchange/services'
import {
  CustodialSanctionsEnum,
  ModalName,
  NabuProducts,
  ProductEligibilityForUser
} from 'data/types'
import { isNabuError } from 'services/errors'

import { actions as custodialActions } from '../../custodial/slice'
import profileSagas from '../../modules/profile/sagas'
import sendSagas from '../send/sagas'
import { selectReceiveAddress } from '../utils/sagas'
import { FALLBACK_DELAY } from './model'
import * as S from './selectors'
import { actions as A } from './slice'
import {
  InitSwapFormValuesType,
  MempoolFeeType,
  SwapAccountType,
  SwapAmountFormValues,
  SwapBaseCounterTypes
} from './types'
import { getDirection, getPair } from './utils'

export default ({ api, coreSagas, networks }: { api: APIType; coreSagas; networks }) => {
  const { buildAndPublishPayment, paymentGetOrElse } = sendSagas({
    api,
    coreSagas,
    networks
  })
  const { isTier2, waitForUserData } = profileSagas({ api, coreSagas, networks })

  const cancelOrder = function* ({ payload }: ReturnType<typeof A.cancelOrder>) {
    try {
      yield put(actions.form.startSubmit('swapOrderDetails'))
      yield call(api.cancelSwapOrder, payload.id)
      yield put(actions.form.stopSubmit('swapOrderDetails'))
      yield put(actions.components.refresh.refreshClicked())
      yield put(A.setStep({ step: 'INIT_SWAP' }))
    } catch (e) {
      const error = errorHandler(e)
      yield put(actions.form.stopSubmit('swapOrderDetails', { _error: error }))
    }
  }

  const changeBase = function* ({ payload }: ReturnType<typeof A.changeBase>) {
    yield put(actions.form.change('initSwap', 'BASE', payload.account))
    const initSwapFormValues = selectors.form.getFormValues('initSwap')(
      yield select()
    ) as InitSwapFormValuesType

    if (initSwapFormValues?.BASE && initSwapFormValues?.COUNTER) {
      yield put(
        A.setStep({
          options: {
            account: payload.account.type,
            coin: payload.account.coin,
            side: 'BASE'
          },
          step: 'ENTER_AMOUNT'
        })
      )
    } else {
      yield put(
        A.setStep({
          options: {
            account: payload.account.type,
            coin: payload.account.coin,
            side: 'BASE'
          },
          step: 'INIT_SWAP'
        })
      )
    }
  }

  const changeCounter = function* ({ payload }: ReturnType<typeof A.changeCounter>) {
    yield put(actions.form.change('initSwap', 'COUNTER', payload.account))
    const initSwapFormValues = selectors.form.getFormValues('initSwap')(
      yield select()
    ) as InitSwapFormValuesType

    if (initSwapFormValues?.BASE && initSwapFormValues?.COUNTER) {
      yield put(
        A.setStep({
          options: {
            account: payload.account.type,
            coin: payload.account.coin,
            side: 'COUNTER'
          },
          step: 'ENTER_AMOUNT'
        })
      )
    } else {
      yield put(
        A.setStep({
          options: {
            account: payload.account.type,
            coin: payload.account.coin,
            side: 'COUNTER'
          },
          step: 'INIT_SWAP'
        })
      )
    }
  }

  const changeTrendingPair = function* ({ payload }: ReturnType<typeof A.changeTrendingPair>) {
    yield put(actions.form.change('initSwap', 'BASE', payload.baseAccount))
    yield put(actions.form.change('initSwap', 'COUNTER', payload.counterAccount))
    yield put(A.setStep({ isSuggestedPair: true, step: 'ENTER_AMOUNT' }))

    // stop ongoing polling and restart new
    yield put(A.stopPollQuotePrice())
    yield put(A.startPollQuotePrice({}))
  }

  const calculateProvisionalPayment = function* (
    source: SwapAccountType,
    quote: SwapQuoteType,
    amount,
    fee: MempoolFeeType = 'priority'
  ): Generator<any, PaymentValue | { coin: CoinType; effectiveBalance: number }, PaymentType> {
    try {
      const { coin } = source
      const addressOrIndex = source.address
      const addressType = source.type
      const isSourceErc20 = window.coins[source.coin].coinfig.type.erc20Address
      const paymentType = isSourceErc20 ? 'eth' : coin.toLowerCase()
      let payment: PaymentType = yield coreSagas.payment[paymentType]
        .create({ network: networks[paymentType] })
        .chain()
        .init({ coin, isErc20: isSourceErc20 })
        .fee(fee)
        .from(addressOrIndex, addressType)
        .done()

      const paymentAmount = generateProvisionalPaymentAmount(coin, amount)
      payment = yield payment.amount(paymentAmount)
      // TODO, add isMemoBased check
      if (quote.sampleDepositAddress) {
        const sampleAddr = quote.sampleDepositAddress.split(':')[0]
        return (yield payment.chain().to(sampleAddr, 'ADDRESS').build().done()).value()
      }
      return { coin: source.coin, effectiveBalance: 0 }
    } catch (e) {
      // eslint-disable-next-line
      console.log(e)
      return { coin: source.coin, effectiveBalance: 0 }
    }
  }

  const createOrder = function* () {
    let onChain = false
    let toChain = false

    try {
      console.log('create order now')
      yield put(actions.form.startSubmit('previewSwap'))
      const initSwapFormValues = selectors.form.getFormValues('initSwap')(
        yield select()
      ) as InitSwapFormValuesType
      const swapAmountFormValues = selectors.form.getFormValues('swapAmount')(
        yield select()
      ) as SwapAmountFormValues
      if (!initSwapFormValues || !initSwapFormValues.BASE || !initSwapFormValues.COUNTER) {
        throw new Error('NO_INIT_SWAP_FORM_VALUES')
      }
      if (!swapAmountFormValues || !swapAmountFormValues.amount) {
        throw new Error('NO_SWAP_AMOUNT_FORM_VALUES')
      }

      const ccy = selectors.core.settings.getCurrency(yield select()).getOrElse('USD')

      const { BASE, COUNTER } = initSwapFormValues

      const direction = getDirection(BASE, COUNTER)
      onChain = direction === 'ON_CHAIN' || direction === 'FROM_USERKEY'
      toChain = direction === 'ON_CHAIN' || direction === 'TO_USERKEY'

      const amount = convertStandardToBase(BASE.coin, swapAmountFormValues.cryptoAmount)

      const quote = S.getQuote(yield select()).getOrFail('NO_SWAP_QUOTE')
      const refundAddr = onChain
        ? yield call(selectReceiveAddress, BASE, networks, api, coreSagas)
        : undefined
      const destinationAddr = toChain
        ? yield call(selectReceiveAddress, COUNTER, networks, api, coreSagas)
        : undefined
      const order: ReturnType<typeof api.createSwapOrder> = yield call(
        api.createSwapOrder,
        direction,
        quote.quote.quoteId,
        amount,
        ccy,
        destinationAddr,
        refundAddr
      )
      const paymentR = S.getPayment(yield select())
      const payment = paymentGetOrElse(BASE.coin, paymentR)
      if (onChain) {
        try {
          const hotWalletAddress = selectors.core.walletOptions
            .getHotWalletAddresses(yield select(), Product.SWAP)
            .getOrElse(null)
          if (typeof hotWalletAddress !== 'string') {
            console.error(
              'Unable to retrieve HotWallet address; falling back to deposit and sweep.'
            )
            yield call(buildAndPublishPayment, payment.coin, payment, order.kind.depositAddress)
          } else {
            yield call(
              buildAndPublishPayment,
              payment.coin,
              payment,
              order.kind.depositAddress,
              hotWalletAddress
            )
          }

          yield call(api.updateSwapOrder, order.id, 'DEPOSIT_SENT')
        } catch (e) {
          yield call(api.updateSwapOrder, order.id, 'CANCEL')
          throw e
        }
      }
      yield put(actions.form.stopSubmit('previewSwap'))
      yield put(actions.components.refresh.refreshClicked())
      yield put(actions.form.destroy('swapAmount'))
      yield put(
        A.setStep({
          options: {
            order
          },
          step: 'SUCCESSFUL_SWAP'
        })
      )
      yield put(actions.custodial.fetchRecentSwapTxs())
    } catch (e) {
      if (isNabuError(e)) {
        yield put(actions.form.stopSubmit('previewSwap', { _error: e }))
      } else {
        const error = errorHandler(e)
        yield put(actions.form.stopSubmit('previewSwap', { _error: error }))
      }
    }
  }

  const fetchCustodialEligibility = function* () {
    try {
      yield put(A.fetchCustodialEligibilityLoading())
      const { eligible }: ReturnType<typeof api.getEligibilityForProduct> = yield call(
        api.getEligibilityForProduct,
        NabuProducts.BROKERAGE
      )
      yield put(A.fetchCustodialEligibilitySuccess(eligible))
    } catch (e) {
      const error = errorHandler(e)
      yield put(A.fetchCustodialEligibiliyFailure(error))
    }
  }

  const fetchLimits = function* () {
    try {
      yield put(A.fetchLimitsLoading())
      const limits: ReturnType<typeof api.getSwapLimits> = yield call(
        api.getSwapLimits,
        selectors.core.settings.getCurrency(yield select()).getOrElse('USD')
      )
      yield put(A.fetchLimitsSuccess(limits))
    } catch (e) {
      const error = errorHandler(e)
      yield put(A.fetchLimitsFailure(error))
    }
  }

  const fetchPairs = function* () {
    try {
      yield put(A.fetchPairsLoading())
      const pairs: ReturnType<typeof api.getSwapPairs> = yield call(api.getSwapPairs)
      yield put(A.fetchPairsSuccess(pairs))
    } catch (e) {
      const error = errorHandler(e)
      yield put(A.fetchPairsFailure(error))
    }
  }

  const fetchQuote = function* ({ payload }: ReturnType<typeof A.startPollQuote>) {
    while (true) {
      try {
        console.log('payload', payload)
        const { amount, counter, pair, paymentMethod, profile } = payload
        yield put(A.fetchQuoteLoading())

        const quote: ReturnType<typeof api.getSwapQuote> = yield call(
          api.getSwapQuote,
          pair,
          profile,
          amount,
          paymentMethod
        )

        console.log('newQuote ------  ', quote)

        yield put(
          A.fetchQuoteSuccess({
            quote,
            rate: new BigNumber(convertBaseToStandard(counter.coin, quote.price)).toNumber()
          })
        )
        const refresh = Math.abs(
          differenceInMilliseconds(new Date(), new Date(quote.quoteExpiresAt))
        )
        yield delay(refresh)
      } catch (e) {
        const error = errorHandler(e)
        if (isNabuError(e)) {
          yield put(A.fetchQuoteFailure(error))

          yield put(A.stopPollQuote())

          return
        }

        yield put(A.fetchQuoteFailure(error))
        // stop fetching new quote until user does retry action
        yield put(A.stopPollQuote())
      }
    }
  }

  const fetchQuotePrice = function* ({ payload }: ReturnType<typeof A.startPollQuotePrice>) {
    while (true) {
      try {
        const { amount = '0' } = payload
        yield put(A.fetchQuotePriceLoading())
        const initSwapFormValues = selectors.form.getFormValues('initSwap')(
          yield select()
        ) as InitSwapFormValuesType
        if (!initSwapFormValues || !initSwapFormValues.BASE || !initSwapFormValues.COUNTER) {
          return yield put(A.setStep({ step: 'INIT_SWAP' }))
        }

        const { BASE, COUNTER } = initSwapFormValues

        const pair = getPair(BASE, COUNTER)

        const quotePrice: ReturnType<typeof api.getSwapQuotePrice> = yield call(
          api.getSwapQuotePrice,
          pair,
          amount,
          BSPaymentTypes.FUNDS,
          QuoteProfileName.SIMPLEBUY
        )
        console.log('newQuote', quotePrice)

        yield put(A.fetchQuotePriceSuccess(quotePrice))

        // yield put(
        //   A.fetchQuotePriceSuccess({
        //     quote,
        //     rate: new BigNumber(convertBaseToStandard(COUNTER.coin, quote.price)).toNumber()
        //   })
        // )
        // const refresh = Math.abs(
        //   differenceInMilliseconds(new Date(), new Date(quote.quoteExpiresAt))
        // )
        yield delay(FALLBACK_DELAY)
      } catch (e) {
        const error = errorHandler(e)
        if (isNabuError(e)) {
          yield put(A.fetchQuoteFailure(error))

          yield put(A.stopPollQuote())

          return
        }

        yield put(A.fetchQuoteFailure(error))
        // stop fetching new quote until user does retry action
        yield put(A.stopPollQuote())
      }
    }
  }

  const fetchTrades = function* () {
    try {
      yield call(waitForUserData)
      yield put(A.fetchTradesLoading())
      const trades = yield call(api.getSwapTrades)
      yield put(A.fetchTradesSuccess(trades))
    } catch (e) {
      const error = errorHandler(e)
      yield put(A.fetchTradesFailure(error))
    }
  }

  const formChanged = function* (action) {
    if (action.meta.form !== 'swapAmount') return
    if (action.meta.field !== 'amount') return
    const initSwapFormValues = selectors.form.getFormValues('initSwap')(
      yield select()
    ) as InitSwapFormValuesType
    if (!initSwapFormValues || !initSwapFormValues.BASE) return

    const { BASE } = initSwapFormValues
    const paymentR = S.getPayment(yield select())
    const fix = S.getFix(yield select())
    const userCurrency = selectors.core.settings.getCurrency(yield select()).getOrElse('USD')
    const rates = selectors.core.data.misc
      .getRatesSelector(BASE.coin, yield select())
      .getOrFail('Failed to get rates')

    console.log('form has been changed', action.meta.field)

    const amountFieldValue =
      fix === 'CRYPTO'
        ? action.payload
        : Exchange.convertFiatToCoin({
            coin: BASE.coin,
            currency: userCurrency,
            rates,
            value: action.payload
          })
    yield put(actions.form.change('swapAmount', 'cryptoAmount', amountFieldValue))

    const swapAmountValues = selectors.form.getFormValues('swapAmount')(
      yield select()
    ) as SwapAmountFormValues

    if (action.meta.field === 'amount' && swapAmountValues?.cryptoAmount) {
      yield put(A.stopPollQuotePrice())

      const amount = convertStandardToBase(BASE.coin, swapAmountValues.cryptoAmount)

      yield put(A.startPollQuotePrice({ amount }))
    }

    if (BASE.type === SwapBaseCounterTypes.CUSTODIAL) return

    // @ts-ignore
    let payment = paymentGetOrElse(BASE.coin, paymentR)

    try {
      const paymentAmount = generateProvisionalPaymentAmount(
        BASE.coin,
        Number(swapAmountValues?.cryptoAmount)
      )
      payment = yield payment.amount(paymentAmount)
      payment = yield payment.build()
      yield put(A.updatePaymentSuccess(payment.value()))
    } catch (error) {
      yield put(A.updatePaymentFailure(error))
    }
  }

  const initAmountForm = function* () {
    // let payment: PaymentValue
    try {
      yield put(A.startPollQuotePrice({}))
      yield put(A.fetchLimits())
      yield put(A.updatePaymentLoading())
      const initSwapFormValues = selectors.form.getFormValues('initSwap')(
        yield select()
      ) as InitSwapFormValuesType
      if (!initSwapFormValues || !initSwapFormValues.BASE) {
        return yield put(A.setStep({ step: 'INIT_SWAP' }))
      }

      // const swapAmountFormValues = selectors.form.getFormValues('swapAmount')(
      //   yield select()
      // ) as SwapAmountFormValues

      yield race({
        failure: take(A.fetchQuotePriceFailure.type),
        success: take(A.fetchQuotePriceSuccess.type)
      })

      // const quote = S.getQuote(yield select()).getOrFail(NO_QUOTE)

      const { BASE } = initSwapFormValues
      if (BASE.type === SwapBaseCounterTypes.ACCOUNT) {
        // TODO figure out how this one should works
        // https://www.notion.so/blockchaincom/ETH-Main-Address-API-88e73e63db32442e9f8ae6130605af1a
        // payment = yield call(
        //   calculateProvisionalPayment,
        //   BASE,
        //   quote.quote,
        //   swapAmountFormValues?.cryptoAmount || 0
        // )
        // yield put(A.updatePaymentSuccess(payment))
        yield put(A.updatePaymentSuccess(undefined))
      } else {
        yield put(A.updatePaymentSuccess(undefined))
      }
    } catch (e) {
      const error = errorHandler(e)
      yield put(A.updatePaymentFailure(error))
    }
  }

  const refreshAccounts = function* () {
    const initSwapFormValues = selectors.form.getFormValues('initSwap')(
      yield select()
    ) as InitSwapFormValuesType

    if (!initSwapFormValues || !initSwapFormValues.BASE || !initSwapFormValues.COUNTER) {
      return
    }

    const coins = S.getCoins()
    const accounts = getCoinAccounts(yield select(), { coins, ...SWAP_ACCOUNTS_SELECTOR })
    const baseAccount = accounts[initSwapFormValues.BASE.coin].find(
      (val) => val.label === initSwapFormValues.BASE?.label
    )
    const counterAccount = accounts[initSwapFormValues.COUNTER.coin].find(
      (val) => val.label === initSwapFormValues.COUNTER?.label
    )

    yield put(actions.form.change('initSwap', 'BASE', baseAccount))
    yield put(actions.form.change('initSwap', 'COUNTER', counterAccount))
  }

  const showModal = function* ({ payload }: ReturnType<typeof A.showModal>) {
    const { baseCurrency, counterCurrency, origin } = payload
    yield put(
      actions.modals.showModal(ModalName.SWAP_MODAL, {
        baseCurrency,
        counterCurrency,
        origin
      })
    )

    const latestPendingOrder = S.getLatestPendingSwapTrade(yield select())

    // get current user tier
    const isUserTier2 = yield call(isTier2)

    yield put(actions.custodial.fetchProductEligibilityForUser())
    yield take([
      custodialActions.fetchProductEligibilityForUserSuccess.type,
      custodialActions.fetchProductEligibilityForUserFailure.type
    ])

    const products = selectors.custodial.getProductEligibilityForUser(yield select()).getOrElse({
      swap: { enabled: false, maxOrdersLeft: 0 }
    } as ProductEligibilityForUser)

    // check is user eligible to do sell/buy
    // we skip this for gold users
    if (!isUserTier2 && !latestPendingOrder) {
      // in case that there are no maxOrdersLeft user can swap freely
      const userCanSwapMore = !products.swap?.maxOrdersLeft || products.swap?.maxOrdersLeft > 0
      // prompt upgrade modal in case that user can't buy more
      if (!userCanSwapMore) {
        yield put(
          actions.modals.showModal(ModalName.UPGRADE_NOW_SILVER_MODAL, {
            origin: 'BuySellInit'
          })
        )
        // close swap Modal
        yield put(actions.modals.closeModal(ModalName.SWAP_MODAL))
        return
      }
    }

    // show sanctions for sell
    if (products?.swap?.reasonNotEligible) {
      const message =
        products.swap.reasonNotEligible.reason !== CustodialSanctionsEnum.EU_5_SANCTION
          ? products.swap.reasonNotEligible.message
          : undefined
      const sanctionsType = products.swap.reasonNotEligible.type
      yield put(
        actions.modals.showModal(ModalName.SANCTIONS_INFO_MODAL, {
          message,
          origin: 'Swap',
          sanctionsType
        })
      )
      yield put(actions.modals.closeModal(ModalName.SWAP_MODAL))
      return
    }

    if (latestPendingOrder) {
      yield put(
        A.setStep({
          options: { order: latestPendingOrder },
          step: 'ORDER_DETAILS'
        })
      )
    } else {
      yield put(
        A.setStep({
          step: 'INIT_SWAP'
        })
      )
    }
  }

  const switchFix = function* ({ payload }: ReturnType<typeof A.switchFix>) {
    yield put(A.setCheckoutFix(payload.fix))
    const newAmount = new BigNumber(payload.amount).isGreaterThan(0) ? payload.amount : undefined
    yield put(actions.form.change('swapAmount', 'amount', newAmount))
    yield put(actions.form.focus('swapAmount', 'amount'))
  }

  const toggleBaseAndCounter = function* () {
    const initSwapFormValues = selectors.form.getFormValues('initSwap')(
      yield select()
    ) as InitSwapFormValuesType
    if (!initSwapFormValues || !initSwapFormValues.BASE || !initSwapFormValues.COUNTER) {
      return yield put(A.setStep({ step: 'INIT_SWAP' }))
    }

    const { BASE: currentBase, COUNTER: currentCounter } = initSwapFormValues

    yield put(actions.form.change('initSwap', 'BASE', currentCounter))
    yield put(actions.form.change('initSwap', 'COUNTER', currentBase))
    yield put(actions.form.clearFields('swapAmount', false, false, 'amount'))
    yield put(actions.form.change('swapAmount', 'cryptoAmount', 0))

    console.log(' do not call init amount')
    // yield put(A.initAmountForm())
  }

  const handleSwapMaxAmountClick = function* ({
    payload
  }: ReturnType<typeof A.handleSwapMaxAmountClick>) {
    const { amount } = payload

    yield put(actions.form.change('swapAmount', 'amount', amount))
  }

  const handleSwapMinAmountClick = function* ({
    payload
  }: ReturnType<typeof A.handleSwapMinAmountClick>) {
    const { amount } = payload

    yield put(actions.form.change('swapAmount', 'amount', amount))
  }

  const fetchCrossBorderLimits = function* ({
    payload
  }: ReturnType<typeof A.fetchCrossBorderLimits>) {
    const { currency, fromAccount, inputCurrency, outputCurrency, toAccount } = payload
    try {
      yield put(A.fetchCrossBorderLimitsLoading())
      const limitsResponse: ReturnType<typeof api.getCrossBorderTransactions> = yield call(
        api.getCrossBorderTransactions,
        inputCurrency,
        fromAccount,
        outputCurrency,
        toAccount,
        currency
      )
      yield put(A.fetchCrossBorderLimitsSuccess(limitsResponse))
    } catch (e) {
      yield put(A.fetchCrossBorderLimitsFailure(e))
    }
  }

  return {
    calculateProvisionalPayment,
    cancelOrder,
    changeBase,
    changeCounter,
    changeTrendingPair,
    createOrder,
    fetchCrossBorderLimits,
    fetchCustodialEligibility,
    fetchLimits,
    fetchPairs,
    fetchQuote,
    fetchQuotePrice,
    fetchTrades,
    formChanged,
    handleSwapMaxAmountClick,
    handleSwapMinAmountClick,
    initAmountForm,
    refreshAccounts,
    showModal,
    switchFix,
    toggleBaseAndCounter
  }
}
