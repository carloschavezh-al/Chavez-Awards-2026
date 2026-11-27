import { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import type { AdminCeremonyState } from '../types';

interface ReportsViewProps {
  state: AdminCeremonyState;
}

export default function ReportsView({ state }: ReportsViewProps) {
  const [voterSearch, setVoterSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'open' | 'revealed'>('all');

  const revealedCount = useMemo(
    () => state.categories.filter((c) => c.isWinnerRevealed).length,
    [state.categories]
  );

  const possibleVotes = state.registeredVotersCount * state.categories.length;
  const participationRate =
    possibleVotes > 0 ? Math.min(100, Math.round((state.totalVotesCast / possibleVotes) * 100)) : 0;

  const filteredCategories = useMemo(() => {
    return state.categories.filter((cat) => {
      if (categoryFilter === 'open') return cat.isVotingOpen;
      if (categoryFilter === 'revealed') return cat.isWinnerRevealed;
      return true;
    });
  }, [state.categories, categoryFilter]);

  const filteredVoters = useMemo(() => {
    const q = voterSearch.trim().toLowerCase();
    if (!q) return state.voters;
    return state.voters.filter((v) => v.voterName.toLowerCase().includes(q));
  }, [state.voters, voterSearch]);

  const maxCategoryVotes = useMemo(() => {
    return Math.max(1, ...state.categories.map((c) => c.totalVotes));
  }, [state.categories]);

  const maxTimelineCount = useMemo(() => {
    return Math.max(1, ...state.timeline.map((t) => t.count));
  }, [state.timeline]);

  const handleExportCsv = () => {
    const rows: string[][] = [
      ['Categoría', 'Estado votación', 'Nominado', 'Votos', 'Porcentaje (%)', 'Ganador actual'],
    ];

    for (const cat of state.categories) {
      const maxVotes = Math.max(0, ...cat.nominees.map((n) => n.votes));
      for (const nom of cat.nominees) {
        const isLeader = maxVotes > 0 && nom.votes === maxVotes;
        rows.push([
          cat.title,
          cat.isVotingOpen ? 'Abierta' : 'Cerrada',
          nom.name,
          String(nom.votes),
          nom.percentage.toFixed(1),
          isLeader ? 'Sí' : 'No',
        ]);
      }
    }

    const csvContent =
      '\uFEFF' +
      rows
        .map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'resultados-gala-familiar.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    const payload = {
      ceremonyTitle: state.ceremonyTitle,
      exportedAt: new Date().toISOString(),
      totalVotesCast: state.totalVotesCast,
      registeredVotersCount: state.registeredVotersCount,
      categories: state.categories.map((c) => ({
        title: c.title,
        totalVotes: c.totalVotes,
        isVotingOpen: c.isVotingOpen,
        isWinnerRevealed: c.isWinnerRevealed,
        nominees: c.nominees.map((n) => ({
          name: n.name,
          votes: n.votes,
          percentage: n.percentage,
        })),
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'resultados-gala-familiar.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      {/* Header & Exports */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-slate-900">
            Reportes en tiempo real
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Resultados gráficos actualizados al instante conforme llegan los votos.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportCsv}
            className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 transition-colors inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Descargar CSV
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="min-h-[40px] px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Exportar JSON
          </button>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Votos emitidos</p>
          <p className="font-mono-tabular text-3xl font-semibold text-slate-900 mt-2">
            {state.totalVotesCast}
          </p>
          <p className="text-xs text-slate-500 mt-1">Acumulado en todas las categorías</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Familiares registrados</p>
          <p className="font-mono-tabular text-3xl font-semibold text-slate-900 mt-2">
            {state.registeredVotersCount}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {state.connectedVotersCount} conectados ahora
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Tasa de participación</p>
          <p className="font-mono-tabular text-3xl font-semibold text-slate-900 mt-2">
            {participationRate}%
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            Sobre {possibleVotes} votos posibles
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Ganadores revelados</p>
          <p className="font-mono-tabular text-3xl font-semibold text-slate-900 mt-2">
            {revealedCount}/{state.categories.length}
          </p>
          <p className="text-xs text-slate-500 mt-1">Categorías anunciadas en pantalla</p>
        </div>
      </div>

      {/* Top Graphical Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SVG Column Chart: Votes per Category */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Participación por categoría
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Comparativa de votos recibidos en cada premio
            </p>
          </div>

          {state.categories.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">
              Agrega categorías para visualizar la gráfica.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="h-48 flex items-end gap-3 pt-4 border-b border-slate-200">
                {state.categories.map((cat, idx) => {
                  const pctHeight = Math.round((cat.totalVotes / maxCategoryVotes) * 100);
                  return (
                    <div
                      key={cat.id}
                      className="flex-1 h-full flex flex-col items-center justify-end gap-2 min-w-0"
                    >
                      <span className="font-mono-tabular text-xs font-semibold text-slate-700">
                        {cat.totalVotes}
                      </span>
                      <div className="w-full max-w-[56px] flex-1 flex items-end">
                        <div
                          className="w-full rounded-t-md transition-all duration-500"
                          style={{
                            height: `${Math.max(pctHeight, cat.totalVotes > 0 ? 10 : 3)}%`,
                            backgroundColor: cat.isVotingOpen ? '#16A34A' : '#D97706',
                          }}
                          title={`${cat.title}: ${cat.totalVotes} votos`}
                        />
                      </div>
                      <span className="text-[11px] font-mono-tabular text-slate-500 pb-1">
                        C{idx + 1}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600">
                {state.categories.map((cat, idx) => (
                  <div key={cat.id} className="flex items-center gap-2 truncate">
                    <span className="font-mono-tabular font-semibold text-slate-800">
                      C{idx + 1}:
                    </span>
                    <span className="truncate">{cat.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Live Timeline SVG Chart */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Ritmo de votación en vivo
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Votos registrados por minuto durante la ceremonia
            </p>
          </div>

          {state.timeline.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
              Aún no hay votos emitidos para graficar la línea temporal.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="h-48 flex items-end gap-2 pt-4 border-b border-slate-200">
                {state.timeline.map((pt) => {
                  const h = Math.round((pt.count / maxTimelineCount) * 100);
                  return (
                    <div
                      key={pt.timestamp}
                      className="flex-1 h-full flex flex-col items-center justify-end gap-1.5 min-w-[24px]"
                    >
                      <span className="font-mono-tabular text-[11px] font-medium text-slate-700">
                        {pt.count}
                      </span>
                      <div className="w-full max-w-[36px] flex-1 flex items-end">
                        <div
                          className="w-full rounded-t bg-slate-800 transition-all duration-300"
                          style={{ height: `${Math.max(h, 12)}%` }}
                        />
                      </div>
                      <span className="font-mono-tabular text-[10px] text-slate-500 pb-1">
                        {pt.minuteLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-slate-500">
                Últimos {state.timeline.length} intervalos con actividad de voto
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Category-by-Category Graphical Breakdown */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Resultados detallados por categoría
          </h2>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                categoryFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Todas
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('open')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                categoryFilter === 'open'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Abiertas
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('revealed')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                categoryFilter === 'revealed'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Reveladas
            </button>
          </div>
        </div>

        {filteredCategories.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            No hay categorías que coincidan con este filtro.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {filteredCategories.map((cat) => {
              const maxVotes = Math.max(0, ...cat.nominees.map((n) => n.votes));
              const sortedNominees = [...cat.nominees].sort((a, b) => b.votes - a.votes);
              return (
                <div
                  key={cat.id}
                  className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
                >
                  <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-100">
                    <div className="min-w-0">
                      <h3 className="font-display text-lg font-semibold text-slate-900 truncate">
                        {cat.title}
                      </h3>
                      <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                        <span className={cat.isVotingOpen ? 'text-emerald-700 font-medium' : 'text-slate-500'}>
                          {cat.isVotingOpen ? 'Votación abierta' : 'Votación cerrada'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">{cat.totalVotes} votos</span>
                        {cat.isWinnerRevealed && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-700 font-medium">Ganador revelado</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3.5">
                    {sortedNominees.map((nom) => {
                      const isLeader = maxVotes > 0 && nom.votes === maxVotes;
                      return (
                        <div key={nom.id} className="space-y-1.5">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span
                              className={`truncate ${
                                isLeader ? 'font-semibold text-slate-900' : 'text-slate-700'
                              }`}
                            >
                              {nom.name}
                              {isLeader ? ' (Líder)' : ''}
                            </span>
                            <span className="font-mono-tabular text-xs font-medium text-slate-700 shrink-0">
                              {nom.votes} ({nom.percentage.toFixed(1)}%)
                            </span>
                          </div>
                          <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.max(nom.percentage, nom.votes > 0 ? 3 : 0)}%`,
                                backgroundColor: nom.accentColor || '#D97706',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Registered Voters Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Participación de invitados
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Conteo de votos emitidos por cada familiar conectado
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="text"
              value={voterSearch}
              onChange={(e) => setVoterSearch(e.target.value)}
              placeholder="Buscar invitado..."
              aria-label="Buscar invitado"
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-700"
            />
          </div>
        </div>

        {filteredVoters.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            {state.voters.length === 0
              ? 'Aún no hay familiares registrados desde sus dispositivos.'
              : 'Ningún participante coincide con tu búsqueda.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-5">Participante</th>
                  <th className="py-2.5 px-5 text-right">Categorías votadas</th>
                  <th className="py-2.5 px-5 text-right">Último voto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredVoters.map((v) => (
                  <tr key={v.voterId} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-5 font-medium text-slate-900">{v.voterName}</td>
                    <td className="py-2.5 px-5 text-right font-mono-tabular text-slate-700">
                      {v.votesCount} / {state.categories.length}
                    </td>
                    <td className="py-2.5 px-5 text-right font-mono-tabular text-xs text-slate-500">
                      {v.lastVotedAt
                        ? new Date(v.lastVotedAt).toLocaleTimeString('es-MX', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Sin votos aún'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
