import { useMemo } from 'react';
import AdminConsole from './components/AdminConsole';
import PublicScreenView from './components/PublicScreenView';
import VoterView from './components/VoterView';
import { useCeremonySocket } from './hooks/useCeremonySocket';
import { resolveRouteMode } from './lib/routes';
import type { PublicCeremonyState } from './types';

function IsolatedPublicScreenPage() {
  const { state, connected } = useCeremonySocket<PublicCeremonyState>({
    role: 'screen',
  });
  return <PublicScreenView state={state} connected={connected} />;
}

function IsolatedVoterPage() {
  const { state, connected, isStaticFallback } = useCeremonySocket<PublicCeremonyState>({
    role: 'voter',
  });
  return (
    <VoterView
      state={state}
      connected={connected}
      isStaticFallback={isStaticFallback}
    />
  );
}

export default function App() {
  const routeMode = useMemo(() => resolveRouteMode(), []);

  if (routeMode === 'vote') {
    return <IsolatedVoterPage />;
  }

  if (routeMode === 'screen') {
    return <IsolatedPublicScreenPage />;
  }

  return <AdminConsole />;
}
