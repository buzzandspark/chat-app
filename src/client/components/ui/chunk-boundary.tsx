"use client";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** What to show instead; by default a small Retry control, so a failed lazy chunk costs one control, not the page. */
  fallback?: ReactNode;
  label?: string;
  /** Called once when the subtree fails, so an owner (a modal entry) can remove itself. */
  onError?: () => void;
  /** Called on Retry, before the subtree mounts again: an owner holding the failure clears it here. */
  onRetry?: () => void;
}

/**
 * A failed lazy chunk or a throwing widget must not take the thread down with it. The boundary offers
 * a retry (its children mount afresh and load the chunk again, see lazy-chunk.ts) and retries by itself
 * when the browser comes back online, the usual reason a chunk failed to load.
 */
export class ChunkBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidMount(): void {
    window.addEventListener("online", this.retryIfFailed);
  }

  override componentWillUnmount(): void {
    window.removeEventListener("online", this.retryIfFailed);
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[boundary] ${this.props.label ?? "widget"} failed`, error, info.componentStack);
    this.props.onError?.();
  }

  private retryIfFailed = () => {
    if (this.state.failed) this.retry();
  };

  private retry = () => {
    this.props.onRetry?.();
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <button type="button" className="touch-target px-2 text-caption text-muted-foreground underline" onClick={this.retry}>
        Menu didn&apos;t load. Retry
      </button>
    );
  }
}
