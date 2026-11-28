import { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { Award, Check, CheckCircle2, Lock, Trophy, UserCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  castVoteInFirestore,
  fetchVoterProfileInFirestore,
  fetchVoterVoteForCategory,
  generateSafeId,
  registerVoterInFirestore,
} from '../lib/firestoreCeremony';
import type { PublicCategoryState, PublicCeremonyState, VoterVoteMap } from '../types';
import NomineeAvatar from './NomineeAvatar';

interface VoterViewProps {
  state: PublicCeremonyState | null;
  connected?: boolean;
  isPreview?: boolean;
  adminFooterHref?: string;
}

const VOTER_ID_STORAGE_KEY = 'gala_familiar_firebase_voter_id';
const VOTER_NAME_STORAGE_KEY = 'gala_familiar_firebase_voter_name';

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
  adminFooterHref,
}: VoterViewProps) {
  const [voterId, setVoterId] = useState<string>(() => {
    try {
      const existing = window.localStorage.getItem(VOTER_ID_STORAGE_KEY);
      if (existing) return existing;
      const fresh = generateSafeId('voter');
      window.localStorage.setItem(VOTER_ID_STORAGE_KEY, fresh);
      return fresh;
    } catch {
      return generateSafeId('voter');
    }
  });
  const [voterName, setVoterName] = useState<string>(() => {
    try {
      return window.localStorage.getItem(VOTER_NAME_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [nameInput, setNameInput] = useState<string>('');
  const [isRegistered, setIsRegistered] = useState<boolean>(false);
  const [checkingSession, setCheckingSession] = useState<boolean>(true);
  const [myVotes, setMyVotes] = useState<VoterVoteMap>({});

  const [pendingNomineeId, setPendingNomineeId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [justVotedMessage, setJustVotedMessage] = useState<string | null>(null);
  const prevWinnerKeyRef = useRef<string | null>(null);

  // Restore existing voter registration from Firestore
  useEffect(() => {
    let cancelled = false;
    const loadProfile = async () => {
      try {
        const profile = await fetchVoterProfileInFirestore(voterId);
        if (!cancelled && profile) {
          setVoterName(profile.voterName);
          setIsRegistered(true);
          try {
            window.localStorage.setItem(VOTER_NAME_STORAGE_KEY, profile.voterName);
          } catch {
            // Ignore storage error
          }
        }
      } catch {
        // Ignore initial lookup error
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    };
    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [voterId]);

  const activeCategory = useMemo(() => {
    if (!state) return null;
    if (state.stageMode === 'lobby' || state.stageMode === 'summary') return null;
    if (!state.activeCategoryId) return null;
    return state.categories.find((c) => c.id === state.activeCategoryId) ?? null;
  }, [state]);

  // Reset selection & verify if this voter already voted in the newly active category
  useEffect(() => {
    setPendingNomineeId(null);
    setErrorMsg(null);
    setJustVotedMessage(null);

    if (!activeCategory || !isRegistered) return;
    let cancelled = false;
    fetchVoterVoteForCategory(activeCategory.id, voterId).then((nomineeId) => {
      if (cancelled) return;
      setMyVotes((prev) => {
        if (nomineeId) {
          return { ...prev, [activeCategory.id]: nomineeId };
        }
        if (activeCategory.id in prev) {
          const next = { ...prev };
          delete next[activeCategory.id];
          return next;
        }
        return prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [activeCategory?.id, activeCategory?.isVotingOpen, isRegistered, voterId]);

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
      const idToUse = voterId || generateSafeId('voter');
      await registerVoterInFirestore(idToUse, clean);
      setVoterId(idToUse);
      setVoterName(clean);
      setIsRegistered(true);
      try {
        window.localStorage.setItem(VOTER_ID_STORAGE_KEY, idToUse);
        window.localStorage.setItem(VOTER_NAME_STORAGE_KEY, clean);
      } catch {
        // Ignore storage error
      }
    } catch {
      setErrorMsg('No se pudo registrar tu acceso. Inténtalo de nuevo.');
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
      await castVoteInFirestore({
        categoryId: activeCategory.id,
        nomineeId: pendingNomineeId,
        voterId,
        voterName: voterName || 'Invitado',
      });
      setMyVotes((prev) => ({ ...prev, [activeCategory.id]: pendingNomineeId }));
      const chosen = activeCategory.nominees.find((n) => n.id === pendingNomineeId);
      setJustVotedMessage(
        chosen ? `Voto registrado para ${chosen.name}` : 'Voto registrado correctamente'
      );
      setPendingNomineeId(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Missing or insufficient permissions') || msg.includes('already exists')) {
        // Re-check if already voted or voting closed
        const existing = await fetchVoterVoteForCategory(activeCategory.id, voterId);
        if (existing) {
          setMyVotes((prev) => ({ ...prev, [activeCategory.id]: existing }));
          setErrorMsg('Ya emitiste tu voto en esta categoría. Solo se permite 1 voto por categoría.');
        } else {
          setErrorMsg('La votación para esta categoría está cerrada en este momento.');
        }
      } else {
        setErrorMsg('No se pudo registrar tu voto. Verifica tu conexión e inténtalo de nuevo.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const votedNomineeId = activeCategory ? myVotes[activeCategory.id] : undefined;
  const hasVotedInActive = Boolean(votedNomineeId);
  const votedNominee = activeCategory?.nominees.find((n) => n.id === votedNomineeId);
  const pendingNominee = activeCategory?.nominees.find((n) => n.id === pendingNomineeId);
  const canVoteNow = Boolean(
    activeCategory &&
      state?.stageMode === 'category' &&
      activeCategory.isVotingOpen &&
      !hasVotedInActive
  );
  const activeWinners = useMemo(
    () => (activeCategory ? getCategoryWinners(activeCategory) : []),
    [activeCategory]
  );

  useEffect(() => {
    if (!state || isPreview || !isRegistered) return;
    if (
      state.stageMode === 'winner' &&
      activeCategory &&
      activeCategory.isWinnerRevealed &&
      activeWinners.length > 0
    ) {
      const key = `${activeCategory.id}:${activeWinners.map((w) => w.id).join(',')}`;
      if (prevWinnerKeyRef.current !== key) {
        prevWinnerKeyRef.current = key;
        const prefersReduced =
          typeof window !== 'undefined' &&
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (!prefersReduced) {
          try {
            confetti({
              particleCount: 70,
              spread: 70,
              origin: { y: 0.6 },
              colors: ['#D4AF37', '#F3E5AB', '#F59E0B', '#FFFFFF'],
              disableForReducedMotion: true,
            });
          } catch {
            // Ignore confetti errors
          }
        }
      }
    } else {
      prevWinnerKeyRef.current = null;
    }
  }, [state, activeCategory, activeWinners, isPreview, isRegistered]);

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
                Ingresa tu nombre o parentesco para participar. Podrás emitir 1 voto por cada categoría conforme el anfitrión la vaya presentando.
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
            {/* Voter Identity */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 pb-3 border-b border-stone-200">
              <span>
                Participante: <strong className="text-slate-900">{voterName}</strong>
              </span>
              <span>Categoría en curso</span>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {/* Lobby / Waiting State (NO upcoming categories revealed) */}
              {(state.stageMode === 'lobby' || (!activeCategory && state.stageMode !== 'summary')) && (
                <motion.div
                  key="stage-lobby"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="rounded-2xl bg-white border border-stone-200 p-6 sm:p-10 text-center space-y-3 mt-4"
                >
                  <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto">
                    <Trophy className="w-6 h-6 text-amber-700" aria-hidden="true" />
                  </div>
                  <h2 className="font-display text-2xl font-semibold text-slate-900 text-balance">
                    La ceremonia comenzará en breve
                  </h2>
                  <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
                    Mantén esta pantalla abierta. En cuanto el anfitrión presente una categoría y abra la votación, aparecerá aquí automáticamente.
                  </p>
                </motion.div>
              )}

              {/* Final Summary State */}
              {state.stageMode === 'summary' && (
                <motion.div
                  key="stage-summary"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="rounded-2xl bg-white border border-stone-200 p-6 sm:p-10 text-center space-y-3 mt-4"
                >
                  <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto">
                    <Award className="w-6 h-6 text-amber-700" aria-hidden="true" />
                  </div>
                  <h2 className="font-display text-2xl font-semibold text-slate-900 text-balance">
                    ¡Gracias por votar!
                  </h2>
                  <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
                    La premiación ha concluido. Mira el cuadro final de ganadores en la pantalla principal.
                  </p>
                </motion.div>
              )}

              {/* Single Active Category: Category Intro First, then One-by-One Nominee Presentation */}
              {activeCategory && state.stageMode === 'nominees' && activeCategory.nominees.length > 0 && (() => {
                const rawIndex =
                  typeof state.revealedNomineeIndex === 'number'
                    ? state.revealedNomineeIndex
                    : -1;
                const isCategoryIntroOnly = rawIndex < 0;
                const safeIndex = isCategoryIntroOnly
                  ? -1
                  : Math.min(activeCategory.nominees.length - 1, rawIndex);
                const currentNominee =
                  safeIndex >= 0 ? activeCategory.nominees[safeIndex] : null;
                const previouslyPresented =
                  safeIndex > 0 ? activeCategory.nominees.slice(0, safeIndex) : [];

                return (
                  <motion.section
                    key={`nominees-intro-${activeCategory.id}`}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -14 }}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    className="space-y-5"
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                        <span className="text-amber-800">
                          {isCategoryIntroOnly
                            ? 'Presentación de categoría'
                            : 'Presentación de candidatos'}
                        </span>
                        <span aria-hidden="true" className="text-stone-300">
                          ·
                        </span>
                        <span className="font-mono-tabular text-slate-600">
                          {isCategoryIntroOnly
                            ? `${activeCategory.nominees.length} nominados`
                            : `${safeIndex + 1} de ${activeCategory.nominees.length}`}
                        </span>
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

                    <AnimatePresence mode="wait" initial={false}>
                      {isCategoryIntroOnly ? (
                        <motion.div
                          key={`voter-category-intro-${activeCategory.id}`}
                          initial={{ opacity: 0, y: 12, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -10, scale: 0.98 }}
                          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                          className="rounded-2xl bg-white border border-amber-300 p-6 text-center space-y-3"
                        >
                          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto">
                            <Trophy className="w-6 h-6 text-amber-700" aria-hidden="true" />
                          </div>
                          <h2 className="font-display text-xl font-semibold text-slate-900 text-balance">
                            Presentando esta categoría
                          </h2>
                          <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
                            En un momento conocerás uno a uno a los{' '}
                            <span className="font-mono-tabular font-semibold text-slate-800">
                              {activeCategory.nominees.length}
                            </span>{' '}
                            candidatos antes de abrir la votación.
                          </p>
                        </motion.div>
                      ) : (
                        currentNominee && (
                          <motion.div
                            key={`voter-spotlight-${activeCategory.id}-${currentNominee.id}`}
                            initial={{ opacity: 0, y: 12, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -10, scale: 0.98 }}
                            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                            className="rounded-2xl bg-white border border-amber-300 p-5 sm:p-6 flex flex-col sm:flex-row items-center gap-5"
                          >
                            <NomineeAvatar
                              name={currentNominee.name}
                              photoUrl={currentNominee.photoUrl}
                              accentColor={currentNominee.accentColor}
                              fallbackLabel={String(safeIndex + 1)}
                              className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl border border-stone-200"
                              textClassName="text-2xl font-semibold"
                            />
                            <div className="min-w-0 flex-1 text-center sm:text-left space-y-1.5">
                              <p className="text-xs font-mono-tabular font-semibold text-amber-800">
                                Nominado {String(safeIndex + 1).padStart(2, '0')}
                              </p>
                              <h2 className="font-display text-2xl font-semibold text-slate-900 leading-snug">
                                {currentNominee.name}
                              </h2>
                              {currentNominee.subtitle && (
                                <p className="text-sm text-slate-600 leading-relaxed">
                                  {currentNominee.subtitle}
                                </p>
                              )}
                            </div>
                          </motion.div>
                        )
                      )}
                    </AnimatePresence>

                    {previouslyPresented.length > 0 && (
                      <div className="space-y-2.5 pt-2">
                        <p className="text-xs font-medium text-slate-500">
                          Candidatos presentados anteriormente
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {previouslyPresented.map((nom, idx) => (
                            <div
                              key={nom.id}
                              className="rounded-xl bg-white/80 border border-stone-200 p-3 flex items-center gap-3"
                            >
                              <NomineeAvatar
                                name={nom.name}
                                photoUrl={nom.photoUrl}
                                accentColor={nom.accentColor}
                                fallbackLabel={String(idx + 1)}
                                className="w-10 h-10 rounded-lg"
                                textClassName="text-xs font-semibold"
                              />
                              <div className="min-w-0">
                                <p className="font-display text-sm font-semibold text-slate-900 truncate">
                                  {nom.name}
                                </p>
                                {nom.subtitle && (
                                  <p className="text-xs text-slate-500 truncate">{nom.subtitle}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <p className="text-xs text-slate-500 text-center pt-2">
                      La votación se habilitará aquí en cuanto termine la presentación de nominados.
                    </p>
                  </motion.section>
                );
              })()}

              {/* Single Active Category Voting Card (ONLY what the admin is presenting) */}
              {activeCategory && state.stageMode !== 'nominees' && (
                <motion.section
                  key={`category-${activeCategory.id}`}
                  initial={{ opacity: 0, y: 14, scale: 0.99 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -14, scale: 0.99 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-5"
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                      {state.stageMode === 'category' && activeCategory.isVotingOpen ? (
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

                  {/* Winner Announced Banner */}
                  <AnimatePresence>
                    {state.stageMode === 'winner' &&
                      activeCategory.isWinnerRevealed &&
                      activeWinners.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: 8, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                          className="rounded-2xl bg-amber-50 border border-amber-300 p-5 flex items-center gap-4"
                        >
                          {activeWinners[0].photoUrl ? (
                            <NomineeAvatar
                              name={activeWinners[0].name}
                              photoUrl={activeWinners[0].photoUrl}
                              accentColor={activeWinners[0].accentColor}
                              className="w-14 h-14 rounded-xl border border-amber-300"
                              textClassName="text-lg font-semibold"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-xl bg-amber-700 text-white flex items-center justify-center shrink-0">
                              <Award className="w-6 h-6" aria-hidden="true" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-amber-800">
                              {activeWinners.length > 1 ? 'Empate ganador' : 'Ganador anunciado'}
                            </p>
                            <p className="font-display text-xl font-semibold text-slate-900 truncate">
                              {activeWinners.map((w) => w.name).join(' & ')}
                            </p>
                          </div>
                        </motion.div>
                      )}
                  </AnimatePresence>

                  {/* Locked confirmation when user already voted in this category */}
                  <AnimatePresence>
                    {hasVotedInActive && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 sm:p-5 flex items-start gap-3"
                      >
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
                      </motion.div>
                    )}
                  </AnimatePresence>

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
                    {activeCategory.nominees.map((nominee, idx) => {
                      const isMyChoice = votedNomineeId === nominee.id;
                      const isPendingChoice = pendingNomineeId === nominee.id;
                      const disabled = !canVoteNow;

                      return (
                        <motion.button
                          key={nominee.id}
                          type="button"
                          disabled={disabled}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            duration: 0.22,
                            delay: Math.min(idx * 0.04, 0.24),
                            ease: [0.22, 1, 0.36, 1],
                          }}
                          onClick={() => {
                            if (!canVoteNow) return;
                            setPendingNomineeId(nominee.id);
                            setErrorMsg(null);
                          }}
                          className={`w-full min-h-[76px] text-left rounded-2xl p-4 sm:p-5 border transition-colors flex items-center justify-between gap-4 ${
                            isMyChoice
                              ? 'bg-emerald-50/70 border-emerald-500 ring-1 ring-emerald-500'
                              : isPendingChoice
                              ? 'bg-amber-50/70 border-amber-700 ring-1 ring-amber-700'
                              : disabled
                              ? 'bg-white/70 border-stone-200 opacity-75 cursor-not-allowed'
                              : 'bg-white border-stone-200 hover:border-stone-400 active:scale-[0.99]'
                          }`}
                        >
                          <div className="flex items-center gap-3.5 min-w-0">
                            <NomineeAvatar
                              name={nominee.name}
                              photoUrl={nominee.photoUrl}
                              accentColor={nominee.accentColor || '#D97706'}
                              fallbackLabel={String(idx + 1)}
                              className="w-14 h-14 rounded-xl border border-stone-200"
                              textClassName="text-base font-semibold"
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
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        )}
      </main>

      {/* Discreet bottom admin access link (only shown on root entry screen before voter signs in) */}
      {adminFooterHref && !isPreview && !isRegistered && (
        <footer className="py-4 px-4 text-center border-t border-stone-200/70 bg-[#FAF9F6]">
          <a
            href={adminFooterHref}
            className="text-xs font-medium text-slate-500 hover:text-slate-900 underline underline-offset-4 transition-colors"
          >
            ¿Eres organizador? Acceso de administrador
          </a>
        </footer>
      )}

      {/* Thumb-Zone Sticky Bottom Vote CTA */}
      <AnimatePresence>
        {isRegistered && canVoteNow && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
