import type {
  AdminCeremonyState,
  Category,
  PublicCeremonyState,
  StageMode,
  VoterVoteMap,
} from '../types';

interface LocalVote {
  id: string;
  categoryId: string;
  nomineeId: string;
  voterId: string;
  voterName: string;
  createdAt: number;
}

interface LocalVoter {
  voterId: string;
  voterName: string;
  joinedAt: number;
}

interface LocalStore {
  ceremonyTitle: string;
  ceremonySubtitle: string;
  stageMode: StageMode;
  activeCategoryId: string | null;
  showLiveTalliesOnScreen: boolean;
  categories: Category[];
  votes: LocalVote[];
  voters: Record<string, LocalVoter>;
  adminPasscode: string | null;
}

const LOCAL_STORE_KEY = 'gala_familiar_static_store_v1';
const LOCAL_VOTER_KEY = 'gala_familiar_static_voter_id';
const CHANNEL_NAME = 'gala_familiar_local_sync';

function defaultCategories(): Category[] {
  return [
    {
      id: 'cat-chef',
      title: 'Mejor Chef de la Familia',
      description: 'Quien siempre sorprende en la mesa y nos reúne alrededor de sus platillos.',
      order: 0,
      isVotingOpen: true,
      isWinnerRevealed: false,
      nominees: [
        { id: 'nom-chef-1', name: 'Abuela Rosa', subtitle: 'Por sus recetas tradicionales de domingo', accentColor: '#D97706' },
        { id: 'nom-chef-2', name: 'Tío Carlos', subtitle: 'Maestro indiscutible del asador', accentColor: '#0F766E' },
        { id: 'nom-chef-3', name: 'Prima Valeria', subtitle: 'Repostería creativa y postres memorables', accentColor: '#BE123C' },
        { id: 'nom-chef-4', name: 'Papá Jorge', subtitle: 'Desayunos de fin de semana sin falta', accentColor: '#1D4ED8' },
      ],
    },
    {
      id: 'cat-alma',
      title: 'Alma de la Fiesta',
      description: 'La persona que enciende la música, anima la pista y contagia alegría en cada reunión.',
      order: 1,
      isVotingOpen: false,
      isWinnerRevealed: false,
      nominees: [
        { id: 'nom-alma-1', name: 'Primo Mateo', subtitle: 'DJ oficial y rey de las dinámicas', accentColor: '#4338CA' },
        { id: 'nom-alma-2', name: 'Tía Sofía', subtitle: 'La primera en abrir la pista de baile', accentColor: '#BE123C' },
        { id: 'nom-alma-3', name: 'Hermano Lucas', subtitle: 'Siempre llega con juegos y ocurrencias', accentColor: '#0F766E' },
      ],
    },
    {
      id: 'cat-anecdota',
      title: 'Mejor Anécdota del Año',
      description: 'Ese momento inolvidable que terminamos contando una y otra vez entre risas.',
      order: 2,
      isVotingOpen: false,
      isWinnerRevealed: false,
      nominees: [
        { id: 'nom-anec-1', name: 'El viaje en carretera', subtitle: 'Cuando tomamos la ruta equivocada y descubrimos el mirador', accentColor: '#D97706' },
        { id: 'nom-anec-2', name: 'La cena de Navidad', subtitle: 'El intercambio secreto de regalos repetidos', accentColor: '#1D4ED8' },
        { id: 'nom-anec-3', name: 'El apagón del domingo', subtitle: 'Lotería a la luz de las velas hasta medianoche', accentColor: '#0F766E' },
      ],
    },
    {
      id: 'cat-consejo',
      title: 'Premio al Mejor Consejo',
      description: 'Para quien siempre tiene una palabra sabia, escucha con paciencia y acompaña en todo momento.',
      order: 3,
      isVotingOpen: false,
      isWinnerRevealed: false,
      nominees: [
        { id: 'nom-cons-1', name: 'Mamá Elena', subtitle: 'Guía incondicional en cada decisión', accentColor: '#BE123C' },
        { id: 'nom-cons-2', name: 'Abuelo Antonio', subtitle: 'Historias que siempre dejan enseñanza', accentColor: '#B45309' },
        { id: 'nom-cons-3', name: 'Tía Lucía', subtitle: 'Calma y claridad cuando más se necesita', accentColor: '#4338CA' },
      ],
    },
  ];
}

