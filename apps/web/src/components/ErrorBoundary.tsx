import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  /** Changing this value clears a caught error (e.g. the route or session changed). */
  resetKey?: unknown;
  fallback: (error: Error, reset: () => void) => ReactNode;
  children: ReactNode;
}

interface State {
  error: Error | null;
  key: unknown;
}

/**
 * Catches a render error in one part of the app so the rest keeps working: a crash in one page never
 * blanks the shell, the status bar or the connection. Nothing is reported anywhere; the error stays in
 * the browser console and in the fallback's technical details.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { key: props.resetKey, error: null } : null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('OpenKey: a page failed to render', error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error, () => this.setState({ error: null })) : this.props.children;
  }
}
