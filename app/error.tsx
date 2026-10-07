"use client";
import { RouteError } from "@client/components/ui/route-error";

export default function RootError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} what="app" main />;
}
