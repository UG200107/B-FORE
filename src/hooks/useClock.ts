"use client";

import { useSyncExternalStore } from "react";
import { dateKeyOf } from "@/utils/daily";

function subscribeMinute(listener: () => void): () => void {
  const id = window.setInterval(listener, 30_000);
  return () => window.clearInterval(id);
}

/** Current minute (ms timestamp floored to the minute); 0 on the server. */
export function useMinute(): number {
  return useSyncExternalStore(
    subscribeMinute,
    () => Math.floor(Date.now() / 60_000) * 60_000,
    () => 0,
  );
}

/** Today's local "YYYY-MM-DD", or "" during server rendering. Rolls over at midnight. */
export function useDateKey(): string {
  return useSyncExternalStore(
    subscribeMinute,
    () => dateKeyOf(new Date()),
    () => "",
  );
}
