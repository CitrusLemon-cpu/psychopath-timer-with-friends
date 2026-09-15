import LocalApp from './LocalApp'
import RemoteApp from './RemoteApp'
import { readSupabaseConfig } from './supabase/config'
import { createSupabaseClient } from './supabase/client'
import { SupabaseGateway } from './supabase/gateway'
import type { MultiplayerGateway } from './multiplayer/gateway'

export interface AppProps { gateway?: MultiplayerGateway | null }

let configurationError = ''
let configuredGateway: MultiplayerGateway | null = null
try {
  const config = readSupabaseConfig()
  configuredGateway = config ? new SupabaseGateway(createSupabaseClient(config)) : null
} catch (caught) {
  configurationError = caught instanceof Error ? caught.message : 'Supabase configuration is invalid.'
}

export default function App({ gateway = configuredGateway }: AppProps) {
  if (!gateway && configurationError) return <main className="loading-screen"><p className="form-error" role="alert">{configurationError}</p></main>
  return gateway ? <RemoteApp gateway={gateway} /> : <LocalApp />
}
