"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Per-move countdown. Restarts whenever `turnKey` changes (a new move or round), runs only
 * while `active`, pauses while the tab is hidden, and calls `onExpire` once when it hits 0.
 * Returns the seconds left (fractional, for a smooth bar).
 */
export function useTurnTimer(seconds: number, turnKey: string | null, active: boolean, onExpire: () => void) {
  const [left, setLeft] = useState(seconds);
  const [lastKey, setLastKey] = useState(turnKey);
  const expire = useRef(onExpire);
  useEffect(() => {
    expire.current = onExpire;
  });

  // A new turn gets the full time back (adjusting state during render, not in an effect).
  if (turnKey !== lastKey) {
    setLastKey(turnKey);
    setLeft(seconds);
  }

  useEffect(() => {
    if (!active || turnKey === null) return;
    let remaining = seconds * 1000;
    let last = performance.now();
    let fired = false;
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      if (document.hidden) return;
      remaining = Math.max(0, remaining - dt);
      setLeft(remaining / 1000);
      if (remaining === 0 && !fired) {
        fired = true;
        window.clearInterval(id);
        expire.current();
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [turnKey, active, seconds]);

  return left;
}
