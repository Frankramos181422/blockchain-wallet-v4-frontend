import React, { useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { connect, ConnectedProps } from 'react-redux'
import { isValidNumber } from 'libphonenumber-js'
import { bindActionCreators } from 'redux'
import { Field, InjectedFormProps } from 'redux-form'

import { Button, Link, Text } from 'blockchain-info-components'
import Form from 'components/Form/Form'
import FormError from 'components/Form/FormError'
import FormGroup from 'components/Form/FormGroup'
import FormItem from 'components/Form/FormItem'
import FormLabel from 'components/Form/FormLabel'
import PhoneNumberBox from 'components/Form/PhoneNumberBox'
import TextBox from 'components/Form/TextBox'
import { required } from 'services/forms'
import { removeWhitespace } from 'services/forms/normalizers'

import { Props } from '.'

const validMobileNumber = (value) =>
  isValidNumber(value) ? undefined : (
    <FormattedMessage id='formhelper.invalidmobilenumber' defaultMessage='Invalid mobile number' />
  )

const SMSSetup = (props: Props) => {
  const [showVerifyCodeField, setVerifyCodeField] = useState(false)

  return (
    <>
      <Text>
        <FormattedMessage
          id='scenes.security.twostepsetup.smstitle'
          defaultMessage='Mobile Phone Number'
        />
      </Text>

      {showVerifyCodeField ? (
        <>
          <Text>
            <FormattedMessage
              id='scenes.security.twostepverification.sms.entermobile'
              defaultMessage='Enter your mobile number and click Get Code. A verification code will be sent.'
            />
          </Text>
          <Field name='verificationCode' component={TextBox} validate={[required]} />
          <Text weight={500} size='12px' color='blue600' onClick={() => setVerifyCodeField(false)}>
            <FormattedMessage
              id='modals.mobilenumberchange.changenumbertitle'
              defaultMessage='Change Mobile Number'
            />
          </Text>
          <Button
            nature='primary'
            data-e2e='submitCode'
            fullwidth
            height='48px'
            // TODO: Add real on click event
            onClick={() => props.changeAuthenticatorStep(2)}
          >
            <FormattedMessage
              id='scenes.recovery.setup2FA.submitCode'
              defaultMessage='Submit Code'
            />
          </Button>
        </>
      ) : (
        <>
          <Text>
            <FormattedMessage
              id='scenes.security.twostepverification.sms.entermobile'
              defaultMessage='Enter your mobile number and click Get Code. A verification code will be sent.'
            />
          </Text>

          <Field
            name='smsNumber'
            component={PhoneNumberBox}
            placeholder='212-555-5555'
            normalize={removeWhitespace}
            validate={[required, validMobileNumber]}
            noLastPass
            autoFocus
            data-e2e='smsNumber'
          />

          <Button
            nature='primary'
            data-e2e='nextButton'
            fullwidth
            height='48px'
            // TODO: Temporary step change
            onClick={() => setVerifyCodeField(true)}
            // onClick={handleSubmit}
          >
            <FormattedMessage
              id='scenes.recovery.setup2FA.getCode'
              defaultMessage=' Get Verification Code'
            />
          </Button>
        </>
      )}
    </>
  )
}

export default SMSSetup