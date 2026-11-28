import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  ImagePlus,
  Lock,
  LogOut,
  Monitor,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Trophy,
  Unlock,
  X,
} from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import {
  AUTHORIZED_ADMIN_EMAIL,
  checkIsAuthorizedAdmin,
  createCategoryInFirestore,
  deleteCategoryInFirestore,
  ensureInitialCeremonySeeded,
  reorderCategoriesInFirestore,
  resetVotesInFirestore,
  setBulkVotingInFirestore,
  subscribeAdminFirestore,
  updateCategoryInFirestore,
  updateCeremonyInFirestore,
} from '../lib/firestoreCeremony';
import { compressNomineeImage } from '../lib/imageUpload';
import { buildViewUrl } from '../lib/routes';
import type { AdminCategoryState, AdminCeremonyState, PublicCeremonyState, StageMode } from '../types';
import NomineeAvatar from './NomineeAvatar';
import PublicScreenView from './PublicScreenView';
import ReportsView from './ReportsView';
import VoterView from './VoterView';

type AdminTab = 'live' | 'categories' | 'reports' | 'dual';

const ACCENT_SWATCHES = ['#D97706', '#0F766E', '#B45309', '#1D4ED8', '#BE123C', '#4338CA'];

interface NomineeDraft {
  id?: string;
  name: string;
  subtitle: string;
  accentColor: string;
  photoUrl?: string;
}

function derivePublicState(
  admin: AdminCeremonyState,
  audience: 'screen' | 'voter'
): PublicCeremonyState {
  const activeCat =
    admin.categories.find((c) => c.id === admin.activeCategoryId) ??
    admin.categories[0] ??
    null;

  let visibleCategories: AdminCategoryState[] = [];
  if (audience === 'screen' && admin.stageMode === 'summary') {
    visibleCategories = admin.categories.filter((c) => c.isWinnerRevealed);
  } else if (audience === 'voter') {
    if (admin.stageMode !== 'lobby' && admin.stageMode !== 'summary' && activeCat) {
      visibleCategories = [activeCat];
    }
  } else if (activeCat) {
    visibleCategories = [activeCat];
  }

  return {
    ceremonyTitle: admin.ceremonyTitle,
    ceremonySubtitle: admin.ceremonySubtitle,
    stageMode: admin.stageMode,
    activeCategoryId: admin.activeCategoryId,
    revealedNomineeIndex: admin.revealedNomineeIndex,
    showLiveTalliesOnScreen: false,
    connectedVotersCount: admin.connectedVotersCount,
    registeredVotersCount: admin.registeredVotersCount,
    totalVotesCast: admin.totalVotesCast,
    updatedAt: admin.updatedAt,
    categories: visibleCategories.map((cat) => {
      const shouldReveal =
        cat.isWinnerRevealed ||
        (audience === 'screen' &&
          ((admin.stageMode === 'winner' && activeCat?.id === cat.id) ||
            admin.stageMode === 'summary'));
      return {
        id: cat.id,
        title: cat.title,
        description: cat.description,
        order: cat.order,
        isVotingOpen: cat.isVotingOpen,
        isWinnerRevealed: cat.isWinnerRevealed,
        totalVotes: shouldReveal ? cat.totalVotes : 0,
        nominees: cat.nominees.map((nom) => ({
          ...nom,
          votes: shouldReveal ? nom.votes : null,
          percentage: shouldReveal ? nom.percentage : null,
        })),
      };
    }),
  };
}

