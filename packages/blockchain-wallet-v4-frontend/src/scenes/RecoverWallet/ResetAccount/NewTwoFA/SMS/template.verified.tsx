import React from 'react'
import { FormattedMessage } from 'react-intl'
import { Icon } from '@blockchain-com/constellation'
import { IconCheckCircle } from '@blockchain-com/icons'

import { Button, Text } from 'blockchain-info-components'

import { Props } from '.'

const SMSVerified = (props: Props) => {
  return (
    <>
      <Icon label='checkmark-circle-filled' color='green600' size='lg'>
        <IconCheckCircle />
      </Icon>
      <Text>
        <FormattedMessage
          id='scenes.recovery.sms_verified.header'
          defaultMessage='Mobile Number Verified'
        />
      </Text>
      <Text>
        <FormattedMessage
          id='components.alerts.twofa_mobile_verify_success'
          defaultMessage='Your mobile number is now your two-factor authentication method.'
        />
      </Text>

      <Button
        nature='primary'
        data-e2e='nextButton'
        fullwidth
        height='48px'
        // onClick={handleNext}
      >
        <FormattedMessage id='buttons.next' defaultMessage='Next' />
      </Button>
    </>
  )
}

export default SMSVerified