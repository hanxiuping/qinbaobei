"use client";

import { useState, useEffect } from "react";
import { isLoggedIn, LoginPage } from "./Login";
import { MemoryHome } from "./MemoryHome";

export function AuthGate() {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(isLoggedIn());
    setReady(true);
  }, []);

  if (!ready) return null;

  if (!loggedIn) {
    return <LoginPage onLogin={() => setLoggedIn(true)} />;
  }

  return <MemoryHome />;
}
