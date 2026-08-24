import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Trans } from "react-i18next";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function PendingApprovalPage() {
  const { t } = useTranslation();
  const { me, refresh } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="login-wrap">
      <div className="login-card pending-card">
        <div className="pending-icon">⏳</div>
        <h1>{t("pending.title")}</h1>
        <p className="login-sub">
          <Trans
            i18nKey="pending.hello"
            values={{ name: me?.name ?? me?.email ?? "" }}
            components={{ strong: <strong /> }}
          />
        </p>

        <div className="pending-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              void (async () => {
                await refresh();
                navigate("/", { replace: true });
              })();
            }}
          >
            {t("pending.verifyAgain")}
          </button>
          <button
            type="button"
              className="btn-ghost"
            onClick={() => {
              void (async () => {
                await api.logout();
                await refresh();
                navigate("/login", { replace: true });
              })();
            }}
          >
            {t("pending.logout")}
          </button>
        </div>
      </div>
    </div>
  );
}
