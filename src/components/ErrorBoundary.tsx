import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Ocurrió un error inesperado.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Application ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let friendly = 'No se pudo completar la operación en este momento.';
      try {
        const parsed = JSON.parse(this.state.message) as { error?: string };
        if (parsed.error && parsed.error.includes('Missing or insufficient permissions')) {
          friendly =
            'Permisos insuficientes para realizar esta acción. Verifica tu sesión e inténtalo de nuevo.';
        }
      } catch {
        if (this.state.message) friendly = this.state.message;
      }

      return (
        <div className="min-h-screen bg-[#FAF9F6] text-slate-900 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-stone-200 rounded-2xl p-6 space-y-4 text-center">
            <h1 className="font-display text-xl font-semibold text-slate-900">
              Algo salió mal
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">{friendly}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors"
            >
              Recargar página
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
