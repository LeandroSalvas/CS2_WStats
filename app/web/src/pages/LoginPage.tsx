import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, type ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { BASE } from "../base";

export function LoginPage() {
  const { t } = useTranslation();
  const erro = (code: string): string => {
    const key = `login.errors.${code}`;
    const msg = t(key);
    return msg === key ? t("login.errors.default") : msg;
  };

  const { refresh, me } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const googleEnabled = me?.googleEnabled ?? false;

  // Erros vindos do callback OAuth (?erro=...)
  const params = new URLSearchParams(location.search);
  const erroParam = params.get("erro");
  if (erroParam && !error) {
    setError(erro(erroParam));
    navigate(location.pathname, { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.loginLocal(username.trim(), password);
      setPassword("");
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      const status = (err as ApiError | undefined)?.status;
      setError(
        status === 401 ? t("login.wrongCredentials") : t("login.genericError")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={(e) => void onSubmit(e)}>
        <div className="login-brand">
          <span className="brand-icon">◎</span> CS2 <em>WStats</em>
        </div>
        <h1>{t("login.title")}</h1>
        <p className="login-sub">{t("login.subtitle")}</p>

        {error && <div className="error-box">⚠ {error}</div>}

        <label className="field">
          <span>{t("login.username")}</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>
        <label className="field">
          <span>{t("login.password")}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? t("login.submitting") : t("login.submit")}
        </button>

        {googleEnabled ? (
          <div className="login-divider">{t("login.or")}</div>
        ) : null}

        {googleEnabled ? (
          <a className="btn-google" href={`${BASE}api/auth/google`}>
            {t("login.googleButton")}
          </a>
        ) : (
          <p className="login-hint">{t("login.googleDisabledHint")}</p>
        )}
      </form>
    </div>
  );
}
