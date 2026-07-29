import { render, screen } from '@testing-library/react-native'

import { OfflineBanner } from '../../src/components/ui/OfflineBanner'

describe('OfflineBanner', () => {
  it('renders the default offline message and stale label', () => {
    render(<OfflineBanner staleLabel="Saved 3m ago" />)

    expect(screen.getByText("You're offline")).toBeTruthy()
    expect(screen.getByText('Saved 3m ago')).toBeTruthy()
  })
})
