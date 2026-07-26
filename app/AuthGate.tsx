"use client";

import { useEffect, useState } from "react";
import { AccessRequiredPage } from "./Login";
import { MemoryHome } from "./MemoryHome";

export function AuthGate() {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function authenticate() {
      const url = new URL(window.location.href);
      const ticket = url.searchParams.get("portal_ticket");
      if (ticket) {
        url.searchParams.delete("portal_ticket");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }

      try {
        const response = ticket
          ? await fetch("/api/portal/exchange", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ticket }),
            })
          : await fetch("/api/portal/session", { cache: "no-store" });
        const result = (await response.json()) as { message?: string };
        if (!response.ok) {
          throw new Error(result.message || "请从微信小程序重新获取访问链接");
        }
        if (active) setLoggedIn(true);
      } catch (caught) {
        if (active) {
          setLoggedIn(false);
          setError(caught instanceof Error ? caught.message : "登录失败，请稍后重试");
        }
      } finally {
        if (active) setReady(true);
      }
    }

    void authenticate();
    return () => {
      active = false;
    };
  }, []);

  if (!ready) {
    return <AccessRequiredPage loading />;
  }

  if (!loggedIn) {
    return <AccessRequiredPage error={error} />;
  }

  return <MemoryHome />;
}