export default function AdminConsole() {
  const [authStatusLoading, setAuthStatusLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthorizedAdmin, setIsAuthorizedAdmin] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [adminState, setAdminState] = useState<AdminCeremonyState | null>(null);
  const [connected, setConnected] = useState(false);

  const [activeTab, setActiveTab] = useState<AdminTab>('live');
  const [copiedKey, setCopiedKey] = useState<'vote' | 'screen' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Ceremony info editor state
  const [titleDraft, setTitleDraft] = useState('');
  const [subtitleDraft, setSubtitleDraft] = useState('');

  // Category editor modal/form state
  const [editingCategoryId, setEditingCategoryId] = useState<string | 'new' | null>(null);
  const [catTitleDraft, setCatTitleDraft] = useState('');
  const [catDescDraft, setCatDescDraft] = useState('');
  const [nomineesDraft, setNomineesDraft] = useState<NomineeDraft[]>([]);
  const [uploadingPhotoIdx, setUploadingPhotoIdx] = useState<number | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);

  // Confirmation dialog state (no window.confirm)
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  // Listen to Firebase Auth state
  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      if (!user) {
        setCurrentUser(null);
        setIsAuthorizedAdmin(false);
        setAdminState(null);
        setConnected(false);
        setAuthStatusLoading(false);
        return;
      }

      setCurrentUser(user);
      const authorized = await checkIsAuthorizedAdmin(
        user.uid,
        user.email,
        user.emailVerified
      );
      if (!active) return;

      if (authorized) {
        setIsAuthorizedAdmin(true);
        setAuthError(null);
      } else {
        setIsAuthorizedAdmin(false);
        setAdminState(null);
        setConnected(false);
        setAuthError(
          `La cuenta ${user.email || 'seleccionada'} no tiene permisos de organizador. Inicia sesión con ${AUTHORIZED_ADMIN_EMAIL}.`
        );
      }
      setAuthStatusLoading(false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Seed initial ceremony & subscribe to Firestore when authorized admin is logged in
  useEffect(() => {
    if (!currentUser || !isAuthorizedAdmin) return;
    let cancelled = false;
    let unsubscribeFirestore: (() => void) | null = null;

    const initAdminStream = async () => {
      try {
        await ensureInitialCeremonySeeded();
        if (cancelled) return;
        unsubscribeFirestore = subscribeAdminFirestore(
          (nextState) => {
            if (!cancelled) {
              setAdminState(nextState);
              setConnected(true);
            }
          },
          (err) => {
            if (!cancelled) {
              setConnected(false);
              setActionError(
                err instanceof Error
                  ? `Error al sincronizar con Firebase: ${err.message}`
                  : 'No se pudo sincronizar con la base de datos.'
              );
            }
          }
        );
      } catch (err) {
        if (!cancelled) {
          setActionError(
            err instanceof Error
              ? err.message
              : 'No se pudo inicializar la base de datos en Firebase.'
          );
        }
      }
    };

    void initAdminStream();

    return () => {
      cancelled = true;
      if (unsubscribeFirestore) unsubscribeFirestore();
    };
  }, [currentUser, isAuthorizedAdmin]);

  useEffect(() => {
    if (adminState) {
      setTitleDraft(adminState.ceremonyTitle);
      setSubtitleDraft(adminState.ceremonySubtitle);
    }
  }, [adminState?.ceremonyTitle, adminState?.ceremonySubtitle]);

  const voteUrl = useMemo(() => buildViewUrl('vote'), []);
  const screenUrl = useMemo(() => buildViewUrl('screen'), []);

  const showToast = (msg: string) => {
    setActionFeedback(msg);
    setActionError(null);
    window.setTimeout(() => {
      setActionFeedback((curr) => (curr === msg ? null : curr));
    }, 3000);
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('auth/popup-closed-by-user')) {
        setAuthError('Se cerró la ventana de inicio de sesión antes de completar el acceso.');
      } else if (message.includes('auth/unauthorized-domain')) {
        const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
        setAuthError(
          `El dominio "${currentHost}" aún no está autorizado en Firebase Authentication. Agrégalo en Firebase Console → Authentication → Settings → Authorized domains.`
        );
      } else {
        setAuthError('No se pudo iniciar sesión con Google. Intenta de nuevo.');
      }
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth).catch(() => {});
    setCurrentUser(null);
    setIsAuthorizedAdmin(false);
    setAdminState(null);
    setConnected(false);
    setAuthError(null);
  };

  const runAdminMutation = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setActionError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : 'Ocurrió un error al guardar los cambios en Firebase.'
      );
      return false;
    }
  };

  const updateCeremony = async (patch: {
    ceremonyTitle?: string;
    ceremonySubtitle?: string;
    stageMode?: StageMode;
    activeCategoryId?: string | null;
    revealedNomineeIndex?: number;
    openVotingOnActiveCategory?: boolean;
  }) => {
    if (!adminState) return false;
    return runAdminMutation(() => updateCeremonyInFirestore(patch, adminState));
  };

  const toggleCategoryVoting = async (cat: AdminCategoryState) => {
    const ok = await runAdminMutation(() =>
      updateCategoryInFirestore(cat.id, { isVotingOpen: !cat.isVotingOpen })
    );
    if (ok) {
      showToast(
        !cat.isVotingOpen
          ? `Votación abierta: ${cat.title}`
          : `Votación cerrada: ${cat.title}`
      );
    }
  };

  const handleBulkVoting = async (action: 'open-all' | 'close-all') => {
    if (!adminState) return;
    const ok = await runAdminMutation(() =>
      setBulkVotingInFirestore(
        adminState.categories.map((c) => c.id),
        action === 'open-all'
      )
    );
    if (ok) {
      showToast(
        action === 'open-all'
          ? 'Todas las votaciones han sido abiertas'
          : 'Todas las votaciones han sido cerradas'
      );
    }
  };

  const openNewCategoryEditor = () => {
    setEditingCategoryId('new');
    setCatTitleDraft('');
    setCatDescDraft('');
    setNomineesDraft([
      { name: '', subtitle: '', accentColor: ACCENT_SWATCHES[0], photoUrl: '' },
      { name: '', subtitle: '', accentColor: ACCENT_SWATCHES[1], photoUrl: '' },
    ]);
  };

  const openEditCategoryEditor = (cat: AdminCategoryState) => {
    setEditingCategoryId(cat.id);
    setCatTitleDraft(cat.title);
    setCatDescDraft(cat.description);
    setNomineesDraft(
      cat.nominees.map((n) => ({
        id: n.id,
        name: n.name,
        subtitle: n.subtitle,
        accentColor: n.accentColor || ACCENT_SWATCHES[0],
        photoUrl: n.photoUrl || '',
      }))
    );
  };

  const handleNomineePhotoUpload = async (index: number, file: File | null) => {
    if (!file) return;
    setUploadingPhotoIdx(index);
    setActionError(null);
    try {
      const compressedDataUrl = await compressNomineeImage(file);
      setNomineesDraft((prev) =>
        prev.map((item, idx) =>
          idx === index ? { ...item, photoUrl: compressedDataUrl } : item
        )
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'No se pudo cargar la foto del nominado.'
      );
    } finally {
      setUploadingPhotoIdx((curr) => (curr === index ? null : curr));
    }
  };

  const saveCategoryEditor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminState) return;
    const validNominees = nomineesDraft.filter((n) => n.name.trim().length > 0);
    if (!catTitleDraft.trim()) {
      setActionError('Escribe el nombre de la categoría.');
      return;
    }
    if (validNominees.length < 2) {
      setActionError('Agrega al menos 2 nominados con nombre.');
      return;
    }
    setSavingCategory(true);
    try {
      const ok = await runAdminMutation(async () => {
        if (editingCategoryId === 'new') {
          const createdId = await createCategoryInFirestore({
            title: catTitleDraft.trim(),
            description: catDescDraft.trim(),
            order: adminState.categories.length,
            nominees: validNominees,
          });
          if (!adminState.activeCategoryId) {
            await updateCeremonyInFirestore(
              { activeCategoryId: createdId },
              adminState
            );
          }
        } else if (editingCategoryId) {
          await updateCategoryInFirestore(editingCategoryId, {
            title: catTitleDraft.trim(),
            description: catDescDraft.trim(),
            nominees: validNominees,
          });
        }
      });
      if (ok) {
        setEditingCategoryId(null);
        showToast('Categoría guardada en Firebase');
      }
    } finally {
      setSavingCategory(false);
    }
  };

  const moveCategory = async (index: number, direction: -1 | 1) => {
    if (!adminState) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= adminState.categories.length) return;
    const ordered = [...adminState.categories];
    const [moved] = ordered.splice(index, 1);
    ordered.splice(targetIndex, 0, moved);
    await runAdminMutation(() =>
      reorderCategoriesInFirestore(ordered.map((c) => c.id))
    );
  };

  const copyToClipboard = async (text: string, key: 'vote' | 'screen') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Fallback ignored
    }
  };

  // Loading auth state
  if (authStatusLoading) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-6">
        <div className="w-9 h-9 rounded-full border-2 border-slate-300 border-t-slate-900 animate-spin" />
      </div>
    );
  }

  // Organizer Google Sign-In Gate
  if (!currentUser || !isAuthorizedAdmin) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] text-slate-900 flex flex-col justify-between p-6">
        <header className="max-w-5xl w-full mx-auto flex items-center justify-between py-2">
          <span className="font-display text-xl font-semibold text-slate-900">
            Gala Familiar
          </span>
          <a
            href={voteUrl}
            className="text-sm font-medium text-amber-800 hover:underline whitespace-nowrap"
          >
            Ir al panel de votación
          </a>
        </header>

        <main className="max-w-md w-full mx-auto bg-white border border-slate-200 rounded-2xl p-8 space-y-6 my-auto">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800">
              <ShieldCheck className="w-4 h-4" aria-hidden="true" />
              <span>Consola de Dirección</span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-slate-900 text-balance">
              Acceso del organizador
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Inicia sesión con tu cuenta autorizada de Google para crear categorías, dirigir la Pantalla Pública y guardar los votos en vivo en Firebase.
            </p>
          </div>

          {authError && (
            <div
              role="alert"
              className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs sm:text-sm font-medium text-rose-800 leading-relaxed"
            >
              {authError}
            </div>
          )}

          <div className="space-y-3">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={authSubmitting}
              className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2.5"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.9 9.1-9.3 0-.6-.1-1.1-.2-1.6H12z"
                />
              </svg>
              <span>
                {authSubmitting
                  ? 'Conectando con Google...'
                  : currentUser && !isAuthorizedAdmin
                  ? 'Cambiar de cuenta con Google'
                  : 'Continuar con Google'}
              </span>
            </button>

            {currentUser && !isAuthorizedAdmin && (
              <button
                type="button"
                onClick={handleLogout}
                className="w-full min-h-[40px] px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cerrar sesión ({currentUser.email})
              </button>
            )}
          </div>

          <div className="pt-4 border-t border-slate-100 text-center space-y-2">
            <p className="text-[11px] text-slate-500">
              Cuenta autorizada: <span className="font-medium text-slate-700">{AUTHORIZED_ADMIN_EMAIL}</span>
            </p>
            <a
              href={voteUrl}
              className="block text-xs font-medium text-slate-600 hover:text-slate-900 underline underline-offset-4"
            >
              ¿Eres participante de la audiencia? Entra aquí para votar
            </a>
          </div>
        </main>

        <footer className="max-w-5xl w-full mx-auto text-center text-xs text-slate-500 py-2">
          Solo el organizador necesita acceder a esta vista
        </footer>
      </div>
    );
  }

  if (!adminState) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center p-6 gap-3">
        <div className="w-9 h-9 rounded-full border-2 border-slate-300 border-t-slate-900 animate-spin" />
        <p className="text-sm text-slate-600">Cargando datos en vivo desde Firebase...</p>
      </div>
    );
  }

  const activeCategory =
    adminState.categories.find((c) => c.id === adminState.activeCategoryId) ??
    adminState.categories[0] ??
    null;

  const publicScreenPreviewState = derivePublicState(adminState, 'screen');
  const voterPreviewState = derivePublicState(adminState, 'voter');

  const stageModes: Array<{ id: StageMode; label: string; hint: string }> = [
    { id: 'lobby', label: 'Bienvenida', hint: 'Muestra título y QR para unirse' },
    { id: 'nominees', label: 'Presentar candidatos', hint: 'Presenta primero la categoría y luego cada candidato uno a uno' },
    { id: 'category', label: 'Presentar y votar', hint: 'Muestra todas las opciones con fotos para votar' },
    { id: 'closed', label: 'Cerrar y suspenso', hint: 'Cierra votación antes de revelar' },
    { id: 'winner', label: 'Revelar ganador', hint: 'Anuncia al ganador con su foto y celebración' },
    { id: 'summary', label: 'Cuadro de honor', hint: 'Resumen final de los ganadores revelados' },
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-slate-900 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element wordmark */}
        <span className="font-display text-lg font-semibold text-slate-900 whitespace-nowrap shrink-0">
          Gala Familiar
        </span>

        {/* Zone 2: 4 concise single-line navigation links */}
        <nav className="flex items-center gap-6 overflow-x-auto text-sm font-medium">
          {(
            [
              { id: 'live', label: 'En vivo' },
              { id: 'categories', label: 'Categorías' },
              { id: 'reports', label: 'Reportes' },
              { id: 'dual', label: 'Vista dual' },
            ] as Array<{ id: AdminTab; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'border-amber-700 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: 1 primary CTA */}
        <div className="shrink-0">
          <a
            href={screenUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[40px] px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Monitor className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Pantalla Pública</span>
          </a>
        </div>
      </header>

      {/* Secondary Workspace Status & Session Strip */}
      <div className="bg-white/70 border-b border-slate-200 px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                connected ? 'bg-emerald-600' : 'bg-amber-600'
              }`}
              aria-hidden="true"
            />
            <span>{connected ? 'Sincronizado con Firebase' : 'Conectando...'}</span>
          </span>
          <span aria-hidden="true" className="text-slate-300">
            ·
          </span>
          <span className="tabular-nums">
            <strong className="text-slate-900">{adminState.registeredVotersCount}</strong> votantes registrados
          </span>
          <span aria-hidden="true" className="text-slate-300">
            ·
          </span>
          <span className="tabular-nums">
            <strong className="text-slate-900">{adminState.categories.length}</strong> categorías
          </span>
          <span aria-hidden="true" className="text-slate-300">
            ·
          </span>
          <span className="tabular-nums">
            <strong className="text-slate-900">{adminState.totalVotesCast}</strong> votos registrados
          </span>
        </div>

        <div className="flex items-center gap-3">
          {currentUser.email && (
            <span className="hidden sm:inline text-slate-500">{currentUser.email}</span>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-900 font-medium whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </div>

      {/* Feedback & Errors */}
      {(actionError || actionFeedback) && (
        <div className="max-w-7xl w-full mx-auto px-6 lg:px-8 pt-4">
          {actionError && (
            <div
              role="alert"
              className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800 font-medium"
            >
              {actionError}
            </div>
          )}
          {actionFeedback && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-900 font-medium">
              {actionFeedback}
            </div>
          )}
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 lg:px-8 py-8">
        {activeTab === 'live' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Conductor Column */}
            <div className="lg:col-span-7 space-y-6">
              {/* Stage Mode Controls */}
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h1 className="font-display text-xl font-semibold text-slate-900">
                      Dirección de Pantalla Pública
                    </h1>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Controla en tiempo real lo que ven todos los asistentes y la única categoría visible para votar.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {stageModes.map((m) => {
                    const active = adminState.stageMode === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={async () => {
                          const ok = await updateCeremony({
                            stageMode: m.id,
                            ...(m.id === 'nominees' ? { revealedNomineeIndex: -1 } : {}),
                          });
                          if (ok) showToast(`Pantalla cambiada a: ${m.label}`);
                        }}
                        className={`text-left p-3.5 rounded-xl border transition-colors ${
                          active
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <p className="text-sm font-semibold">{m.label}</p>
                        <p
                          className={`text-[11px] mt-1 leading-snug ${
                            active ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        >
                          {m.hint}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {/* One-by-one Nominee Presentation Stepper (starts at -1 = category intro only) */}
                {adminState.stageMode === 'nominees' && activeCategory && activeCategory.nominees.length > 0 && (() => {
                  const totalNominees = activeCategory.nominees.length;
                  const rawIndex =
                    typeof adminState.revealedNomineeIndex === 'number'
                      ? adminState.revealedNomineeIndex
                      : -1;
                  const safeIndex = Math.max(-1, Math.min(totalNominees - 1, rawIndex));
                  const isCategoryOnly = safeIndex < 0;
                  const currentNominee = !isCategoryOnly ? activeCategory.nominees[safeIndex] : null;
                  const isFirst = safeIndex <= -1;
                  const isLast = safeIndex >= totalNominees - 1;

                  return (
                    <div className="rounded-xl bg-amber-50/70 border border-amber-200 p-4 sm:p-5 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-amber-900">
                            Presentación uno a uno · {activeCategory.title}
                          </p>
                          <p className="text-xs text-amber-800/80 mt-0.5 font-mono-tabular">
                            {isCategoryOnly
                              ? `Mostrando solo la categoría (${totalNominees} candidatos por presentar)`
                              : `Mostrando candidato ${safeIndex + 1} de ${totalNominees}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await updateCeremony({
                              stageMode: 'category',
                              openVotingOnActiveCategory: true,
                            });
                            if (ok) showToast(`Votación iniciada: ${activeCategory.title}`);
                          }}
                          className="min-h-[38px] px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                        >
                          <Play className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Iniciar votación ahora</span>
                        </button>
                      </div>

                      <div className="bg-white rounded-xl border border-amber-200/80 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        {isCategoryOnly ? (
                          <div className="flex items-center gap-3.5 min-w-0">
                            <div className="w-14 h-14 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                              <Trophy className="w-6 h-6" aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[11px] font-mono-tabular font-semibold text-amber-800">
                                Paso inicial · Solo categoría
                              </p>
                              <p className="font-display text-lg font-semibold text-slate-900 truncate">
                                {activeCategory.title}
                              </p>
                              <p className="text-xs text-slate-500 truncate">
                                Aún no se muestra ningún candidato en pantalla
                              </p>
                            </div>
                          </div>
                        ) : (
                          currentNominee && (
                            <div className="flex items-center gap-3.5 min-w-0">
                              <NomineeAvatar
                                name={currentNominee.name}
                                photoUrl={currentNominee.photoUrl}
                                accentColor={currentNominee.accentColor}
                                fallbackLabel={String(safeIndex + 1)}
                                className="w-14 h-14 rounded-xl border border-slate-200"
                                textClassName="text-base font-semibold"
                              />
                              <div className="min-w-0">
                                <p className="text-[11px] font-mono-tabular font-semibold text-amber-800">
                                  Candidato {String(safeIndex + 1).padStart(2, '0')}
                                </p>
                                <p className="font-display text-lg font-semibold text-slate-900 truncate">
                                  {currentNominee.name}
                                </p>
                                {currentNominee.subtitle && (
                                  <p className="text-xs text-slate-500 truncate">
                                    {currentNominee.subtitle}
                                  </p>
                                )}
                              </div>
                            </div>
                          )
                        )}

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={isFirst}
                            onClick={() =>
                              updateCeremony({ revealedNomineeIndex: safeIndex - 1 })
                            }
                            className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1"
                          >
                            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                            <span>Anterior</span>
                          </button>
                          <button
                            type="button"
                            disabled={isLast}
                            onClick={() =>
                              updateCeremony({ revealedNomineeIndex: safeIndex + 1 })
                            }
                            className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-40 inline-flex items-center gap-1"
                          >
                            <span>
                              {isCategoryOnly
                                ? 'Presentar 1.er candidato'
                                : isLast
                                ? 'Último candidato'
                                : 'Siguiente'}
                            </span>
                            {!isLast && <ChevronRight className="w-4 h-4" aria-hidden="true" />}
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => updateCeremony({ revealedNomineeIndex: -1 })}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                            isCategoryOnly
                              ? 'bg-amber-700 text-white border-amber-700'
                              : 'bg-white text-slate-700 border-amber-200 hover:bg-amber-100/60'
                          }`}
                        >
                          00. Solo categoría
                        </button>
                        {activeCategory.nominees.map((nom, idx) => (
                          <button
                            key={nom.id}
                            type="button"
                            onClick={() => updateCeremony({ revealedNomineeIndex: idx })}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                              idx === safeIndex
                                ? 'bg-amber-700 text-white border-amber-700'
                                : 'bg-white text-slate-700 border-amber-200 hover:bg-amber-100/60'
                            }`}
                          >
                            {String(idx + 1).padStart(2, '0')}. {nom.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
                  <p className="text-xs text-slate-500">
                    La Pantalla Pública solo muestra las opciones de votación hasta que reveles al ganador.
                  </p>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleBulkVoting('open-all')}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-medium hover:bg-emerald-100 transition-colors"
                    >
                      Abrir todas
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBulkVoting('close-all')}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 transition-colors"
                    >
                      Cerrar todas
                    </button>
                  </div>
                </div>
              </section>

              {/* Category Queue & Open/Close Voting Controls */}
              <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="p-5 border-b border-slate-200 flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Categorías y control de votación
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Avanza categoría por categoría. Los votantes solo ven la que está activa en escenario.
                    </p>
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {adminState.categories.map((cat, idx) => {
                    const isActiveOnStage = activeCategory?.id === cat.id;
                    return (
                      <div
                        key={cat.id}
                        className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                          isActiveOnStage ? 'bg-amber-50/50' : 'hover:bg-slate-50/60'
                        }`}
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span className="font-mono-tabular font-semibold text-amber-800">
                              {String(idx + 1).padStart(2, '0')}.
                            </span>
                            {isActiveOnStage && (
                              <>
                                <span className="font-semibold text-amber-800">
                                  Categoría en escenario
                                </span>
                                <span aria-hidden="true">·</span>
                              </>
                            )}
                            <span className="font-mono-tabular">
                              {cat.totalVotes} {cat.totalVotes === 1 ? 'voto' : 'votos'}
                            </span>
                            {cat.isWinnerRevealed && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-amber-700 font-medium">Revelada</span>
                              </>
                            )}
                          </div>
                          <p className="font-display text-lg font-semibold text-slate-900 truncate">
                            {cat.title}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await updateCeremony({
                                activeCategoryId: cat.id,
                                revealedNomineeIndex: -1,
                                stageMode:
                                  adminState.stageMode === 'lobby' ||
                                  adminState.stageMode === 'summary' ||
                                  adminState.stageMode === 'winner'
                                    ? 'nominees'
                                    : adminState.stageMode,
                              });
                              if (ok) showToast(`Categoría activa: ${cat.title}`);
                            }}
                            className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
                              isActiveOnStage
                                ? 'bg-amber-700 text-white border-amber-700'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            {isActiveOnStage ? 'En pantalla' : 'Presentar'}
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleCategoryVoting(cat)}
                            className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-semibold border inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                              cat.isVotingOpen
                                ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            {cat.isVotingOpen ? (
                              <>
                                <Unlock className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Abierta</span>
                              </>
                            ) : (
                              <>
                                <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Cerrada</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            {/* Right Monitor & QR Sharing Column */}
            <div className="lg:col-span-5 space-y-6">
              {/* Live Public Screen Mini-Preview */}
              <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Vista previa: Pantalla Pública
                    </h2>
                    <p className="text-xs text-slate-500">
                      Refleja en tiempo real lo proyectado a la audiencia
                    </p>
                  </div>
                  <a
                    href={screenUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-amber-800 hover:underline inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    <span>Abrir</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                </div>

                <div className="rounded-xl overflow-hidden border border-slate-900/10 bg-[#0B0D12]">
                  <div className="origin-top-left w-[166.66%] scale-[0.6] h-[360px] pointer-events-none select-none overflow-hidden">
                    <PublicScreenView state={publicScreenPreviewState} connected={connected} isPreview />
                  </div>
                </div>
              </section>

              {/* Share Voting Link & QR Code */}
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Conexión de votantes (celulares)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Comparte el enlace o proyecta el QR. Los invitados solo ven la categoría activa para votar.
                  </p>
                </div>

                <div className="flex items-center gap-5">
                  <div className="p-2.5 bg-white border border-slate-200 rounded-xl shrink-0">
                    <QRCodeSVG value={voteUrl} size={104} level="M" />
                  </div>
                  <div className="min-w-0 space-y-2.5 flex-1">
                    <div>
                      <p className="text-xs font-medium text-slate-500">Enlace para votantes</p>
                      <p className="text-xs font-mono-tabular text-slate-800 truncate mt-0.5">
                        {voteUrl}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(voteUrl, 'vote')}
                        className="min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 inline-flex items-center gap-1.5"
                      >
                        {copiedKey === 'vote' ? (
                          <>
                            <Check className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Copiado</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Copiar enlace de voto</span>
                          </>
                        )}
                      </button>
                      <a
                        href={voteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-50 inline-flex items-center gap-1.5"
                      >
                        <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Probar</span>
                      </a>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-500">Enlace Pantalla Pública</p>
                    <p className="text-xs font-mono-tabular text-slate-700 truncate">{screenUrl}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(screenUrl, 'screen')}
                    className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-50 inline-flex items-center gap-1.5 shrink-0"
                  >
                    {copiedKey === 'screen' ? (
                      <>
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Copiar pantalla</span>
                      </>
                    )}
                  </button>
                </div>
              </section>
            </div>
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="space-y-8">
            {/* Ceremony Title & Reset Controls */}
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="font-display text-2xl font-semibold text-slate-900">
                    Configuración de la Gala y Categorías
                  </h1>
                  <p className="text-sm text-slate-600 mt-0.5">
                    Personaliza el nombre del evento, agrega categorías y administra nominados en Firebase.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setConfirmAction({
                      title: 'Reiniciar todos los votos',
                      message:
                        'Se eliminarán todos los votos registrados en todas las categorías. Las categorías y nominados se mantendrán intactos.',
                      confirmLabel: 'Sí, reiniciar votos',
                      onConfirm: async () => {
                        const ok = await runAdminMutation(() =>
                          resetVotesInFirestore(
                            null,
                            adminState.categories.map((c) => c.id)
                          )
                        );
                        if (ok) showToast('Todos los votos han sido reiniciados');
                      },
                    })
                  }
                  className="min-h-[40px] px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs font-semibold hover:bg-rose-100 inline-flex items-center gap-2 self-start whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Reiniciar todos los votos</span>
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await updateCeremony({
                    ceremonyTitle: titleDraft,
                    ceremonySubtitle: subtitleDraft,
                  });
                  if (ok) showToast('Información de la gala actualizada');
                }}
                className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end pt-3 border-t border-slate-100"
              >
                <div className="md:col-span-5 space-y-1.5">
                  <label htmlFor="ceremony-title" className="block text-xs font-medium text-slate-700">
                    Título de la premiación
                  </label>
                  <input
                    id="ceremony-title"
                    type="text"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    maxLength={80}
                    className="w-full min-h-[42px] px-3.5 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-700"
                  />
                </div>
                <div className="md:col-span-5 space-y-1.5">
                  <label htmlFor="ceremony-subtitle" className="block text-xs font-medium text-slate-700">
                    Subtítulo o mensaje de bienvenida
                  </label>
                  <input
                    id="ceremony-subtitle"
                    type="text"
                    value={subtitleDraft}
                    onChange={(e) => setSubtitleDraft(e.target.value)}
                    maxLength={140}
                    className="w-full min-h-[42px] px-3.5 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-700"
                  />
                </div>
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    className="w-full min-h-[42px] px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors"
                  >
                    Guardar título
                  </button>
                </div>
              </form>
            </section>

            {/* Category Creation & List */}
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  Categorías ({adminState.categories.length})
                </h2>
                <button
                  type="button"
                  onClick={openNewCategoryEditor}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-amber-700 text-white text-xs font-semibold hover:bg-amber-800 inline-flex items-center gap-2 whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>Nueva categoría</span>
                </button>
              </div>

              {/* Category Editor Panel */}
              {editingCategoryId !== null && (
                <form
                  onSubmit={saveCategoryEditor}
                  className="bg-white border border-amber-300 rounded-xl p-6 space-y-5"
                >
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="font-display text-lg font-semibold text-slate-900">
                      {editingCategoryId === 'new' ? 'Crear nueva categoría' : 'Editar categoría'}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setEditingCategoryId(null)}
                      className="text-xs font-medium text-slate-500 hover:text-slate-800"
                    >
                      Cancelar
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="cat-title" className="block text-xs font-medium text-slate-700">
                        Nombre de la categoría
                      </label>
                      <input
                        id="cat-title"
                        type="text"
                        value={catTitleDraft}
                        onChange={(e) => setCatTitleDraft(e.target.value)}
                        placeholder="Ej. Mejor Fotógrafo Familiar"
                        maxLength={80}
                        className="w-full min-h-[42px] px-3.5 py-2 rounded-lg border border-slate-300 text-sm text-slate-900"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="cat-desc" className="block text-xs font-medium text-slate-700">
                        Descripción breve (opcional)
                      </label>
                      <input
                        id="cat-desc"
                        type="text"
                        value={catDescDraft}
                        onChange={(e) => setCatDescDraft(e.target.value)}
                        placeholder="Ej. Quien captura los mejores recuerdos..."
                        maxLength={220}
                        className="w-full min-h-[42px] px-3.5 py-2 rounded-lg border border-slate-300 text-sm text-slate-900"
                      />
                    </div>
                  </div>

                  <div className="space-y-3 pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">
                        Nominados (mínimo 2)
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setNomineesDraft((prev) => [
                            ...prev,
                            {
                              name: '',
                              subtitle: '',
                              accentColor: ACCENT_SWATCHES[prev.length % ACCENT_SWATCHES.length],
                            },
                          ])
                        }
                        className="text-xs font-semibold text-amber-800 hover:underline inline-flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                        Agregar nominado
                      </button>
                    </div>

                    <div className="space-y-3">
                      {nomineesDraft.map((nom, i) => (
                        <div
                          key={nom.id ?? `draft-${i}`}
                          className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-2.5"
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                            <div className="sm:col-span-4">
                              <input
                                type="text"
                                value={nom.name}
                                onChange={(e) =>
                                  setNomineesDraft((prev) =>
                                    prev.map((item, idx) =>
                                      idx === i ? { ...item, name: e.target.value } : item
                                    )
                                  )
                                }
                                placeholder={`Nominado ${i + 1}`}
                                maxLength={60}
                                className="w-full min-h-[40px] px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                              />
                            </div>
                            <div className="sm:col-span-5">
                              <input
                                type="text"
                                value={nom.subtitle}
                                onChange={(e) =>
                                  setNomineesDraft((prev) =>
                                    prev.map((item, idx) =>
                                      idx === i ? { ...item, subtitle: e.target.value } : item
                                    )
                                  )
                                }
                                placeholder="Motivo o parentesco (opcional)"
                                maxLength={120}
                                className="w-full min-h-[40px] px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                              />
                            </div>
                            <div className="sm:col-span-2 flex items-center gap-1.5">
                              {ACCENT_SWATCHES.map((swatch) => (
                                <button
                                  key={swatch}
                                  type="button"
                                  aria-label={`Color ${swatch}`}
                                  onClick={() =>
                                    setNomineesDraft((prev) =>
                                      prev.map((item, idx) =>
                                        idx === i ? { ...item, accentColor: swatch } : item
                                      )
                                    )
                                  }
                                  className={`w-5 h-5 rounded-full transition-transform ${
                                    nom.accentColor === swatch
                                      ? 'ring-2 ring-offset-1 ring-slate-900 scale-110'
                                      : 'opacity-70 hover:opacity-100'
                                  }`}
                                  style={{ backgroundColor: swatch }}
                                />
                              ))}
                            </div>
                            <div className="sm:col-span-1 flex justify-end">
                              <button
                                type="button"
                                disabled={nomineesDraft.length <= 2}
                                onClick={() =>
                                  setNomineesDraft((prev) => prev.filter((_, idx) => idx !== i))
                                }
                                aria-label="Eliminar nominado"
                                className="p-2 text-slate-400 hover:text-rose-700 disabled:opacity-30"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {/* Nominee Photo Upload & Preview */}
                          <div className="flex flex-wrap items-center gap-3 pt-1">
                            <NomineeAvatar
                              name={nom.name || `N${i + 1}`}
                              photoUrl={nom.photoUrl}
                              accentColor={nom.accentColor}
                              fallbackLabel={String(i + 1)}
                              className="w-10 h-10 rounded-lg border border-slate-200"
                              textClassName="text-xs font-semibold"
                            />

                            <label className="min-h-[34px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer">
                              <ImagePlus className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
                              <span>
                                {uploadingPhotoIdx === i
                                  ? 'Procesando foto...'
                                  : nom.photoUrl
                                  ? 'Cambiar foto'
                                  : 'Subir foto'}
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                className="sr-only"
                                onChange={(e) => {
                                  const file = e.target.files?.[0] ?? null;
                                  e.target.value = '';
                                  void handleNomineePhotoUpload(i, file);
                                }}
                              />
                            </label>

                            {nom.photoUrl && (
                              <button
                                type="button"
                                onClick={() =>
                                  setNomineesDraft((prev) =>
                                    prev.map((item, idx) =>
                                      idx === i ? { ...item, photoUrl: '' } : item
                                    )
                                  )
                                }
                                className="min-h-[34px] px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1"
                              >
                                <X className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Quitar</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingCategoryId(null)}
                      className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={savingCategory}
                      className="min-h-[40px] px-5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
                    >
                      {savingCategory ? 'Guardando...' : 'Guardar categoría'}
                    </button>
                  </div>
                </form>
              )}

              {/* Categories Grid */}
              <div className="space-y-4">
                {adminState.categories.map((cat, idx) => (
                  <div
                    key={cat.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col gap-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-mono-tabular font-semibold text-amber-800">
                            {String(idx + 1).padStart(2, '0')}.
                          </span>
                          <span>{cat.nominees.length} nominados</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular">{cat.totalVotes} votos</span>
                        </div>
                        <h3 className="font-display text-xl font-semibold text-slate-900">
                          {cat.title}
                        </h3>
                        {cat.description && (
                          <p className="text-sm text-slate-600">{cat.description}</p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveCategory(idx, -1)}
                          aria-label="Subir categoría"
                          className="min-h-[36px] min-w-[36px] p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === adminState.categories.length - 1}
                          onClick={() => moveCategory(idx, 1)}
                          aria-label="Bajar categoría"
                          className="min-h-[36px] min-w-[36px] p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditCategoryEditor(cat)}
                          className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmAction({
                              title: `Reiniciar votos de "${cat.title}"`,
                              message:
                                'Se eliminarán únicamente los votos de esta categoría para poder volver a votarla.',
                              confirmLabel: 'Reiniciar categoría',
                              onConfirm: async () => {
                                const ok = await runAdminMutation(() =>
                                  resetVotesInFirestore(
                                    cat.id,
                                    adminState.categories.map((c) => c.id)
                                  )
                                );
                                if (ok) showToast(`Votos reiniciados en ${cat.title}`);
                              },
                            })
                          }
                          className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          Reiniciar votos
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmAction({
                              title: `Eliminar "${cat.title}"`,
                              message:
                                'Esta acción eliminará la categoría, sus nominados y todos los votos recibidos en ella.',
                              confirmLabel: 'Eliminar categoría',
                              onConfirm: async () => {
                                const remaining = adminState.categories.filter(
                                  (c) => c.id !== cat.id
                                );
                                const nextActiveId =
                                  adminState.activeCategoryId === cat.id
                                    ? remaining[0]?.id ?? null
                                    : adminState.activeCategoryId;
                                const ok = await runAdminMutation(() =>
                                  deleteCategoryInFirestore(cat.id, nextActiveId)
                                );
                                if (ok) showToast(`Categoría eliminada: ${cat.title}`);
                              },
                            })
                          }
                          aria-label={`Eliminar ${cat.title}`}
                          className="min-h-[36px] min-w-[36px] p-2 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-slate-100">
                      {cat.nominees.map((nom, nomIdx) => (
                        <div
                          key={nom.id}
                          className="rounded-lg bg-slate-50 border border-slate-200/80 px-3.5 py-2.5 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <NomineeAvatar
                              name={nom.name}
                              photoUrl={nom.photoUrl}
                              accentColor={nom.accentColor}
                              fallbackLabel={String(nomIdx + 1)}
                              className="w-8 h-8 rounded-lg"
                              textClassName="text-xs font-semibold"
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900 truncate">
                                {nom.name}
                              </p>
                              {nom.subtitle && (
                                <p className="text-[11px] text-slate-500 truncate">
                                  {nom.subtitle}
                                </p>
                              )}
                            </div>
                          </div>
                          <span className="font-mono-tabular text-xs font-semibold text-slate-700 shrink-0">
                            {nom.votes}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'reports' && <ReportsView state={adminState} />}

        {activeTab === 'dual' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="font-display text-2xl font-semibold text-slate-900">
                  Vista Dual en Vivo (Monitor de Administrador)
                </h1>
                <p className="text-sm text-slate-600 mt-0.5">
                  Supervisa simultáneamente la Pantalla Pública y el Panel de Votación tal como los ven los asistentes.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
              {/* Public Screen Live Frame */}
              <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Pantalla Pública
                    </h2>
                    <p className="text-xs text-slate-500">
                      Vista exclusiva para proyector o televisor
                    </p>
                  </div>
                  <a
                    href={screenUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
                  >
                    <span>Abrir pantalla completa</span>
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  </a>
                </div>

                <PublicScreenView
                  state={publicScreenPreviewState}
                  connected={connected}
                  isPreview
                />
              </div>

              {/* Mobile Voter Panel Live Frame */}
              <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Panel de Votación
                    </h2>
                    <p className="text-xs text-slate-500">
                      Vista exclusiva de los participantes en sus celulares
                    </p>
                  </div>
                  <a
                    href={voteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
                  >
                    <span>Abrir en pestaña</span>
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  </a>
                </div>

                <div className="max-w-[420px] mx-auto">
                  <VoterView
                    state={voterPreviewState}
                    connected={connected}
                    isPreview
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Inline Confirmation Dialog */}
      {confirmAction && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h2 className="font-display text-xl font-semibold text-slate-900">
              {confirmAction.title}
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">{confirmAction.message}</p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  const fn = confirmAction.onConfirm;
                  setConfirmAction(null);
                  await fn();
                }}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-rose-700 text-white text-xs font-semibold hover:bg-rose-800"
              >
                {confirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
