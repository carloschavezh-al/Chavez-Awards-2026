import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import type {
  AdminCategoryState,
  AdminCeremonyState,
  Nominee,
  PublicCategoryState,
  PublicCeremonyState,
  StageMode,
  VoteTimelinePoint,
  VoterSummary,
} from '../types';

export const AUTHORIZED_ADMIN_EMAIL = 'carloschavezh@outlook.com';
export const DEFAULT_CEREMONY_TITLE = 'Chavez Awards 2026';

function resolveCeremonyTitle(title?: string | null): string {
  if (!title || title === 'Premios Familiares 2026') {
    return DEFAULT_CEREMONY_TITLE;
  }
  return title;
}

const ACCENT_PALETTE = ['#D97706', '#0F766E', '#B45309', '#1D4ED8', '#BE123C', '#4338CA'];

export interface FirestoreCeremonyDoc {
  ceremonyTitle: string;
  ceremonySubtitle: string;
  stageMode: StageMode;
  activeCategoryId: string | null;
  updatedAt?: Timestamp;
}

export interface FirestoreCategoryDoc {
  title: string;
  description: string;
  order: number;
  isVotingOpen: boolean;
  isWinnerRevealed: boolean;
  nominees: Nominee[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface FirestoreResultDoc {
  categoryId: string;
  categoryTitle: string;
  isRevealed: boolean;
  totalVotes: number;
  breakdown: Array<Nominee & { votes: number; percentage: number }>;
  updatedAt?: Timestamp;
}

export interface FirestoreVoteDoc {
  categoryId: string;
  nomineeId: string;
  voterId: string;
  voterName: string;
  createdAt?: Timestamp;
}

export interface FirestoreVoterDoc {
  voterId: string;
  voterName: string;
  joinedAt?: Timestamp;
}

export function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128);
}

