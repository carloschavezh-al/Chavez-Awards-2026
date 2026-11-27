import { useEffect, useMemo, useState } from 'react';
import AdminConsole from './components/AdminConsole';
import PublicScreenView from './components/PublicScreenView';
import VoterView from './components/VoterView';
import { subscribePublicAudienceFirestore } from './lib/firestoreCeremony';
import { buildViewUrl, resolveRouteMode } from './lib/routes';
import type { PublicCeremonyState } from './types';

function IsolatedPublicScreenPage() {
  const [state, setState] = useState<PublicCeremonyState | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribePublicAudienceFirestore('screen', (nextState) => {
      setState(nextState);
      setConnected(true);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return <PublicScreenView state={state} connected={connected} />;
}

function IsolatedVoterPage({ showAdminFooter }: { showAdminFooter: boolean }) {
  const [state, setState] = useState<PublicCeremonyState | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribePublicAudienceFirestore('voter', (nextState) => {
      setState(nextState);
      setConnected(true);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const adminHref = useMemo(
    () => (showAdminFooter ? buildViewUrl('admin') : undefined),
    [showAdminFooter]
  );

  return (
    <VoterView
      state={state}
      connected={connected}
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
