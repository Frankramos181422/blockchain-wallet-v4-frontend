import React, { SyntheticEvent, useEffect, useState } from 'react'
import { FormattedMessage } from 'react-intl'
import styled from 'styled-components'

import { Button, Icon, Text } from 'blockchain-info-components'
import { RecoverSteps } from 'data/types'
import { RECOVERY_EMAIL_SENT_ERROR } from 'services/alerts'

import { Props as OwnProps } from '..'
import { BackArrowFormHeader, CircleBackground, FormWrapper, Row } from '../model'

const FormBody = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`

const CheckInbox = (props: Props) => {
  const [disabled, setDisabled] = useState(true)
  const [sentState, setSentState] = useState('sent')
  useEffect(() => {
    if (disabled) {
      setTimeout(() => {
        setDisabled(false)
      }, 30000)
    }
    if (sentState === 'sent') {
      setTimeout(() => {
        setSentState('checkEmail')
      }, 5000)
    }
  }, [disabled, sentState])

  const hasErrorAlert = props.alerts.find((alert) => alert.message === RECOVERY_EMAIL_SENT_ERROR)

  return (
    <FormWrapper>
      <BackArrowFormHeader
        handleBackArrowClick={() => props.setStep(RecoverSteps.FORGOT_PASSWORD_EMAIL)}
        email={props.formValues.recoveryEmail}
      />
      <FormBody>
        <CircleBackground color='blue600'>
          <Icon name='computer' color='white' size='24px' />
        </CircleBackground>
        <Text color='grey900' size='20px' weight={600} lineHeight='1.5'>
          <FormattedMessage id='copy.check_your_inbox' defaultMessage='Check Your Inbox' />
        </Text>
        <Text
          color='grey900'
          size='16px'
          weight={500}
          lineHeight='1.5'
          style={{ margin: '8px 0 24px 0', textAlign: 'center' }}
        >
          <FormattedMessage
            id='scenes.recovery.checkemail'
            defaultMessage='A link to recover your account has been sent to your inbox.'
          />
        </Text>
      </FormBody>
      <Button
        type='submit'
        nature='empty-blue'
        fullwidth
        height='48px'
        data-e2e='loginResendEmail'
        disabled={disabled && !hasErrorAlert}
        // @ts-ignore
        onClick={(e: SyntheticEvent) => {
          setDisabled(true)
          setSentState('sent')
          // TODO: correctly handle this resend email button
          props.handleSubmit(e)
        }}
      >
        {disabled && sentState === 'sent' && !hasErrorAlert && (
          <Row>
            <Icon
              color='blue600'
              name='checkmark-circle-filled'
              size='14px'
              style={{ marginRight: '8px' }}
            />
            <FormattedMessage
              id='components.form.tabmenutransactionstatus.sent'
              defaultMessage='Sent'
            />
          </Row>
        )}
        {disabled && sentState === 'checkEmail' && !hasErrorAlert && (
          <FormattedMessage id='copy.check_your_email' defaultMessage='Check your email' />
        )}
        {!disabled && (
          <FormattedMessage
            id='components.EmailVerification.sendemailagain'
            defaultMessage='Send Again'
          />
        )}
      </Button>
    </FormWrapper>
  )
}

type Props = OwnProps & {
  handleSubmit: (e) => void
  setStep: (step: RecoverSteps) => void
}

export default CheckInbox