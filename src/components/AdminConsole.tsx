import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  LogOut,
  Monitor,
  Plus,
  RotateCcw,
  Smartphone,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useCeremonySocket } from '../hooks/useCeremonySocket';
import type { AdminCategoryState, AdminCeremonyState, PublicCeremonyState, StageMode } from '../types';
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
}

function derivePublicState(
  admin: AdminCeremonyState,
  audience: 'screen' | 'voter'
): PublicCeremonyState {
  return {
    ceremonyTitle: admin.ceremonyTitle,
    ceremonySubtitle: admin.ceremonySubtitle,
    stageMode: admin.stageMode,
    activeCategoryId: admin.activeCategoryId,
    showLiveTalliesOnScreen: admin.showLiveTalliesOnScreen,
    connectedVotersCount: admin.connectedVotersCount,
    registeredVotersCount: admin.registeredVotersCount,
    totalVotesCast: admin.totalVotesCast,
    updatedAt: admin.updatedAt,
    categories: admin.categories.map((cat) => {
      const shouldReveal =
        cat.isWinnerRevealed ||
        (audience === 'screen' &&
          (admin.showLiveTalliesOnScreen ||
            (admin.stageMode === 'winner' && admin.activeCategoryId === cat.id) ||
            admin.stageMode === 'summary'));
      return {
        id: cat.id,
        title: cat.title,
        description: cat.description,
        order: cat.order,
        isVotingOpen: cat.isVotingOpen,
        isWinnerRevealed: cat.isWinnerRevealed,
        totalVotes: cat.totalVotes,
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
  const [setupRequired, setSetupRequired] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [confirmPasscodeInput, setConfirmPasscodeInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

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
  const [savingCategory, setSavingCategory] = useState(false);

  // Confirmation dialog state (no window.confirm)
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  const { state: adminState, connected, setState: setAdminState } = useCeremonySocket<AdminCeremonyState>({
    role: 'admin',
    adminToken,
    enabled: Boolean(adminToken),
  });

  useEffect(() => {
    let cancelled = false;
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/admin/status');
        if (res.ok && !cancelled) {
          const data = (await res.json()) as {
            setupRequired: boolean;
            authenticated: boolean;
          };
          setSetupRequired(data.setupRequired);
        }
      } catch {
        // Ignore initial status error
      } finally {
        if (!cancelled) setAuthStatusLoading(false);
      }
    };
    checkStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (adminState) {
      setTitleDraft(adminState.ceremonyTitle);
      setSubtitleDraft(adminState.ceremonySubtitle);
    }
  }, [adminState?.ceremonyTitle, adminState?.ceremonySubtitle]);

  const voteUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/votar';
    return `${window.location.origin}/votar`;
  }, []);

  const screenUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/pantalla';
    return `${window.location.origin}/pantalla`;
  }, []);

  const showToast = (msg: string) => {
    setActionFeedback(msg);
    setActionError(null);
    window.setTimeout(() => {
      setActionFeedback((curr) => (curr === msg ? null : curr));
    }, 3000);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const clean = passcodeInput.trim();
    if (clean.length < 4) {
      setAuthError('Ingresa una clave de al menos 4 caracteres.');
      return;
    }
    if (setupRequired && clean !== confirmPasscodeInput.trim()) {
      setAuthError('Las claves no coinciden.');
      return;
    }
    setAuthSubmitting(true);
    try {
      const endpoint = setupRequired ? '/api/admin/claim' : '/api/admin/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: clean }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setAuthError(data.error ?? 'No se pudo iniciar sesión.');
        return;
      }
      setAdminToken(data.token);
      setSetupRequired(false);
      setPasscodeInput('');
      setConfirmPasscodeInput('');
    } catch {
      setAuthError('Error de conexión con el servidor.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    if (adminToken) {
      await fetch('/api/admin/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).catch(() => {});
    }
    setAdminToken(null);
    setAdminState(null);
  };

  const adminFetch = async (url: string, options: RequestInit = {}) => {
    if (!adminToken) return null;
    setActionError(null);
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        ...(options.headers ?? {}),
      },
    });
    const data = (await res.json()) as AdminCeremonyState & { error?: string };
    if (!res.ok) {
      if (res.status === 401) {
        setAdminToken(null);
      }
      setActionError(data.error ?? 'Ocurrió un error al guardar los cambios.');
      return null;
    }
    setAdminState(data);
    return data;
  };

  const updateCeremony = async (patch: {
    ceremonyTitle?: string;
    ceremonySubtitle?: string;
    stageMode?: StageMode;
    activeCategoryId?: string | null;
    showLiveTalliesOnScreen?: boolean;
  }) => {
    return adminFetch('/api/admin/ceremony', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  };

  const toggleCategoryVoting = async (cat: AdminCategoryState) => {
    const updated = await adminFetch(`/api/admin/categories/${cat.id}`, {
      method: 'PUT',
      body: JSON.stringify({ isVotingOpen: !cat.isVotingOpen }),
    });
    if (updated) {
      showToast(
        !cat.isVotingOpen
          ? `Votación abierta: ${cat.title}`
          : `Votación cerrada: ${cat.title}`
      );
    }
  };

  const handleBulkVoting = async (action: 'open-all' | 'close-all') => {
    const updated = await adminFetch('/api/admin/voting/bulk', {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    if (updated) {
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
      { name: '', subtitle: '', accentColor: ACCENT_SWATCHES[0] },
      { name: '', subtitle: '', accentColor: ACCENT_SWATCHES[1] },
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
      }))
    );
  };

  const saveCategoryEditor = async (e: React.FormEvent) => {
    e.preventDefault();
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
      const payload = {
        title: catTitleDraft.trim(),
        description: catDescDraft.trim(),
        nominees: validNominees,
      };
      const res =
        editingCategoryId === 'new'
          ? await adminFetch('/api/admin/categories', {
              method: 'POST',
              body: JSON.stringify(payload),
            })
          : await adminFetch(`/api/admin/categories/${editingCategoryId}`, {
              method: 'PUT',
              body: JSON.stringify(payload),
            });
      if (res) {
        setEditingCategoryId(null);
        showToast('Categoría guardada');
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
    await adminFetch('/api/admin/categories/reorder', {
      method: 'POST',
      body: JSON.stringify({ orderedIds: ordered.map((c) => c.id) }),
    });
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

  // Organizer Login / First-run setup gate
  if (!adminToken) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] text-slate-900 flex flex-col justify-between p-6">
        <header className="max-w-5xl w-full mx-auto flex items-center justify-between py-2">
          <span className="font-display text-xl font-semibold text-slate-900">
            Gala Familiar
          </span>
          <a
            href="/votar"
            className="text-sm font-medium text-amber-800 hover:underline whitespace-nowrap"
          >
            Ir al panel de votación
          </a>
        </header>

        <main className="max-w-md w-full mx-auto bg-white border border-slate-200 rounded-2xl p-8 space-y-6 my-auto">
          <div className="space-y-2">
            <p className="text-xs font-medium text-amber-700">
              {setupRequired ? 'Configuración inicial del organizador' : 'Consola de Dirección'}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-slate-900 text-balance">
              {setupRequired
                ? 'Crea tu clave de administrador'
                : 'Acceso del organizador'}
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              {setupRequired
                ? 'Esta clave protegerá la gestión de categorías, resultados y el control en vivo de la pantalla pública.'
                : 'Ingresa tu clave de organizador para dirigir la premiación y ver los reportes en vivo.'}
            </p>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="admin-passcode" className="block text-sm font-medium text-slate-800">
                Clave de organizador
              </label>
              <input
                id="admin-passcode"
                type="password"
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value)}
                placeholder="Mínimo 4 caracteres"
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600/25 focus:border-amber-700"
              />
            </div>

            {setupRequired && (
              <div className="space-y-1.5">
                <label
                  htmlFor="admin-passcode-confirm"
                  className="block text-sm font-medium text-slate-800"
                >
                  Confirmar clave
                </label>
                <input
                  id="admin-passcode-confirm"
                  type="password"
                  value={confirmPasscodeInput}
                  onChange={(e) => setConfirmPasscodeInput(e.target.value)}
                  placeholder="Repite tu clave"
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600/25 focus:border-amber-700"
                />
              </div>
            )}

            {authError && (
              <p role="alert" className="text-sm font-medium text-rose-700">
                {authError}
              </p>
            )}

            <button
              type="submit"
              disabled={authSubmitting}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {authSubmitting
                ? 'Verificando...'
                : setupRequired
                ? 'Guardar clave y entrar'
                : 'Entrar al panel de control'}
            </button>
          </form>

          <div className="pt-4 border-t border-slate-100 text-center">
            <a
              href="/votar"
              className="text-xs font-medium text-slate-600 hover:text-slate-900 underline underline-offset-4"
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
        <p className="text-sm text-slate-600">Cargando consola de administración...</p>
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
    { id: 'category', label: 'Presentar y votar', hint: 'Muestra nominados de la categoría activa' },
    { id: 'closed', label: 'Cerrar y suspenso', hint: 'Cierra votación antes de revelar' },
    { id: 'winner', label: 'Revelar ganador', hint: 'Anuncia al ganador con celebración' },
    { id: 'summary', label: 'Cuadro de honor', hint: 'Resumen final de todos los ganadores' },
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
            href="/pantalla"
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
            <span>{connected ? 'Sincronizado en vivo' : 'Reconectando'}</span>
          </span>
          <span aria-hidden="true" className="text-slate-300">
            ·
          </span>
          <span className="tabular-nums">
            <strong className="text-slate-900">{adminState.connectedVotersCount}</strong> votantes conectados
          </span>
          <span aria-hidden="true" className="text-slate-300">
            ·
          </span>
          <span className="tabular-nums">
            <strong className="text-slate-900">{adminState.connectedScreensCount}</strong> pantallas públicas
          </span>
          <span aria-hidden="true" className="text-slate-300">
            ·
          </span>
          <span className="tabular-nums">
            <strong className="text-slate-900">{adminState.totalVotesCast}</strong> votos registrados
          </span>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-900 font-medium whitespace-nowrap"
        >
          <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Cerrar sesión</span>
        </button>
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
                      Controla en tiempo real lo que ven todos los asistentes en el proyector o TV.
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
                          await updateCeremony({ stageMode: m.id });
                          showToast(`Pantalla cambiada a: ${m.label}`);
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

                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
                  <button
                    type="button"
                    onClick={() =>
                      updateCeremony({
                        showLiveTalliesOnScreen: !adminState.showLiveTalliesOnScreen,
                      })
                    }
                    className="min-h-[40px] px-3.5 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-800 inline-flex items-center gap-2 transition-colors"
                  >
                    {adminState.showLiveTalliesOnScreen ? (
                      <>
                        <Eye className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                        <span>Barras en vivo visibles en pantalla pública</span>
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-4 h-4 text-slate-500" aria-hidden="true" />
                        <span>Barras ocultas (modo suspenso hasta revelar)</span>
                      </>
                    )}
                  </button>

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
                      Selecciona la categoría en escenario y abre o cierra su votación al instante.
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
                              await updateCeremony({
                                activeCategoryId: cat.id,
                                stageMode:
                                  adminState.stageMode === 'lobby' ||
                                  adminState.stageMode === 'summary'
                                    ? 'category'
                                    : adminState.stageMode,
                              });
                              showToast(`Categoría activa: ${cat.title}`);
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
                    href="/pantalla"
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
                    Comparte el enlace o proyecta el QR. Los invitados solo ven su panel de voto.
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
                        href="/votar"
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
                    Personaliza el nombre del evento, edita categorías y administra nominados.
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
                        const res = await adminFetch('/api/admin/reset-votes', {
                          method: 'POST',
                          body: JSON.stringify({}),
                        });
                        if (res) showToast('Todos los votos han sido reiniciados');
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
                  const res = await updateCeremony({
                    ceremonyTitle: titleDraft,
                    ceremonySubtitle: subtitleDraft,
                  });
                  if (res) showToast('Información de la gala actualizada');
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

                    <div className="space-y-2.5">
                      {nomineesDraft.map((nom, i) => (
                        <div
                          key={nom.id ?? `draft-${i}`}
                          className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center"
                        >
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
                              className="w-full min-h-[40px] px-3 py-2 rounded-lg border border-slate-300 text-sm"
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
                              className="w-full min-h-[40px] px-3 py-2 rounded-lg border border-slate-300 text-sm"
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
                                const res = await adminFetch('/api/admin/reset-votes', {
                                  method: 'POST',
                                  body: JSON.stringify({ categoryId: cat.id }),
                                });
                                if (res) showToast(`Votos reiniciados en ${cat.title}`);
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
                                const res = await adminFetch(`/api/admin/categories/${cat.id}`, {
                                  method: 'DELETE',
                                });
                                if (res) showToast(`Categoría eliminada: ${cat.title}`);
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
                      {cat.nominees.map((nom) => (
                        <div
                          key={nom.id}
                          className="rounded-lg bg-slate-50 border border-slate-200/80 px-3.5 py-2.5 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: nom.accentColor }}
                              aria-hidden="true"
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
                      Pantalla Pública (/pantalla)
                    </h2>
                    <p className="text-xs text-slate-500">
                      Vista exclusiva para proyector o televisor
                    </p>
                  </div>
                  <a
                    href="/pantalla"
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
                      Panel de Votación (/votar)
                    </h2>
                    <p className="text-xs text-slate-500">
                      Vista exclusiva de los participantes en sus celulares
                    </p>
                  </div>
                  <a
                    href="/votar"
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
