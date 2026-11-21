"use client";

import { useEffect, useSyncExternalStore } from "react";
import { sound } from "@/utils/soundEngine";

const subscribe = (listener: () => void) => sound.subscribe(listener);
const getMuted = () => sound.isMuted();
const getServerMuted = () => false;

/** Creates/resumes the AudioContext on the first user gesture (and any later one). */
export function useAudioUnlock(): void {
  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
    };
  }, []);
}

/** Persistent mute state (localStorage), safe to render on the server. */
export function useMuted(): [boolean, (muted: boolean) => void] {
  const muted = useSyncExternalStore(subscribe, getMuted, getServerMuted);
  return [muted, (m) => sound.setMuted(m)];
}
