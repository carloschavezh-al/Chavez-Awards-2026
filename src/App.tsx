import { useMemo } from 'react';
import AdminConsole from './components/AdminConsole';
import PublicScreenView from './components/PublicScreenView';
import VoterView from './components/VoterView';
import { useCeremonySocket } from './hooks/useCeremonySocket';
import type { PublicCeremonyState } from './types';

type RouteMode = 'admin' | 'screen' | 'vote';

function resolveRouteMode(): RouteMode {
  if (typeof window === 'undefined') return 'admin';
  const pathname = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get('view')?.toLowerCase();

  if (
    pathname === '/votar' ||
    pathname === '/vote' ||
    viewParam === 'vote' ||
    viewParam === 'votar'
  ) {
    return 'vote';
  }

  if (
    pathname === '/pantalla' ||
    pathname === '/screen' ||
    viewParam === 'screen' ||
    viewParam === 'pantalla'
  ) {
    return 'screen';
  }

  return 'admin';
}

function IsolatedPublicScreenPage() {
  const { state, connected } = useCeremonySocket<PublicCeremonyState>({
    role: 'screen',
  });
  return <PublicScreenView state={state} connected={connected} />;
}

function IsolatedVoterPage() {
  const { state, connected } = useCeremonySocket<PublicCeremonyState>({
    role: 'voter',
  });
  return <VoterView state={state} connected={connected} />;
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
