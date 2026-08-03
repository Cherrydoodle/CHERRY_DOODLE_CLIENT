"use client";

import { useSyncExternalStore } from "react";

/** True while the tab/window is the active, visible one. Server snapshot is
 * true so the statically-prerendered page hydrates without a mismatch. */
export function useDocumentVisible() {
  return useSyncExternalStore(
    (onStoreChange) => {
      document.addEventListener("visibilitychange", onStoreChange);
      return () => document.removeEventListener("visibilitychange", onStoreChange);
    },
    () => document.visibilityState === "visible",
    () => true,
  );
}