function getLocalStore(): LocalStore {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORE_KEY);
    if (raw) {
      return JSON.parse(raw) as LocalStore;
    }
  } catch {
    // Ignore parse error
  }
  const initial: LocalStore = {
    ceremonyTitle: 'Premios Familiares 2026',
    ceremonySubtitle: 'Gala anual de reconocimientos en vivo',
    stageMode: 'lobby',
    activeCategoryId: 'cat-chef',
    showLiveTalliesOnScreen: true,
    categories: defaultCategories(),
    votes: [],
    voters: {},
    adminPasscode: null,
  };
  saveLocalStore(initial);
  return initial;
}

function saveLocalStore(store: LocalStore): void {
  try {
    window.localStorage.setItem(LOCAL_STORE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage error
  }
  try {
    const bc = new BroadcastChannel(CHANNEL_NAME);
    bc.postMessage({ type: 'sync' });
    bc.close();
  } catch {
    // Ignore BroadcastChannel error
  }
}

export function subscribeLocalSync(onUpdate: () => void): () => void {
  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(CHANNEL_NAME);
    bc.onmessage = () => onUpdate();
  } catch {
    // Ignore
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === LOCAL_STORE_KEY) onUpdate();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    if (bc) bc.close();
    window.removeEventListener('storage', onStorage);
  };
}

export function getLocalPublicState(audience: 'screen' | 'voter'): PublicCeremonyState {
  const store = getLocalStore();
  const sorted = [...store.categories].sort((a, b) => a.order - b.order);
  const categories = sorted.map((cat) => {
    const counts: Record<string, number> = {};
    for (const nom of cat.nominees) counts[nom.id] = 0;
    let totalVotes = 0;
    for (const v of store.votes) {
      if (v.categoryId === cat.id && v.nomineeId in counts) {
        counts[v.nomineeId] += 1;
        totalVotes += 1;
      }
    }
    const reveal =
      cat.isWinnerRevealed ||
      (audience === 'screen' &&
        (store.showLiveTalliesOnScreen ||
          (store.stageMode === 'winner' && store.activeCategoryId === cat.id) ||
          store.stageMode === 'summary'));

    return {
      id: cat.id,
      title: cat.title,
      description: cat.description,
      order: cat.order,
      isVotingOpen: cat.isVotingOpen,
      isWinnerRevealed: cat.isWinnerRevealed,
      totalVotes,
      nominees: cat.nominees.map((nom) => {
        const count = counts[nom.id] ?? 0;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 1000) / 10 : 0;
        return {
          ...nom,
          votes: reveal ? count : null,
          percentage: reveal ? pct : null,
        };
      }),
    };
  });

  return {
    ceremonyTitle: store.ceremonyTitle,
    ceremonySubtitle: store.ceremonySubtitle,
    stageMode: store.stageMode,
    activeCategoryId: store.activeCategoryId,
    showLiveTalliesOnScreen: store.showLiveTalliesOnScreen,
    connectedVotersCount: Object.keys(store.voters).length,
    registeredVotersCount: Object.keys(store.voters).length,
    totalVotesCast: store.votes.length,
    categories,
    updatedAt: Date.now(),
  };
}

export function getLocalAdminState(): AdminCeremonyState {
  const store = getLocalStore();
  const sorted = [...store.categories].sort((a, b) => a.order - b.order);
  const categories = sorted.map((cat) => {
    const counts: Record<string, number> = {};
    for (const nom of cat.nominees) counts[nom.id] = 0;
    let totalVotes = 0;
    for (const v of store.votes) {
      if (v.categoryId === cat.id && v.nomineeId in counts) {
        counts[v.nomineeId] += 1;
        totalVotes += 1;
      }
    }
    return {
      ...cat,
      totalVotes,
      nominees: cat.nominees.map((nom) => {
        const count = counts[nom.id] ?? 0;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 1000) / 10 : 0;
        return { ...nom, votes: count, percentage: pct };
      }),
    };
  });

  const voters = Object.values(store.voters).map((v) => {
    const myVotes = store.votes.filter((vt) => vt.voterId === v.voterId);
    const lastVotedAt = myVotes.reduce<number | null>(
      (max, vt) => (!max || vt.createdAt > max ? vt.createdAt : max),
      null
    );
    return {
      voterId: v.voterId,
      voterName: v.voterName,
      votesCount: myVotes.length,
      joinedAt: v.joinedAt,
      lastVotedAt,
    };
  });

  return {
    ceremonyTitle: store.ceremonyTitle,
    ceremonySubtitle: store.ceremonySubtitle,
    stageMode: store.stageMode,
    activeCategoryId: store.activeCategoryId,
    showLiveTalliesOnScreen: store.showLiveTalliesOnScreen,
    connectedVotersCount: voters.length,
    connectedScreensCount: 1,
    registeredVotersCount: voters.length,
    totalVotesCast: store.votes.length,
    categories,
    voters,
    timeline: [],
    updatedAt: Date.now(),
  };
}

