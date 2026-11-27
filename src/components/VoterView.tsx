import { useEffect, useMemo, useState } from 'react';
import { Award, Check, CheckCircle2, Lock, Trophy, UserCheck } from 'lucide-react';
import {
  castLocalVote,
  getLocalVoterSession,
  registerLocalVoter,
} from '../lib/localFallback';
import { resolveApiUrl } from '../lib/routes';
import type { PublicCategoryState, PublicCeremonyState, VoterVoteMap } from '../types';

interface VoterViewProps {
  state: PublicCeremonyState | null;
  connected?: boolean;
  isPreview?: boolean;
  isStaticFallback?: boolean;
  adminFooterHref?: string;
}

const VOTER_TOKEN_STORAGE_KEY = 'gala_familiar_voter_token';

function getCategoryWinners(category: PublicCategoryState) {
  const withCounts = category.nominees.filter((n) => typeof n.votes === 'number');
  if (withCounts.length === 0) return [];
  const maxVotes = Math.max(...withCounts.map((n) => n.votes ?? 0));
  if (maxVotes === 0) return [];
  return withCounts.filter((n) => n.votes === maxVotes);
}

export default function VoterView({
  state,
  connected = true,
  isPreview = false,
  isStaticFallback = false,
  adminFooterHref,
}: VoterViewProps) {
  const [voterToken, setVoterToken] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(VOTER_TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [voterName, setVoterName] = useState<string>('');
  const [nameInput, setNameInput] = useState<string>('');
  const [isRegistered, setIsRegistered] = useState<boolean>(false);
  const [checkingSession, setCheckingSession] = useState<boolean>(true);
  const [myVotes, setMyVotes] = useState<VoterVoteMap>({});

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [pendingNomineeId, setPendingNomineeId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [justVotedMessage, setJustVotedMessage] = useState<string | null>(null);

  // Restore existing voter session on mount
  useEffect(() => {
    let cancelled = false;
    const loadSession = async () => {
      if (isStaticFallback) {
        const local = getLocalVoterSession();
        if (!cancelled && local.registered && local.voterToken) {
          setIsRegistered(true);
          setVoterName(local.voterName ?? 'Invitado');
          setVoterToken(local.voterToken);
          setMyVotes(local.myVotes ?? {});
        }
        if (!cancelled) setCheckingSession(false);
        return;
      }

      try {
        const headers: Record<string, string> = {};
        if (voterToken) {
          headers['x-voter-token'] = voterToken;
        }
        const res = await fetch(resolveApiUrl('/api/voter/session'), { headers });
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.includes('application/json')) return;
        const data = (await res.json()) as {
          registered: boolean;
          voterName?: string;
          voterToken?: string;
          myVotes?: VoterVoteMap;
        };
        if (!cancelled && data.registered && data.voterToken) {
          setIsRegistered(true);
          setVoterName(data.voterName ?? 'Invitado');
          setVoterToken(data.voterToken);
          setMyVotes(data.myVotes ?? {});
          try {
            window.localStorage.setItem(VOTER_TOKEN_STORAGE_KEY, data.voterToken);
          } catch {
            // Ignore storage restriction
          }
        }
      } catch {
        // Ignore network error during session check
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    };
    loadSession();
    return () => {
      cancelled = true;
    };
  }, [isStaticFallback]);

  // Follow the presenter's active category automatically when stage updates
  useEffect(() => {
    if (!state) return;
    if (state.activeCategoryId) {
      setSelectedCategoryId(state.activeCategoryId);
      setPendingNomineeId(null);
      setErrorMsg(null);
    } else if (state.categories.length > 0 && !selectedCategoryId) {
      setSelectedCategoryId(state.categories[0].id);
    }
  }, [state?.activeCategoryId]);

  const activeCategory = useMemo(() => {
    if (!state) return null;
    return (
      state.categories.find((c) => c.id === selectedCategoryId) ??
      state.categories.find((c) => c.id === state.activeCategoryId) ??
      state.categories[0] ??
      null
    );
  }, [state, selectedCategoryId]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = nameInput.trim();
    if (clean.length < 2) {
      setErrorMsg('Escribe tu nombre o apodo familiar (mínimo 2 letras).');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      if (isStaticFallback) {
        const local = registerLocalVoter(clean);
        setVoterToken(local.voterToken);
        setVoterName(local.voterName);
        setMyVotes(local.myVotes);
        setIsRegistered(true);
        return;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (voterToken) headers['x-voter-token'] = voterToken;
      const res = await fetch(resolveApiUrl('/api/voter/register'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: clean }),
      });
      const data = (await res.json()) as {
        error?: string;
        voterName?: string;
        voterToken?: string;
        myVotes?: VoterVoteMap;
      };
      if (!res.ok) {
        setErrorMsg(data.error ?? 'No se pudo registrar tu acceso.');
        return;
      }
      if (data.voterToken) {
        setVoterToken(data.voterToken);
        try {
          window.localStorage.setItem(VOTER_TOKEN_STORAGE_KEY, data.voterToken);
        } catch {
          // Ignore storage error
        }
      }
      setVoterName(data.voterName ?? clean);
      setMyVotes(data.myVotes ?? {});
      setIsRegistered(true);
    } catch {
      setErrorMsg('Error de conexión. Inténtalo de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmVote = async () => {
    if (!activeCategory || !pendingNomineeId || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    setJustVotedMessage(null);
    try {
      if (isStaticFallback) {
        const local = castLocalVote(activeCategory.id, pendingNomineeId);
        if (local.error) {
          setErrorMsg(local.error);
          return;
        }
        if (local.myVotes) setMyVotes(local.myVotes);
        const chosen = activeCategory.nominees.find((n) => n.id === pendingNomineeId);
        setJustVotedMessage(
          chosen ? `Voto registrado para ${chosen.name}` : 'Voto registrado correctamente'
        );
        setPendingNomineeId(null);
        return;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (voterToken) headers['x-voter-token'] = voterToken;

      const res = await fetch(resolveApiUrl('/api/vote'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          categoryId: activeCategory.id,
          nomineeId: pendingNomineeId,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        myVotes?: VoterVoteMap;
      };
      if (!res.ok) {
        setErrorMsg(data.error ?? 'No se pudo registrar tu voto.');
        return;
      }
      if (data.myVotes) {
        setMyVotes(data.myVotes);
      } else {
        setMyVotes((prev) => ({ ...prev, [activeCategory.id]: pendingNomineeId }));
      }
      const chosen = activeCategory.nominees.find((n) => n.id === pendingNomineeId);
      setJustVotedMessage(
        chosen ? `Voto registrado para ${chosen.name}` : 'Voto registrado correctamente'
      );
      setPendingNomineeId(null);
    } catch {
      setErrorMsg('No se pudo conectar con el servidor. Verifica tu internet.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!state || checkingSession) {
    return (
      <div
        className={`${
          isPreview ? 'min-h-[600px]' : 'min-h-screen'
        } bg-[#FAF9F6] text-slate-900 flex flex-col items-center justify-center p-6`}
      >
        <div className="w-10 h-10 rounded-full border-2 border-amber-700/20 border-t-amber-700 animate-spin mb-3" />
        <p className="text-sm font-medium text-slate-600">Cargando panel de votación...</p>
      </div>
    );
  }

  const votedNomineeId = activeCategory ? myVotes[activeCategory.id] : undefined;
  const hasVotedInActive = Boolean(votedNomineeId);
  const votedNominee = activeCategory?.nominees.find((n) => n.id === votedNomineeId);
  const pendingNominee = activeCategory?.nominees.find((n) => n.id === pendingNomineeId);
  const canVoteNow = Boolean(activeCategory && activeCategory.isVotingOpen && !hasVotedInActive);
  const activeWinners = activeCategory ? getCategoryWinners(activeCategory) : [];

  return (
    <div
      className={`${
        isPreview ? 'min-h-[640px] rounded-xl overflow-hidden border border-slate-200' : 'min-h-screen'
      } bg-[#FAF9F6] text-slate-900 flex flex-col`}
    >
      {/* Compact Sticky Top Bar (<= 56px) */}
      <header className="sticky top-0 z-30 h-14 bg-[#FAF9F6]/95 backdrop-blur-md border-b border-stone-200 px-4 sm:px-6 flex items-center justify-between gap-4">
        <span className="font-display text-base sm:text-lg font-semibold text-slate-900 truncate">
          {state.ceremonyTitle}
        </span>
        <div className="flex items-center gap-3 text-xs text-slate-600 shrink-0">
          {isRegistered && (
            <span className="hidden sm:inline-flex items-center gap-1.5 font-medium text-slate-700">
              <UserCheck className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
              {voterName}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              className={`w-2 h-2 rounded-full ${
                connected ? 'bg-emerald-600' : 'bg-amber-600'
              }`}
              aria-hidden="true"
            />
            <span>{connected ? 'En vivo' : 'Reconectando'}</span>
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 pt-5 pb-28">
        {!isRegistered ? (
          <div className="max-w-md mx-auto mt-6 sm:mt-12 bg-white border border-stone-200 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="space-y-2">
              <p className="text-xs font-medium text-amber-700">
                Bienvenido a la votación en vivo
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-semibold text-slate-900 text-balance">
                {state.ceremonyTitle}
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                Ingresa tu nombre o parentesco para participar. Podrás emitir 1 voto por cada categoría abierta.
              </p>
            </div>

            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="voter-name-input"
                  className="block text-sm font-medium text-slate-800"
                >
                  Tu nombre o apodo
                </label>
                <input
                  id="voter-name-input"
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Ej. Tía Carmen, Primo Mateo..."
                  maxLength={50}
                  autoComplete="name"
                  className="w-full min-h-[48px] px-4 py-3 rounded-xl border border-stone-300 bg-white text-slate-900 text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-600/30 focus:border-amber-700"
                />
              </div>

              {errorMsg && (
                <p role="alert" className="text-sm text-rose-700 font-medium">
                  {errorMsg}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {submitting ? 'Ingresando...' : 'Entrar a votar'}
              </button>
            </form>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Voter Identity & Progress Summary */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 pb-3 border-b border-stone-200">
              <span>
                Participante: <strong className="text-slate-900">{voterName}</strong>
              </span>
              <span className="tabular-nums">
                {Object.keys(myVotes).length} de {state.categories.length} categorías votadas
              </span>
            </div>

            {/* Category Selector Tabs */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500">Categorías</p>
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {state.categories.map((cat, idx) => {
                  const isSelected = activeCategory?.id === cat.id;
                  const voted = Boolean(myVotes[cat.id]);
                  const isLiveActive = state.activeCategoryId === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setSelectedCategoryId(cat.id);
                        setPendingNomineeId(null);
                        setErrorMsg(null);
                        setJustVotedMessage(null);
                      }}
                      className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap shrink-0 flex items-center gap-2 border transition-colors ${
                        isSelected
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-stone-200 hover:border-stone-300'
                      }`}
                    >
                      <span className="font-mono-tabular opacity-75">
                        {String(idx + 1).padStart(2, '0')}.
                      </span>
                      <span className="max-w-[160px] truncate">{cat.title}</span>
                      {voted ? (
                        <CheckCircle2
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isSelected ? 'text-emerald-300' : 'text-emerald-600'
                          }`}
                          aria-label="Votada"
                        />
                      ) : cat.isVotingOpen ? (
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            isSelected ? 'bg-amber-300' : 'bg-amber-600'
                          }`}
                          aria-label="Abierta"
                        />
                      ) : isLiveActive ? null : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Lobby Notice when ceremony hasn't opened current stage yet and no category is open */}
            {state.stageMode === 'lobby' &&
              !state.categories.some((c) => c.isVotingOpen) && (
                <div className="rounded-2xl bg-white border border-stone-200 p-6 sm:p-8 text-center space-y-3">
                  <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto">
                    <Trophy className="w-6 h-6 text-amber-700" aria-hidden="true" />
                  </div>
                  <h2 className="font-display text-2xl font-semibold text-slate-900 text-balance">
                    La ceremonia comenzará en breve
                  </h2>
                  <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
                    Mantén esta pantalla abierta en tu dispositivo. En cuanto el anfitrión abra una categoría, aparecerá aquí lista para votar.
                  </p>
                </div>
              )}

            {/* Active Category Voting Card */}
            {activeCategory && (
              <section className="space-y-5">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                    {activeCategory.isVotingOpen ? (
                      <span className="text-emerald-700">Votación abierta</span>
                    ) : (
                      <span className="text-slate-500 inline-flex items-center gap-1">
                        <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                        Votación cerrada
                      </span>
                    )}
                    <span aria-hidden="true" className="text-stone-300">
                      ·
                    </span>
                    <span className="text-slate-500">1 voto por categoría</span>
                  </div>

                  <h1 className="font-display text-2xl sm:text-3xl font-semibold text-slate-900 text-balance">
                    {activeCategory.title}
                  </h1>
                  {activeCategory.description && (
                    <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                      {activeCategory.description}
                    </p>
                  )}
                </div>

                {/* Winner Announced Banner for Voter */}
                {activeCategory.isWinnerRevealed && activeWinners.length > 0 && (
                  <div className="rounded-2xl bg-amber-50 border border-amber-300 p-5 flex items-center gap-4">
                    <div className="w-11 h-11 rounded-xl bg-amber-700 text-white flex items-center justify-center shrink-0">
                      <Award className="w-6 h-6" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-amber-800">
                        {activeWinners.length > 1 ? 'Empate ganador' : 'Ganador anunciado'}
                      </p>
                      <p className="font-display text-xl font-semibold text-slate-900 truncate">
                        {activeWinners.map((w) => w.name).join(' & ')}
                      </p>
                    </div>
                  </div>
                )}

                {/* Locked confirmation when user already voted in this category */}
                {hasVotedInActive && (
                  <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 sm:p-5 flex items-start gap-3">
                    <CheckCircle2
                      className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold text-emerald-950">
                        {justVotedMessage ?? 'Voto ya registrado en esta categoría'}
                      </p>
                      <p className="text-xs text-emerald-800">
                        Tu elección: <strong>{votedNominee?.name ?? 'Registrada'}</strong>. Solo se permite un voto por categoría.
                      </p>
                    </div>
                  </div>
                )}

                {errorMsg && (
                  <div
                    role="alert"
                    className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800 font-medium"
                  >
                    {errorMsg}
                  </div>
                )}

                {/* Nominee Tap Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {activeCategory.nominees.map((nominee) => {
                    const isMyChoice = votedNomineeId === nominee.id;
                    const isPendingChoice = pendingNomineeId === nominee.id;
                    const disabled = !canVoteNow;

                    return (
                      <button
                        key={nominee.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (!canVoteNow) return;
                          setPendingNomineeId(nominee.id);
                          setErrorMsg(null);
                        }}
                        className={`w-full min-h-[72px] text-left rounded-2xl p-4 sm:p-5 border transition-all flex items-center justify-between gap-4 ${
                          isMyChoice
                            ? 'bg-emerald-50/70 border-emerald-500 ring-1 ring-emerald-500'
                            : isPendingChoice
                            ? 'bg-amber-50/70 border-amber-700 ring-1 ring-amber-700'
                            : disabled
                            ? 'bg-white/70 border-stone-200 opacity-75 cursor-not-allowed'
                            : 'bg-white border-stone-200 hover:border-stone-400 active:scale-[0.99]'
                        }`}
                      >
                        <div className="flex items-start gap-3.5 min-w-0">
                          <span
                            className="w-3 h-10 rounded-full shrink-0 mt-0.5"
                            style={{ backgroundColor: nominee.accentColor || '#D97706' }}
                            aria-hidden="true"
                          />
                          <div className="min-w-0">
                            <p className="font-display text-lg font-semibold text-slate-900 leading-snug">
                              {nominee.name}
                            </p>
                            {nominee.subtitle && (
                              <p className="text-xs sm:text-sm text-slate-600 mt-0.5 leading-relaxed">
                                {nominee.subtitle}
                              </p>
                            )}
                          </div>
                        </div>

                        <div
                          className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                            isMyChoice
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : isPendingChoice
                              ? 'bg-amber-700 border-amber-700 text-white'
                              : 'border-stone-300 bg-white'
                          }`}
                          aria-hidden="true"
                        >
                          {(isMyChoice || isPendingChoice) && <Check className="w-4 h-4" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* Discreet bottom admin access link (only shown on root landing page, never on /votar) */}
      {adminFooterHref && !isPreview && (
        <footer
          className={`py-4 px-4 text-center border-t border-stone-200/70 bg-[#FAF9F6] ${
            isRegistered && canVoteNow ? 'pb-24' : ''
          }`}
        >
          <a
            href={adminFooterHref}
            className="text-xs font-medium text-slate-500 hover:text-slate-900 underline underline-offset-4 transition-colors"
          >
            ¿Eres organizador? Acceso de administrador
          </a>
        </footer>
      )}

      {/* Thumb-Zone Sticky Bottom Vote CTA (only when voter selected a nominee to confirm) */}
      {isRegistered && canVoteNow && (
        <div
          className={`${
            isPreview ? 'sticky' : 'fixed'
          } bottom-0 left-0 right-0 z-30 p-4 bg-gradient-to-t from-[#FAF9F6] via-[#FAF9F6] to-[#FAF9F6]/80 border-t border-stone-200/80`}
        >
          <div className="max-w-4xl mx-auto">
            <button
              type="button"
              disabled={!pendingNominee || submitting}
              onClick={handleConfirmVote}
              className="w-full min-h-[48px] px-6 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 active:scale-[0.98] transition-all disabled:bg-stone-300 disabled:text-stone-600 disabled:cursor-not-allowed"
            >
              {submitting
                ? 'Enviando voto...'
                : pendingNominee
                ? `Confirmar voto por ${pendingNominee.name}`
                : 'Selecciona un nominado para votar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
