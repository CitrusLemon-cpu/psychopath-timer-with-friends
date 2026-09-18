import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('core local flows', () => {
  it('navigates from a saved room card to the mission console', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /USCSS NOSTROMO/i }))

    expect(screen.getByRole('heading', { name: 'USCSS NOSTROMO' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'MISSION TIMERS' })).toBeInTheDocument()
    expect(screen.getByText('LOCAL DEVICE CHANNEL · NOT REALTIME')).toBeInTheDocument()
  })

  it('creates a local room and opens it', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '+ CREATE ROOM' }))
    await user.type(screen.getByLabelText('ROOM NAME'), 'Hadley Hope')
    await user.click(screen.getByRole('button', { name: /CREATE ROOM →/ }))

    expect(screen.getByRole('heading', { name: 'HADLEY HOPE' })).toBeInTheDocument()
    expect(screen.getByText('ROOM COMMANDER')).toBeInTheDocument()
  })

  it('opens the countdown form with duration and shared assignment controls', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /USCSS NOSTROMO/i }))
    await user.click(screen.getByRole('button', { name: '+ NEW COUNTDOWN' }))

    expect(screen.getByRole('dialog', { name: 'DEPLOY COUNTDOWN' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'DURATION' })).toHaveClass('selected')
    expect(screen.getByText('ASSIGN CREW')).toBeInTheDocument()
  })

  it('rejects a shared countdown with no assigned crew', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /USCSS NOSTROMO/i }))
    await user.click(screen.getByRole('button', { name: '+ NEW COUNTDOWN' }))
    await user.click(screen.getByRole('checkbox', { name: /Ellen Ripley/i }))
    await user.click(screen.getByRole('button', { name: /DEPLOY TIMER →/ }))

    expect(screen.getByRole('alert')).toHaveTextContent('Assign at least one crew member to a shared timer.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('does not offer pause for a timer created with a fixed end time', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /USCSS NOSTROMO/i }))
    await user.click(screen.getByRole('button', { name: '+ NEW COUNTDOWN' }))
    await user.type(screen.getByPlaceholderText('e.g. Survive the shift'), 'Fixed deadline')
    await user.click(screen.getByRole('button', { name: 'END TIME' }))
    await user.click(screen.getByRole('button', { name: /DEPLOY TIMER →/ }))

    const card = screen.getByRole('heading', { name: 'Fixed deadline' }).closest('article')!
    expect(within(card).getByText(/FIXED END/)).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /PAUSE/ })).not.toBeInTheDocument()
  })
})