export function localAdminStatus(): { setupRequired: boolean; authenticated: boolean } {
  const store = getLocalStore();
  return { setupRequired: !store.adminPasscode, authenticated: false };
}

export function localAdminAuth(mode: 'claim' | 'login', passcode: string): { token?: string; error?: string } {
  const store = getLocalStore();
  if (mode === 'claim') {
    if (store.adminPasscode) return { error: 'La clave ya fue configurada.' };
    store.adminPasscode = passcode;
    saveLocalStore(store);
    return { token: 'local-admin-session' };
  }
  if (store.adminPasscode !== passcode) {
    return { error: 'Clave incorrecta.' };
  }
  return { token: 'local-admin-session' };
}

export function localAdminMutate(path: string, method: string, body: Record<string, unknown>): AdminCeremonyState {
  const store = getLocalStore();
  if (path === '/api/admin/ceremony' && method === 'PUT') {
    if (typeof body.ceremonyTitle === 'string' && body.ceremonyTitle.trim()) {
      store.ceremonyTitle = body.ceremonyTitle.trim();
    }
    if (typeof body.ceremonySubtitle === 'string') {
      store.ceremonySubtitle = body.ceremonySubtitle.trim();
    }
    if (typeof body.stageMode === 'string') {
      store.stageMode = body.stageMode as StageMode;
      if (store.stageMode === 'winner' && store.activeCategoryId) {
        const cat = store.categories.find((c) => c.id === store.activeCategoryId);
        if (cat) {
          cat.isWinnerRevealed = true;
          cat.isVotingOpen = false;
        }
      }
      if (store.stageMode === 'closed' && store.activeCategoryId) {
        const cat = store.categories.find((c) => c.id === store.activeCategoryId);
        if (cat) cat.isVotingOpen = false;
      }
    }
    if (body.activeCategoryId !== undefined) {
      store.activeCategoryId = (body.activeCategoryId as string | null) ?? null;
    }
    if (typeof body.showLiveTalliesOnScreen === 'boolean') {
      store.showLiveTalliesOnScreen = body.showLiveTalliesOnScreen;
    }
  } else if (path === '/api/admin/categories' && method === 'POST') {
    const rawNominees = Array.isArray(body.nominees) ? body.nominees : [];
    const maxOrder = store.categories.reduce((m, c) => Math.max(m, c.order), -1);
    const newCat: Category = {
      id: `cat-${Math.random().toString(36).slice(2, 10)}`,
      title: String(body.title || '').trim(),
      description: String(body.description || '').trim(),
      order: maxOrder + 1,
      isVotingOpen: false,
      isWinnerRevealed: false,
      nominees: rawNominees.map((n: { name: string; subtitle?: string; accentColor?: string }, i: number) => ({
        id: `nom-${Math.random().toString(36).slice(2, 10)}`,
        name: n.name.trim(),
        subtitle: (n.subtitle || '').trim(),
        accentColor: n.accentColor || ['#D97706', '#0F766E', '#BE123C', '#1D4ED8'][i % 4],
      })),
    };
    store.categories.push(newCat);
    if (!store.activeCategoryId) store.activeCategoryId = newCat.id;
  } else if (path === '/api/admin/categories/reorder' && method === 'POST') {
    const orderedIds = Array.isArray(body.orderedIds) ? (body.orderedIds as string[]) : [];
    orderedIds.forEach((id, idx) => {
      const cat = store.categories.find((c) => c.id === id);
      if (cat) cat.order = idx;
    });
  } else if (path.startsWith('/api/admin/categories/') && method === 'PUT') {
    const id = path.split('/').pop();
    const cat = store.categories.find((c) => c.id === id);
    if (cat) {
      if (typeof body.title === 'string') cat.title = body.title.trim();
      if (typeof body.description === 'string') cat.description = body.description.trim();
      if (typeof body.isVotingOpen === 'boolean') cat.isVotingOpen = body.isVotingOpen;
      if (typeof body.isWinnerRevealed === 'boolean') cat.isWinnerRevealed = body.isWinnerRevealed;
      if (Array.isArray(body.nominees)) {
        cat.nominees = body.nominees.map((n: { id?: string; name: string; subtitle?: string; accentColor?: string }, i: number) => ({
          id: n.id || `nom-${Math.random().toString(36).slice(2, 10)}`,
          name: n.name.trim(),
          subtitle: (n.subtitle || '').trim(),
          accentColor: n.accentColor || ['#D97706', '#0F766E', '#BE123C', '#1D4ED8'][i % 4],
        }));
      }
    }
  } else if (path.startsWith('/api/admin/categories/') && method === 'DELETE') {
    const id = path.split('/').pop();
    store.categories = store.categories.filter((c) => c.id !== id);
    store.votes = store.votes.filter((v) => v.categoryId !== id);
    if (store.activeCategoryId === id) {
      store.activeCategoryId = store.categories[0]?.id ?? null;
    }
  } else if (path === '/api/admin/voting/bulk' && method === 'POST') {
    const open = body.action === 'open-all';
    store.categories.forEach((c) => {
      c.isVotingOpen = open;
    });
  } else if (path === '/api/admin/reset-votes' && method === 'POST') {
    const catId = typeof body.categoryId === 'string' ? body.categoryId : null;
    if (catId) {
      store.votes = store.votes.filter((v) => v.categoryId !== catId);
      const cat = store.categories.find((c) => c.id === catId);
      if (cat) cat.isWinnerRevealed = false;
    } else {
      store.votes = [];
      store.categories.forEach((c) => {
        c.isWinnerRevealed = false;
      });
    }
  }

  saveLocalStore(store);
  return getLocalAdminState();
}

