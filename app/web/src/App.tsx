import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { NavLink } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";
import { RankingPage } from "./pages/RankingPage";
import { PlayerProfilePage } from "./pages/PlayerProfilePage";
import { MatchesPage } from "./pages/MatchesPage";
import { MatchDetailPage } from "./pages/MatchDetailPage";
import { LiveRadarPage } from "./pages/LiveRadarPage";
import { LoginPage } from "./pages/LoginPage";
import { PendingApprovalPage } from "./pages/PendingApprovalPage";
import { AdminRconPage } from "./pages/AdminRconPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { Spinner } from "./components/ui";
import { AuthProvider, isAdmin, isSuperAdmin, useAuth } from "./auth/AuthContext";
import { useTranslation } from "react-i18next";
import { LanguageToggle } from "./components/LanguageToggle";
import type { ReactNode } from "react";

function RequireRole({
  minimum,
  children,
}: {
  minimum: "ADMIN" | "SUPER_ADMIN";
  children: ReactNode;
}) {
  const { me, loading } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();

  if (loading) return <Spinner label={t("common.loading")} />;
  if (!me?.authenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  if (me.role === "PENDENTE") return <Navigate to="/aguardando" replace />;
  if (minimum === "SUPER_ADMIN" && !isSuperAdmin(me)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Bloqueia páginas públicas para pendentes (evita confusão de "conta nova"). */
function PublicGate({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const { t } = useTranslation();
  if (loading) return <Spinner label={t("common.loading")} />;
  if (me?.authenticated && me.role === "PENDENTE") return <Navigate to="/aguardando" replace />;
  return <>{children}</>;
}

function Shell() {
  const { me, loading, logout } = useAuth();
  const { t } = useTranslation();

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-icon">◎</span> CS2 <em>WStats</em>
        </NavLink>
        <nav>
          <NavLink to="/" end>{t("nav.dashboard")}</NavLink>
          <NavLink to="/ranking">{t("nav.ranking")}</NavLink>
          <NavLink to="/partidas">{t("nav.matches")}</NavLink>
          <NavLink to="/ao-vivo" className="nav-live">
            <span className="pulse-dot" /> {t("nav.live")}
          </NavLink>
          {isAdmin(me) && <NavLink to="/admin/rcon">{t("nav.rcon")}</NavLink>}
          {isSuperAdmin(me) && <NavLink to="/admin/usuarios">{t("nav.users")}</NavLink>}
          {loading ? null : !me?.authenticated ? (
            <NavLink to="/login">{t("nav.login")}</NavLink>
          ) : (
            <button type="button" className="nav-logout" onClick={() => void logout()}>
              {t("pending.logout")} ({me.name})
            </button>
          )}
          <LanguageToggle />
        </nav>
      </header>

      <main>
        <Routes>
          {/* Públicas */}
          <Route path="/" element={<PublicGate><DashboardPage /></PublicGate>} />
          <Route path="/ranking" element={<PublicGate><RankingPage /></PublicGate>} />
          <Route path="/jogador/:steamId" element={<PublicGate><PlayerProfilePage /></PublicGate>} />
          <Route path="/partidas" element={<PublicGate><MatchesPage /></PublicGate>} />
          <Route path="/partidas/:id" element={<PublicGate><MatchDetailPage /></PublicGate>} />
          <Route path="/ao-vivo" element={<PublicGate><LiveRadarPage /></PublicGate>} />

          {/* Auth */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/aguardando" element={
            me?.authenticated && me.role === "PENDENTE"
              ? <PendingApprovalPage />
              : <Navigate to="/" replace />
          } />

          {/* Admin */}
          <Route path="/admin/rcon" element={
            <RequireRole minimum="ADMIN"><AdminRconPage /></RequireRole>
          } />
          <Route path="/admin/usuarios" element={
            <RequireRole minimum="SUPER_ADMIN"><AdminUsersPage /></RequireRole>
          } />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <footer className="footer">
        <div>{t("footer.text")}</div>
        <div className="footer-by">{t("footer.by")}</div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
