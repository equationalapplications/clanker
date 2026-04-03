import { createContext, useContext } from 'react'
import { ActorRefFrom } from 'xstate'
import { authMachine } from '~/machines/authMachine'
import { termsMachine } from '~/machines/termsMachine'

export const GlobalStateContext = createContext<
  | {
      authService: ActorRefFrom<typeof authMachine>
      termsService: ActorRefFrom<typeof termsMachine>
    }
  | undefined
>(undefined)

export const useAuthMachine = () => {
  const context = useContext(GlobalStateContext)
  if (context === undefined) {
    throw new Error('useAuthMachine must be used within a GlobalStateProvider')
  }
  return context.authService
}

export const useTermsMachine = () => {
  const context = useContext(GlobalStateContext)
  if (context === undefined) {
    throw new Error('useTermsMachine must be used within a GlobalStateProvider')
  }
  return context.termsService
}