export function getLocalVoterSession(): {
  registered: boolean;
  voterName?: string;
  voterToken?: string;
  myVotes?: VoterVoteMap;
} {
  const store = getLocalStore();
  let voterId: string | null = null;
  try {
    voterId = window.localStorage.getItem(LOCAL_VOTER_KEY);
  } catch {
    return { registered: false };
  }
  if (!voterId || !store.voters[voterId]) return { registered: false };
  const myVotes: VoterVoteMap = {};
  for (const v of store.votes) {
    if (v.voterId === voterId) myVotes[v.categoryId] = v.nomineeId;
  }
  return {
    registered: true,
    voterName: store.voters[voterId].voterName,
    voterToken: voterId,
    myVotes,
  };
}

export function registerLocalVoter(name: string): {
  voterName: string;
  voterToken: string;
  myVotes: VoterVoteMap;
} {
  const store = getLocalStore();
  let voterId: string | null = null;
  try {
    voterId = window.localStorage.getItem(LOCAL_VOTER_KEY);
  } catch {
    voterId = null;
  }
  if (!voterId) {
    voterId = `local-voter-${Math.random().toString(36).slice(2, 10)}`;
    try {
      window.localStorage.setItem(LOCAL_VOTER_KEY, voterId);
    } catch {
      // Ignore
    }
  }
  store.voters[voterId] = {
    voterId,
    voterName: name.trim(),
    joinedAt: store.voters[voterId]?.joinedAt ?? Date.now(),
  };
  saveLocalStore(store);
  const myVotes: VoterVoteMap = {};
  for (const v of store.votes) {
    if (v.voterId === voterId) myVotes[v.categoryId] = v.nomineeId;
  }
  return { voterName: name.trim(), voterToken: voterId, myVotes };
}

export function castLocalVote(
  categoryId: string,
  nomineeId: string
): { error?: string; myVotes?: VoterVoteMap } {
  const store = getLocalStore();
  let voterId: string | null = null;
  try {
    voterId = window.localStorage.getItem(LOCAL_VOTER_KEY);
  } catch {
    voterId = null;
  }
  if (!voterId || !store.voters[voterId]) {
    return { error: 'Registra tu nombre antes de votar.' };
  }
  const cat = store.categories.find((c) => c.id === categoryId);
  if (!cat || !cat.isVotingOpen) {
    return { error: 'La votación para esta categoría está cerrada.' };
  }
  if (store.votes.some((v) => v.categoryId === categoryId && v.voterId === voterId)) {
    return { error: 'Ya emitiste tu voto en esta categoría.' };
  }
  store.votes.push({
    id: `vote-${Math.random().toString(36).slice(2, 10)}`,
    categoryId,
    nomineeId,
    voterId,
    voterName: store.voters[voterId].voterName,
    createdAt: Date.now(),
  });
  saveLocalStore(store);
  const myVotes: VoterVoteMap = {};
  for (const v of store.votes) {
    if (v.voterId === voterId) myVotes[v.categoryId] = v.nomineeId;
  }
  return { myVotes };
}
