"use client";

import { useState, useEffect } from "react";

const AUTH_COOKIE = "album_auth";
const ALLOWED_PHONES = ["18105646680", "18721792292"];

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function isLoggedIn(): boolean {
  return getCookie(AUTH_COOKIE) === "1";
}

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [shaking, setShaking] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = phone.trim();
    if (!/^1\d{10}$/.test(trimmed)) {
      setError("请输入正确的11位手机号");
      triggerShake();
      return;
    }
    if (!ALLOWED_PHONES.includes(trimmed)) {
      setError("该手机号无权访问");
      triggerShake();
      return;
    }
    document.cookie = `${AUTH_COOKIE}=1; path=/; max-age=${365 * 24 * 3600}; SameSite=Lax`;
    onLogin();
  }

  function triggerShake() {
    setShaking(true);
    setTimeout(() => setShaking(false), 400);
  }

  return (
    <div className="login-page">
      <div className={`login-card ${shaking ? "shake" : ""}`}>
        <div className="login-logo">
          <span className="login-avatar">亲</span>
        </div>
        <h1 className="login-title">亲宝贝</h1>
        <p className="login-subtitle">家庭云相册</p>
        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={11}
            placeholder="请输入手机号"
            value={phone}
            onChange={(e) => { setPhone(e.target.value.replace(/\D/g, "").slice(0, 11)); setError(""); }}
            className="login-input"
            autoFocus
          />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="login-btn">进入相册</button>
        </form>
      </div>
    </div>
  );
}
