import { useMemo } from 'react';
import AdminConsole from './components/AdminConsole';
import PublicScreenView from './components/PublicScreenView';
import VoterView from './components/VoterView';
import { useCeremonySocket } from './hooks/useCeremonySocket';
import { buildViewUrl, resolveRouteMode } from './lib/routes';
import type { PublicCeremonyState } from './types';

function IsolatedPublicScreenPage() {
  const { state, connected } = useCeremonySocket<PublicCeremonyState>({
    role: 'screen',
  });
  return <PublicScreenView state={state} connected={connected} />;
}

function IsolatedVoterPage({ showAdminFooter }: { showAdminFooter: boolean }) {
  const { state, connected, isStaticFallback } = useCeremonySocket<PublicCeremonyState>({
    role: 'voter',
  });
  const adminHref = useMemo(
    () => (showAdminFooter ? buildViewUrl('admin') : undefined),
    [showAdminFooter]
  );
  return (
    <VoterView
      state={state}
      connected={connected}
      isStaticFallback={isStaticFallback}
      adminFooterHref={adminHref}
    />
  );
}

export default function App() {
  const routeMode = useMemo(() => resolveRouteMode(), []);

  if (routeMode === 'admin') {
    return <AdminConsole />;
  }

  if (routeMode === 'screen') {
    return <IsolatedPublicScreenPage />;
  }

  return <IsolatedVoterPage showAdminFooter={routeMode === 'landing'} />;
}
