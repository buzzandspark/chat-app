"use client";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** What to show instead; by default nothing, so a failed lazy chunk costs one control, not the page. */
  fallback?: ReactNode;
  label?: string;
}

/** A failed lazy chunk or a throwing widget must not take the thread down with it. */
export class ChunkBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[boundary] ${this.props.label ?? "widget"} failed`, error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
