import { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import confetti from 'canvas-confetti';
import { Award, CheckCircle2, Lock, Smartphone, Trophy, Users } from 'lucide-react';
import STAGE_BACKDROP_SRC from '../assets/images/gala_stage_backdrop_1795747444467.jpg';
import TROPHY_EMBLEM_SRC from '../assets/images/golden_trophy_emblem_1795747445110.jpg';
import { buildViewUrl } from '../lib/routes';
import type { PublicCategoryState, PublicCeremonyState } from '../types';

interface PublicScreenViewProps {
  state: PublicCeremonyState | null;
  connected?: boolean;
  isPreview?: boolean;
}

function getCategoryWinners(category: PublicCategoryState) {
  const withCounts = category.nominees.filter((n) => typeof n.votes === 'number');
  if (withCounts.length === 0) return [];
  const maxVotes = Math.max(...withCounts.map((n) => n.votes ?? 0));
  if (maxVotes === 0) return [];
  return withCounts.filter((n) => n.votes === maxVotes);
}

export default function PublicScreenView({
  state,
  connected = true,
  isPreview = false,
}: PublicScreenViewProps) {
  const [backdropFailed, setBackdropFailed] = useState(false);
  const [trophyFailed, setTrophyFailed] = useState(false);
  const prevWinnerKeyRef = useRef<string | null>(null);

  const voteUrl = useMemo(() => {
    return buildViewUrl('vote');
  }, []);

  const activeCategory = useMemo(() => {
    if (!state) return null;
    return (
      state.categories.find((c) => c.id === state.activeCategoryId) ??
      state.categories[0] ??
      null
    );
  }, [state]);

  // Trigger celebratory gold confetti when entering winner reveal mode on the public screen
  useEffect(() => {
    if (!state || isPreview) return;
    if (state.stageMode === 'winner' && activeCategory) {
      const winnerKey = `${activeCategory.id}:${activeCategory.totalVotes}`;
      if (prevWinnerKeyRef.current !== winnerKey) {
        prevWinnerKeyRef.current = winnerKey;
        try {
          confetti({
            particleCount: 90,
            spread: 75,
            origin: { y: 0.55 },
            colors: ['#D4AF37', '#F3E5AB', '#B45309', '#FFFFFF'],
          });
        } catch {
          // Ignore confetti errors in headless browsers
        }
      }
    } else {
      prevWinnerKeyRef.current = null;
    }
  }, [state, activeCategory, isPreview]);

  if (!state) {
    return (
      <div
        className={`${
          isPreview ? 'min-h-[540px]' : 'min-h-screen'
        } bg-[#0B0D12] text-stone-100 flex flex-col items-center justify-center p-8`}
      >
        <div className="w-12 h-12 rounded-full border-2 border-amber-400/30 border-t-amber-400 animate-spin mb-4" />
        <p className="font-display text-2xl tracking-wide text-stone-200">
          Conectando con la gala...
        </p>
      </div>
    );
  }

  const showTallies =
    state.showLiveTalliesOnScreen ||
    state.stageMode === 'winner' ||
    state.stageMode === 'summary' ||
    Boolean(activeCategory?.isWinnerRevealed);

  const activeIndex = activeCategory
    ? state.categories.findIndex((c) => c.id === activeCategory.id)
    : -1;

  const winners = activeCategory ? getCategoryWinners(activeCategory) : [];

  return (
    <div
      className={`relative ${
        isPreview ? 'min-h-[600px] rounded-xl overflow-hidden' : 'min-h-screen'
      } bg-[#0B0D12] text-stone-100 flex flex-col justify-between overflow-x-hidden`}
    >
      {/* Subtle atmospheric stage backdrop with dark scrim */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {!backdropFailed ? (
          <img
            src={STAGE_BACKDROP_SRC}
            alt="Escenario de la gala"
            referrerPolicy="no-referrer"
            onError={() => setBackdropFailed(true)}
            className="w-full h-full object-cover opacity-25 scale-105"
          />
        ) : (
          <div className="w-full h-full bg-radial from-amber-900/20 via-[#0B0D12] to-[#07080B]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0B0D12]/80 via-[#0B0D12]/70 to-[#0B0D12]/95" />
      </div>

      {/* Broadcast Header Strip */}
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 px-6 sm:px-10 py-5 border-b border-white/10">
        <div className="min-w-0">
          <p className="font-display text-xl sm:text-2xl font-semibold tracking-wide text-[#F3E5AB] truncate">
            {state.ceremonyTitle}
          </p>
        </div>

        <div className="flex items-center gap-5 text-xs sm:text-sm text-stone-300 tracking-wide">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <Users className="w-4 h-4 text-[#D4AF37]" aria-hidden="true" />
            <span className="font-mono-tabular font-medium text-stone-100">
              {state.connectedVotersCount}
            </span>
            <span className="text-stone-400">conectados</span>
          </div>
          <span aria-hidden="true" className="text-stone-600">
            ·
          </span>
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="font-mono-tabular font-medium text-stone-100">
              {state.totalVotesCast}
            </span>
            <span className="text-stone-400">votos totales</span>
          </div>
          <span aria-hidden="true" className="text-stone-600">
            ·
          </span>
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span
              className={`w-2 h-2 rounded-full ${
                connected ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
              aria-hidden="true"
            />
            <span className="text-stone-300">
              {connected ? 'En vivo' : 'Reconectando'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Stage Content */}
      <main className="relative z-10 flex-1 flex flex-col justify-center px-6 sm:px-12 py-8 max-w-7xl w-full mx-auto">
        {state.stageMode === 'lobby' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
            <div className="lg:col-span-7 space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border border-[#D4AF37]/30 bg-[#141821] shrink-0 flex items-center justify-center">
                  {!trophyFailed ? (
                    <img
                      src={TROPHY_EMBLEM_SRC}
                      alt="Trofeo de la gala"
                      referrerPolicy="no-referrer"
                      onError={() => setTrophyFailed(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Trophy className="w-9 h-9 text-[#D4AF37]" />
                  )}
                </div>
                <div>
                  <p className="text-sm text-[#D4AF37] font-medium tracking-wide">
                    Bienvenidos a la premiación
                  </p>
                  <p className="text-xs text-stone-400 mt-0.5 tabular-nums">
                    {state.categories.length} categorías esta noche · {state.registeredVotersCount} familiares registrados
                  </p>
                </div>
              </div>

              <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-white text-balance leading-[1.1]">
                {state.ceremonyTitle}
              </h1>

              {state.ceremonySubtitle && (
                <p className="text-lg sm:text-xl text-stone-300 max-w-2xl leading-relaxed">
                  {state.ceremonySubtitle}
                </p>
              )}

              {/* Upcoming Categories Preview */}
              <div className="pt-4 border-t border-white/10">
                <p className="text-xs font-medium text-stone-400 mb-3 tracking-wide">
                  Categorías de la velada
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {state.categories.map((cat, idx) => (
                    <div
                      key={cat.id}
                      className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[#141821]/85 border border-white/10"
                    >
                      <div className="min-w-0">
                        <span className="font-mono-tabular text-xs text-[#D4AF37] mr-2">
                          {String(idx + 1).padStart(2, '0')}.
                        </span>
                        <span className="text-sm font-medium text-stone-100 truncate">
                          {cat.title}
                        </span>
                      </div>
                      <span className="text-xs text-stone-400 shrink-0 tabular-nums">
                        {cat.nominees.length} nominados
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* QR Code Join Panel */}
            <div className="lg:col-span-5 flex justify-center lg:justify-end">
              <div className="w-full max-w-sm rounded-2xl bg-[#141821] border border-[#D4AF37]/30 p-7 text-center space-y-5">
                <div className="inline-flex items-center gap-2 text-sm font-medium text-[#F3E5AB]">
                  <Smartphone className="w-4 h-4 text-[#D4AF37]" aria-hidden="true" />
                  <span>Vota desde tu celular</span>
                </div>

                <div className="bg-white p-4 rounded-xl inline-block mx-auto">
                  <QRCodeSVG value={voteUrl} size={isPreview ? 150 : 210} level="M" />
                </div>

                <div className="space-y-2">
                  <p className="text-sm text-stone-200 font-medium">
                    Escanea el código QR con tu cámara
                  </p>
                  <p className="text-xs text-stone-400 break-all font-mono-tabular bg-black/30 px-3 py-2 rounded-lg border border-white/5">
                    {voteUrl}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {state.stageMode === 'category' && activeCategory && (
          <div className="space-y-8">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-white/10">
              <div className="space-y-3 max-w-3xl">
                <div className="flex items-center gap-3 text-sm text-[#D4AF37] font-medium tracking-wide">
                  <span className="font-mono-tabular">
                    Categoría {activeIndex + 1} de {state.categories.length}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={
                      activeCategory.isVotingOpen ? 'text-emerald-400' : 'text-amber-300'
                    }
                  >
                    {activeCategory.isVotingOpen
                      ? 'Votación abierta en sus dispositivos'
                      : 'Votación cerrada'}
                  </span>
                </div>

                <h1 className="font-display text-3xl sm:text-5xl font-semibold text-white text-balance leading-tight">
                  {activeCategory.title}
                </h1>

                {activeCategory.description && (
                  <p className="text-base sm:text-lg text-stone-300 leading-relaxed">
                    {activeCategory.description}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-4 shrink-0 bg-[#141821] border border-white/10 rounded-xl px-5 py-3.5">
                <div className="bg-white p-1.5 rounded-lg shrink-0">
                  <QRCodeSVG value={voteUrl} size={64} level="L" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[#F3E5AB]">
                    Escanea para votar
                  </p>
                  <p className="font-mono-tabular text-xl font-semibold text-white">
                    {activeCategory.totalVotes}{' '}
                    <span className="text-xs font-normal text-stone-400">
                      {activeCategory.totalVotes === 1 ? 'voto' : 'votos'}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* Nominees Grid */}
            <div
              className={`grid gap-5 ${
                activeCategory.nominees.length <= 2
                  ? 'grid-cols-1 md:grid-cols-2'
                  : activeCategory.nominees.length === 3
                  ? 'grid-cols-1 md:grid-cols-3'
                  : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
              }`}
            >
              {activeCategory.nominees.map((nominee, idx) => {
                const votes = nominee.votes ?? 0;
                const pct = nominee.percentage ?? 0;
                return (
                  <div
                    key={nominee.id}
                    className="rounded-xl bg-[#141821]/95 border border-white/12 p-6 flex flex-col justify-between gap-5"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="w-9 h-9 rounded-lg flex items-center justify-center font-mono-tabular text-sm font-semibold text-white shrink-0"
                          style={{ backgroundColor: nominee.accentColor || '#D97706' }}
                        >
                          {idx + 1}
                        </span>
                        {showTallies && (
                          <span className="font-mono-tabular text-lg font-semibold text-[#F3E5AB]">
                            {pct.toFixed(0)}%
                          </span>
                        )}
                      </div>

                      <div>
                        <h2 className="font-display text-2xl font-semibold text-white leading-snug">
                          {nominee.name}
                        </h2>
                        {nominee.subtitle && (
                          <p className="text-sm text-stone-300 mt-1.5 leading-relaxed">
                            {nominee.subtitle}
                          </p>
                        )}
                      </div>
                    </div>

                    {showTallies ? (
                      <div className="space-y-2 pt-3 border-t border-white/10">
                        <div className="h-2.5 w-full rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.max(pct, votes > 0 ? 4 : 0)}%`,
                              backgroundColor: nominee.accentColor || '#D4AF37',
                            }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs text-stone-400 font-mono-tabular">
                          <span>{votes} {votes === 1 ? 'voto' : 'votos'}</span>
                          <span>{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                    ) : (
                      <div className="pt-3 border-t border-white/10 text-xs text-stone-400">
                        Nominado oficial
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {state.stageMode === 'closed' && activeCategory && (
          <div className="max-w-3xl mx-auto text-center space-y-7 py-8">
            <div className="w-20 h-20 rounded-2xl bg-[#141821] border border-[#D4AF37]/40 flex items-center justify-center mx-auto">
              <Lock className="w-9 h-9 text-[#D4AF37]" />
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-[#D4AF37] tracking-wide">
                Votación Cerrada · {activeCategory.title}
              </p>
              <h1 className="font-display text-4xl sm:text-5xl font-semibold text-white text-balance">
                Recuento oficial en curso
              </h1>
              <p className="text-lg text-stone-300">
                Hemos recibido{' '}
                <span className="font-mono-tabular font-semibold text-[#F3E5AB]">
                  {activeCategory.totalVotes}
                </span>{' '}
                {activeCategory.totalVotes === 1 ? 'voto' : 'votos'} para esta categoría. En breve anunciaremos al ganador.
              </p>
            </div>
          </div>
        )}

        {state.stageMode === 'winner' && activeCategory && (
          <div className="space-y-8">
            <div className="text-center space-y-4 max-w-3xl mx-auto">
              <p className="text-sm font-medium text-[#D4AF37] tracking-wide">
                {winners.length > 1 ? 'Empate oficial en la categoría' : 'Ganador oficial de la categoría'}
              </p>
              <h2 className="font-display text-2xl sm:text-3xl text-stone-200 font-normal">
                {activeCategory.title}
              </h2>
            </div>

            {winners.length > 0 ? (
              <div className="max-w-3xl mx-auto rounded-2xl bg-gradient-to-b from-[#1D1A12] to-[#141821] border border-[#D4AF37]/50 p-8 sm:p-10 text-center space-y-6">
                <div className="w-24 h-24 rounded-2xl overflow-hidden border border-[#D4AF37]/40 bg-[#0B0D12] mx-auto flex items-center justify-center">
                  {!trophyFailed ? (
                    <img
                      src={TROPHY_EMBLEM_SRC}
                      alt="Trofeo ganador"
                      referrerPolicy="no-referrer"
                      onError={() => setTrophyFailed(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Trophy className="w-12 h-12 text-[#D4AF37]" />
                  )}
                </div>

                <div className="space-y-2">
                  <h1 className="font-display text-4xl sm:text-6xl font-semibold text-[#F3E5AB] text-balance leading-tight">
                    {winners.map((w) => w.name).join(' & ')}
                  </h1>
                  {winners.length === 1 && winners[0].subtitle && (
                    <p className="text-lg text-stone-200 max-w-xl mx-auto">
                      {winners[0].subtitle}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-center gap-4 text-sm text-stone-300 pt-2">
                  <span className="font-mono-tabular text-lg font-semibold text-white">
                    {winners[0].votes} {winners[0].votes === 1 ? 'voto' : 'votos'}
                  </span>
                  <span aria-hidden="true" className="text-stone-500">
                    ·
                  </span>
                  <span className="font-mono-tabular text-lg font-semibold text-[#D4AF37]">
                    {(winners[0].percentage ?? 0).toFixed(1)}% de preferencia
                  </span>
                </div>
              </div>
            ) : (
              <div className="max-w-xl mx-auto rounded-2xl bg-[#141821] border border-white/10 p-8 text-center">
                <p className="text-stone-300">
                  Aún no se registraron votos en esta categoría.
                </p>
              </div>
            )}

            {/* Breakdown of all nominees */}
            <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[...activeCategory.nominees]
                .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))
                .map((nom) => {
                  const isWinner = winners.some((w) => w.id === nom.id);
                  return (
                    <div
                      key={nom.id}
                      className={`flex items-center justify-between gap-4 px-4 py-3 rounded-xl border ${
                        isWinner
                          ? 'bg-[#D4AF37]/10 border-[#D4AF37]/40 text-white'
                          : 'bg-[#141821]/80 border-white/10 text-stone-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {isWinner && (
                          <Award className="w-4 h-4 text-[#D4AF37] shrink-0" aria-hidden="true" />
                        )}
                        <span className="font-medium truncate">{nom.name}</span>
                      </div>
                      <span className="font-mono-tabular text-sm shrink-0">
                        {nom.votes ?? 0} ({(nom.percentage ?? 0).toFixed(0)}%)
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {state.stageMode === 'summary' && (
          <div className="space-y-8">
            <div className="text-center space-y-2 max-w-2xl mx-auto">
              <p className="text-sm font-medium text-[#D4AF37] tracking-wide">
                Cuadro de Honor
              </p>
              <h1 className="font-display text-3xl sm:text-5xl font-semibold text-white text-balance">
                Ganadores de la Velada
              </h1>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {state.categories.map((cat, idx) => {
                const catWinners = getCategoryWinners(cat);
                return (
                  <div
                    key={cat.id}
                    className="rounded-xl bg-[#141821]/95 border border-white/12 p-6 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <p className="text-xs font-mono-tabular text-[#D4AF37]">
                        Categoría {String(idx + 1).padStart(2, '0')}
                      </p>
                      <h2 className="font-display text-xl font-semibold text-white">
                        {cat.title}
                      </h2>
                    </div>

                    {catWinners.length > 0 ? (
                      <div className="flex items-center justify-between gap-4 pt-3 border-t border-white/10">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <CheckCircle2 className="w-5 h-5 text-[#D4AF37] shrink-0" aria-hidden="true" />
                          <span className="font-display text-xl font-semibold text-[#F3E5AB] truncate">
                            {catWinners.map((w) => w.name).join(' & ')}
                          </span>
                        </div>
                        <span className="font-mono-tabular text-sm text-stone-300 shrink-0">
                          {catWinners[0].votes} votos · {(catWinners[0].percentage ?? 0).toFixed(0)}%
                        </span>
                      </div>
                    ) : (
                      <div className="pt-3 border-t border-white/10 text-sm text-stone-400">
                        Sin votos registrados todavía
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Clean Footer */}
      <footer className="relative z-10 px-6 sm:px-10 py-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-400">
        <span>{state.ceremonyTitle}</span>
        <span>Participa en tu celular: {voteUrl}</span>
      </footer>
    </div>
  );
}