export function generateSafeId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${random}`;
}

function getDefaultCategoriesSeed(): Array<{ id: string } & Omit<FirestoreCategoryDoc, 'createdAt' | 'updatedAt'>> {
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

export async function checkIsAuthorizedAdmin(uid: string, email: string | null | undefined, emailVerified: boolean): Promise<boolean> {
  if (email === AUTHORIZED_ADMIN_EMAIL && emailVerified) return true;
  try {
    const adminSnap = await getDoc(doc(db, 'admins', uid));
    return adminSnap.exists();
  } catch {
    return false;
  }
}

export async function ensureInitialCeremonySeeded(): Promise<void> {
  const ceremonyRef = doc(db, 'ceremony', 'main');
  try {
    const existing = await getDoc(ceremonyRef);
    if (existing.exists()) {
      const data = existing.data() as Partial<FirestoreCeremonyDoc>;
      if (data.ceremonyTitle === 'Premios Familiares 2026') {
        await updateDoc(ceremonyRef, {
          ceremonyTitle: DEFAULT_CEREMONY_TITLE,
          updatedAt: serverTimestamp(),
        });
      }
      return;
    }

    const batch = writeBatch(db);
    const seedCats = getDefaultCategoriesSeed();
    batch.set(ceremonyRef, {
      ceremonyTitle: DEFAULT_CEREMONY_TITLE,
      ceremonySubtitle: 'Gala anual de reconocimientos en vivo',
      stageMode: 'lobby',
      activeCategoryId: seedCats[0].id,
      updatedAt: serverTimestamp(),
    });
    for (const cat of seedCats) {
      batch.set(doc(db, 'categories', cat.id), {
        title: cat.title,
        description: cat.description,
        order: cat.order,
        isVotingOpen: cat.isVotingOpen,
        isWinnerRevealed: cat.isWinnerRevealed,
        nominees: cat.nominees,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'ceremony/main');
  }
}

export async function updateCeremonyInFirestore(
  patch: Partial<Pick<FirestoreCeremonyDoc, 'ceremonyTitle' | 'ceremonySubtitle' | 'stageMode' | 'activeCategoryId'>>,
  currentState: AdminCeremonyState
): Promise<void> {
  const ceremonyRef = doc(db, 'ceremony', 'main');
  const nextTitle = (patch.ceremonyTitle ?? currentState.ceremonyTitle).trim().slice(0, 80);
  const nextSubtitle = (patch.ceremonySubtitle ?? currentState.ceremonySubtitle).trim().slice(0, 140);
  const nextStageMode = patch.stageMode ?? currentState.stageMode;
  const nextActiveId =
    patch.activeCategoryId !== undefined ? patch.activeCategoryId : currentState.activeCategoryId;

  try {
    const batch = writeBatch(db);
    batch.set(
      ceremonyRef,
      {
        ceremonyTitle: nextTitle || DEFAULT_CEREMONY_TITLE,
        ceremonySubtitle: nextSubtitle,
        stageMode: nextStageMode,
        activeCategoryId: nextActiveId,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (nextActiveId) {
      const activeCat = currentState.categories.find((c) => c.id === nextActiveId);
      if (activeCat) {
        if (nextStageMode === 'winner') {
          batch.update(doc(db, 'categories', activeCat.id), {
            isVotingOpen: false,
            isWinnerRevealed: true,
            updatedAt: serverTimestamp(),
          });
          const sortedBreakdown = [...activeCat.nominees]
            .sort((a, b) => b.votes - a.votes)
            .map((n) => ({
              id: n.id,
              name: n.name,
              subtitle: n.subtitle,
              accentColor: n.accentColor,
              votes: n.votes,
              percentage: n.percentage,
            }));
          batch.set(doc(db, 'results', activeCat.id), {
            categoryId: activeCat.id,
            categoryTitle: activeCat.title,
            isRevealed: true,
            totalVotes: activeCat.totalVotes,
            breakdown: sortedBreakdown,
            updatedAt: serverTimestamp(),
          });
        } else if (nextStageMode === 'closed') {
          batch.update(doc(db, 'categories', activeCat.id), {
            isVotingOpen: false,
            updatedAt: serverTimestamp(),
          });
        }
      }
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'ceremony/main');
  }
}

export async function createCategoryInFirestore(input: {
  title: string;
  description: string;
  order: number;
  nominees: Array<{ name: string; subtitle?: string; accentColor?: string }>;
}): Promise<string> {
  const id = generateSafeId('cat');
  const cleanTitle = input.title.trim().slice(0, 80);
  const cleanDesc = input.description.trim().slice(0, 220);
  const nominees: Nominee[] = input.nominees
    .filter((n) => n.name.trim().length > 0)
    .slice(0, 20)
    .map((n, idx) => ({
      id: generateSafeId('nom'),
      name: n.name.trim().slice(0, 60),
      subtitle: (n.subtitle || '').trim().slice(0, 120),
      accentColor:
        n.accentColor && /^#[0-9A-Fa-f]{6}$/.test(n.accentColor)
          ? n.accentColor
          : ACCENT_PALETTE[idx % ACCENT_PALETTE.length],
    }));

  try {
    await setDoc(doc(db, 'categories', id), {
      title: cleanTitle,
      description: cleanDesc,
      order: input.order,
      isVotingOpen: false,
      isWinnerRevealed: false,
      nominees,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `categories/${id}`);
  }
}

export async function updateCategoryInFirestore(
  categoryId: string,
  patch: {
    title?: string;
    description?: string;
    isVotingOpen?: boolean;
    isWinnerRevealed?: boolean;
    nominees?: Array<{ id?: string; name: string; subtitle?: string; accentColor?: string }>;
  }
): Promise<void> {
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (typeof patch.title === 'string') {
    payload.title = patch.title.trim().slice(0, 80);
  }
  if (typeof patch.description === 'string') {
    payload.description = patch.description.trim().slice(0, 220);
  }
  if (typeof patch.isVotingOpen === 'boolean') {
    payload.isVotingOpen = patch.isVotingOpen;
  }
  if (typeof patch.isWinnerRevealed === 'boolean') {
    payload.isWinnerRevealed = patch.isWinnerRevealed;
  }
  if (Array.isArray(patch.nominees)) {
    payload.nominees = patch.nominees
      .filter((n) => n.name.trim().length > 0)
      .slice(0, 20)
      .map((n, idx) => ({
        id: n.id ? sanitizeId(n.id) : generateSafeId('nom'),
        name: n.name.trim().slice(0, 60),
        subtitle: (n.subtitle || '').trim().slice(0, 120),
        accentColor:
          n.accentColor && /^#[0-9A-Fa-f]{6}$/.test(n.accentColor)
            ? n.accentColor
            : ACCENT_PALETTE[idx % ACCENT_PALETTE.length],
      }));
  }

  try {
    await updateDoc(doc(db, 'categories', categoryId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `categories/${categoryId}`);
  }
}

export async function reorderCategoriesInFirestore(orderedIds: string[]): Promise<void> {
  try {
    const batch = writeBatch(db);
    orderedIds.forEach((id, idx) => {
      batch.update(doc(db, 'categories', id), {
        order: idx,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'categories/reorder');
  }
}

export async function deleteCategoryInFirestore(
  categoryId: string,
  nextActiveCategoryId: string | null
): Promise<void> {
  try {
    const votesSnap = await getDocs(
      query(collection(db, 'votes'), where('categoryId', '==', categoryId))
    );
    const batch = writeBatch(db);
    votesSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, 'categories', categoryId));
    batch.delete(doc(db, 'results', categoryId));
    batch.update(doc(db, 'ceremony', 'main'), {
      activeCategoryId: nextActiveCategoryId,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `categories/${categoryId}`);
  }
}

export async function setBulkVotingInFirestore(
  categoryIds: string[],
  isVotingOpen: boolean
): Promise<void> {
  try {
    const batch = writeBatch(db);
    for (const id of categoryIds) {
      batch.update(doc(db, 'categories', id), {
        isVotingOpen,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'categories/bulk');
  }
}

export async function resetVotesInFirestore(
  categoryId: string | null,
  allCategoryIds: string[]
): Promise<void> {
  try {
    const votesQuery = categoryId
      ? query(collection(db, 'votes'), where('categoryId', '==', categoryId))
      : collection(db, 'votes');
    const votesSnap = await getDocs(votesQuery);
    const batch = writeBatch(db);
    votesSnap.docs.forEach((d) => batch.delete(d.ref));
    const targetCats = categoryId ? [categoryId] : allCategoryIds;
    for (const id of targetCats) {
      batch.update(doc(db, 'categories', id), {
        isWinnerRevealed: false,
        updatedAt: serverTimestamp(),
      });
      batch.delete(doc(db, 'results', id));
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'votes');
  }
}

// Voter operations
export async function registerVoterInFirestore(
  voterId: string,
  voterName: string
): Promise<void> {
  const cleanId = sanitizeId(voterId);
  const cleanName = voterName.trim().slice(0, 50);
  const voterRef = doc(db, 'voters', cleanId);
  try {
    const snap = await getDoc(voterRef);
    if (snap.exists()) {
      await updateDoc(voterRef, { voterName: cleanName });
    } else {
      await setDoc(voterRef, {
        voterId: cleanId,
        voterName: cleanName,
        joinedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `voters/${cleanId}`);
  }
}

export async function fetchVoterProfileInFirestore(
  voterId: string
): Promise<{ voterName: string } | null> {
  const cleanId = sanitizeId(voterId);
  if (!cleanId) return null;
  try {
    const snap = await getDoc(doc(db, 'voters', cleanId));
    if (!snap.exists()) return null;
    const data = snap.data() as FirestoreVoterDoc;
    return { voterName: data.voterName };
  } catch {
    return null;
  }
}

export async function fetchVoterVoteForCategory(
  categoryId: string,
  voterId: string
): Promise<string | null> {
  const voteId = `${sanitizeId(categoryId)}__${sanitizeId(voterId)}`;
  try {
    const snap = await getDoc(doc(db, 'votes', voteId));
    if (!snap.exists()) return null;
    const data = snap.data() as FirestoreVoteDoc;
    return data.nomineeId;
  } catch {
    return null;
  }
}

export async function castVoteInFirestore(input: {
  categoryId: string;
  nomineeId: string;
  voterId: string;
  voterName: string;
}): Promise<void> {
  const categoryId = sanitizeId(input.categoryId);
  const nomineeId = sanitizeId(input.nomineeId);
  const voterId = sanitizeId(input.voterId);
  const voterName = input.voterName.trim().slice(0, 50);
  const voteId = `${categoryId}__${voterId}`;

  try {
    await setDoc(doc(db, 'votes', voteId), {
      categoryId,
      nomineeId,
      voterId,
      voterName,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `votes/${voteId}`);
  }
}

// Subscriptions
export function subscribeAdminFirestore(
  onData: (state: AdminCeremonyState) => void,
  onError: (err: unknown) => void
): () => void {
  let ceremonyDoc: FirestoreCeremonyDoc = {
    ceremonyTitle: DEFAULT_CEREMONY_TITLE,
    ceremonySubtitle: 'Gala anual de reconocimientos en vivo',
    stageMode: 'lobby',
    activeCategoryId: null,
  };
  let categoryDocs: Array<{ id: string } & FirestoreCategoryDoc> = [];
  let voterDocs: FirestoreVoterDoc[] = [];
  let voteDocs: FirestoreVoteDoc[] = [];

  const emit = () => {
    const sortedCats = [...categoryDocs].sort((a, b) => a.order - b.order);
    const categories: AdminCategoryState[] = sortedCats.map((cat) => {
      const counts: Record<string, number> = {};
      for (const nom of cat.nominees) counts[nom.id] = 0;
      let totalVotes = 0;
      for (const v of voteDocs) {
        if (v.categoryId === cat.id && v.nomineeId in counts) {
          counts[v.nomineeId] += 1;
          totalVotes += 1;
        }
      }
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
          return { ...nom, votes: count, percentage: pct };
        }),
      };
    });

    const voterStats: Record<string, { count: number; lastVotedAt: number | null }> = {};
    const timelineBuckets = new Map<number, number>();

    for (const v of voteDocs) {
      const ts = v.createdAt instanceof Timestamp ? v.createdAt.toMillis() : Date.now();
      if (!voterStats[v.voterId]) {
        voterStats[v.voterId] = { count: 0, lastVotedAt: null };
      }
      voterStats[v.voterId].count += 1;
      if (!voterStats[v.voterId].lastVotedAt || ts > voterStats[v.voterId].lastVotedAt!) {
        voterStats[v.voterId].lastVotedAt = ts;
      }

      const minuteTs = Math.floor(ts / 60000) * 60000;
      timelineBuckets.set(minuteTs, (timelineBuckets.get(minuteTs) ?? 0) + 1);
    }

    const voters: VoterSummary[] = voterDocs
      .map((v) => ({
        voterId: v.voterId,
        voterName: v.voterName,
        votesCount: voterStats[v.voterId]?.count ?? 0,
        joinedAt: v.joinedAt instanceof Timestamp ? v.joinedAt.toMillis() : Date.now(),
        lastVotedAt: voterStats[v.voterId]?.lastVotedAt ?? null,
      }))
      .sort((a, b) => b.joinedAt - a.joinedAt);

    const timeline: VoteTimelinePoint[] = Array.from(timelineBuckets.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(-20)
      .map(([ts, count]) => {
        const d = new Date(ts);
        return {
          minuteLabel: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
          timestamp: ts,
          count,
        };
      });

    onData({
      ceremonyTitle: resolveCeremonyTitle(ceremonyDoc.ceremonyTitle),
      ceremonySubtitle: ceremonyDoc.ceremonySubtitle,
      stageMode: ceremonyDoc.stageMode,
      activeCategoryId: ceremonyDoc.activeCategoryId ?? sortedCats[0]?.id ?? null,
      showLiveTalliesOnScreen: false,
      connectedVotersCount: voters.length,
      connectedScreensCount: 1,
      registeredVotersCount: voters.length,
      totalVotesCast: voteDocs.length,
      categories,
      voters,
      timeline,
      updatedAt: Date.now(),
    });
  };

  const unsubCeremony = onSnapshot(
    doc(db, 'ceremony', 'main'),
    (snap) => {
      if (snap.exists()) {
        ceremonyDoc = snap.data() as FirestoreCeremonyDoc;
      }
      emit();
    },
    (err) => {
      onError(err);
      handleFirestoreError(err, OperationType.GET, 'ceremony/main');
    }
  );

  const unsubCategories = onSnapshot(
    collection(db, 'categories'),
    (snap) => {
      categoryDocs = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as FirestoreCategoryDoc),
      }));
      emit();
    },
    (err) => {
      onError(err);
      handleFirestoreError(err, OperationType.LIST, 'categories');
    }
  );

  const unsubVoters = onSnapshot(
    collection(db, 'voters'),
    (snap) => {
      voterDocs = snap.docs.map((d) => d.data() as FirestoreVoterDoc);
      emit();
    },
    (err) => {
      onError(err);
      handleFirestoreError(err, OperationType.LIST, 'voters');
    }
  );

  const unsubVotes = onSnapshot(
    collection(db, 'votes'),
    (snap) => {
      voteDocs = snap.docs.map((d) => d.data() as FirestoreVoteDoc);
      emit();
    },
    (err) => {
      onError(err);
      handleFirestoreError(err, OperationType.LIST, 'votes');
    }
  );

  return () => {
    unsubCeremony();
    unsubCategories();
    unsubVoters();
    unsubVotes();
  };
}

export function subscribePublicAudienceFirestore(
  audience: 'screen' | 'voter',
  onData: (state: PublicCeremonyState) => void
): () => void {
  let ceremonyDoc: FirestoreCeremonyDoc | null = null;
  let activeCatDoc: ({ id: string } & FirestoreCategoryDoc) | null = null;
  let activeResultDoc: FirestoreResultDoc | null = null;
  let summaryResults: FirestoreResultDoc[] = [];

  let unsubActiveCat: (() => void) | null = null;
  let unsubActiveResult: (() => void) | null = null;
  let unsubSummary: (() => void) | null = null;
  let subscribedCatId: string | null = null;
  let subscribedSummary = false;

  const emit = () => {
    if (!ceremonyDoc) {
      onData({
        ceremonyTitle: DEFAULT_CEREMONY_TITLE,
        ceremonySubtitle: 'Gala anual de reconocimientos en vivo',
        stageMode: 'lobby',
        activeCategoryId: null,
        showLiveTalliesOnScreen: false,
        connectedVotersCount: 0,
        registeredVotersCount: 0,
        totalVotesCast: 0,
        categories: [],
        updatedAt: Date.now(),
      });
      return;
    }

    const categories: PublicCategoryState[] = [];

    if (audience === 'screen' && ceremonyDoc.stageMode === 'summary') {
      summaryResults.forEach((res, idx) => {
        categories.push({
          id: res.categoryId,
          title: res.categoryTitle,
          description: '',
          order: idx,
          isVotingOpen: false,
          isWinnerRevealed: true,
          totalVotes: res.totalVotes,
          nominees: res.breakdown.map((b) => ({
            id: b.id,
            name: b.name,
            subtitle: b.subtitle,
            accentColor: b.accentColor,
            votes: b.votes,
            percentage: b.percentage,
          })),
        });
      });
    } else if (activeCatDoc) {
      const revealed = Boolean(activeCatDoc.isWinnerRevealed && activeResultDoc?.isRevealed);
      const breakdownMap = new Map(
        (activeResultDoc?.breakdown || []).map((b) => [b.id, b])
      );

      categories.push({
        id: activeCatDoc.id,
        title: activeCatDoc.title,
        description: activeCatDoc.description,
        order: activeCatDoc.order,
        isVotingOpen: activeCatDoc.isVotingOpen,
        isWinnerRevealed: activeCatDoc.isWinnerRevealed,
        totalVotes: revealed ? activeResultDoc?.totalVotes ?? 0 : 0,
        nominees: activeCatDoc.nominees.map((nom) => {
          const res = breakdownMap.get(nom.id);
          return {
            ...nom,
            votes: revealed && res ? res.votes : null,
            percentage: revealed && res ? res.percentage : null,
          };
        }),
      });
    }

    onData({
      ceremonyTitle: resolveCeremonyTitle(ceremonyDoc.ceremonyTitle),
      ceremonySubtitle: ceremonyDoc.ceremonySubtitle,
      stageMode: ceremonyDoc.stageMode,
      activeCategoryId: ceremonyDoc.activeCategoryId,
      showLiveTalliesOnScreen: false,
      connectedVotersCount: 0,
      registeredVotersCount: 0,
      totalVotesCast: 0,
      categories,
      updatedAt: Date.now(),
    });
  };

  const syncActiveListeners = (catId: string | null, stageMode: StageMode) => {
    if (catId !== subscribedCatId) {
      if (unsubActiveCat) {
        unsubActiveCat();
        unsubActiveCat = null;
      }
      if (unsubActiveResult) {
        unsubActiveResult();
        unsubActiveResult = null;
      }
      activeCatDoc = null;
      activeResultDoc = null;
      subscribedCatId = catId;

      if (catId) {
        unsubActiveCat = onSnapshot(
          doc(db, 'categories', catId),
          (snap) => {
            activeCatDoc = snap.exists()
              ? { id: snap.id, ...(snap.data() as FirestoreCategoryDoc) }
              : null;
            if (activeCatDoc?.isWinnerRevealed && !unsubActiveResult) {
              unsubActiveResult = onSnapshot(
                doc(db, 'results', catId),
                (resSnap) => {
                  activeResultDoc = resSnap.exists()
                    ? (resSnap.data() as FirestoreResultDoc)
                    : null;
                  emit();
                },
                () => {
                  activeResultDoc = null;
                  emit();
                }
              );
            } else if (!activeCatDoc?.isWinnerRevealed && unsubActiveResult) {
              unsubActiveResult();
              unsubActiveResult = null;
              activeResultDoc = null;
            }
            emit();
          },
          (err) => {
            handleFirestoreError(err, OperationType.GET, `categories/${catId}`);
          }
        );
      } else {
        emit();
      }
    }

    if (audience === 'screen' && stageMode === 'summary' && !subscribedSummary) {
      subscribedSummary = true;
      unsubSummary = onSnapshot(
        query(collection(db, 'results'), where('isRevealed', '==', true)),
        (snap) => {
          summaryResults = snap.docs.map((d) => d.data() as FirestoreResultDoc);
          emit();
        },
        (err) => {
          handleFirestoreError(err, OperationType.LIST, 'results');
        }
      );
    } else if ((audience !== 'screen' || stageMode !== 'summary') && subscribedSummary) {
      subscribedSummary = false;
      if (unsubSummary) {
        unsubSummary();
        unsubSummary = null;
      }
      summaryResults = [];
    }
  };

  const unsubCeremony = onSnapshot(
    doc(db, 'ceremony', 'main'),
    (snap) => {
      ceremonyDoc = snap.exists() ? (snap.data() as FirestoreCeremonyDoc) : null;
      syncActiveListeners(
        ceremonyDoc?.activeCategoryId ?? null,
        ceremonyDoc?.stageMode ?? 'lobby'
      );
      emit();
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, 'ceremony/main');
    }
  );

  return () => {
    unsubCeremony();
    if (unsubActiveCat) unsubActiveCat();
    if (unsubActiveResult) unsubActiveResult();
    if (unsubSummary) unsubSummary();
  };
}
