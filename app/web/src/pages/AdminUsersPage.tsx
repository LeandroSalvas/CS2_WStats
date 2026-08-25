import { useCallback, useEffect, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { api, type AdminUser } from "../api/client";
import { ConfirmModal } from "../components/ConfirmModal";
import { ErrorBox, Spinner } from "../components/ui";

export function AdminUsersPage() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<AdminUser[] | null>(null);
  const [active, setActive] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [removeTarget, setRemoveTarget] = useState<AdminUser | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([api.pendingUsers(), api.activeUsers()]);
      setPending(p.users);
      setActive(a.users);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(id: number, fn: () => Promise<unknown>): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page admin-users-page">
      <h2>{t("users.title")}</h2>
      {error && <ErrorBox message={error} />}

      {/* --------------------------- Pendentes --------------------------- */}
      <section className="panel">
        <h3>{t("users.pendingRequests")}</h3>
        {pending == null ? (
          <Spinner />
        ) : pending.length === 0 ? (
          <p className="muted">{t("users.noPending")}</p>
        ) : (
          <ul className="pending-list">
            {pending.map((u) => (
              <li key={u.id} className="pending-card-row">
                <div className="user-ident">
                  <span className="user-name">{u.name}</span>
                  <span className="user-email">{u.email}</span>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn-small"
                    disabled={busyId === u.id}
                    onClick={() => void act(u.id, () => api.approveUser(u.id, "ADMIN"))}
                  >
                    {t("users.approveAdmin")}
                  </button>
                  <button
                    type="button"
                    className="btn-small btn-super"
                    disabled={busyId === u.id}
                    onClick={() => void act(u.id, () => api.approveUser(u.id, "SUPER_ADMIN"))}
                  >
                    {t("users.approveSuper")}
                  </button>
                  <button
                    type="button"
                    className="btn-small btn-danger-outline"
                    disabled={busyId === u.id}
                    onClick={() => void act(u.id, () => api.rejectUser(u.id))}
                  >
                    {t("users.reject")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------------------- Ativos ---------------------------- */}
      <section className="panel">
        <h3>{t("users.activeUsers")}</h3>
        {active == null ? (
          <Spinner />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("users.colName")}</th>
                <th>{t("users.colEmail")}</th>
                <th>{t("users.colRole")}</th>
                <th aria-label="ações" />
              </tr>
            </thead>
            <tbody>
              {active.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="player-name">{u.name}</span>
                    {u.isLocalAdmin && <span className="tag-admin">{t("users.fixedTag")}</span>}
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <span className={`role-badge role-${u.role.toLowerCase()}`}>
                      {t(`users.role.${u.role}`)}
                    </span>
                  </td>
                  <td className="row-actions">
                    {u.isLocalAdmin ? (
                      <span className="muted">{t("users.protectedLabel")}</span>
                    ) : (
                      <>
                        {u.role === "ADMIN" && (
                          <button
                            type="button"
                            className="btn-small btn-super"
                            disabled={busyId === u.id}
                            onClick={() => void act(u.id, () => api.setUserRole(u.id, "SUPER_ADMIN"))}
                          >
                            {t("users.promote")}
                          </button>
                        )}
                        {u.role === "SUPER_ADMIN" && (
                          <button
                            type="button"
                            className="btn-small"
                            disabled={busyId === u.id}
                            onClick={() => void act(u.id, () => api.setUserRole(u.id, "ADMIN"))}
                          >
                            {t("users.demote")}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-small btn-danger-outline"
                          disabled={busyId === u.id}
                          onClick={() => setRemoveTarget(u)}
                        >
                          {t("users.remove")}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {removeTarget && (
        <ConfirmModal
          title={t("users.removeModalTitle")}
          confirmLabel={t("users.remove")}
          danger
          busy={busyId === removeTarget.id}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => {
            const target = removeTarget;
            setRemoveTarget(null);
            void act(target.id, () => api.deleteUser(target.id));
          }}
        >
          <Trans
            i18nKey="users.removeModalBody"
            values={{ name: removeTarget.name, email: removeTarget.email }}
            components={{ strong: <strong /> }}
          />
        </ConfirmModal>
      )}
    </div>
  );
}
