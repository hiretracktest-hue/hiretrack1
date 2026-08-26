import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

/**
 * Holds the signed-in user for the whole app. On first load it asks the
 * server "who am I?" - the browser sends the httpOnly cookie, so the
 * session survives a page refresh without storing anything in
 * localStorage (which JavaScript, and therefore XSS, could read).
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    Promise.all([api.me().catch(() => ({ user: null })), api.config().catch(() => ({}))]).then(
      ([meResult, configResult]) => {
        if (cancelled) return;
        setUser(meResult.user ?? null);
        setGoogleEnabled(Boolean(configResult.googleEnabled));
        setLoading(false);
      }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      googleEnabled,
      async signIn(credentials) {
        const { user: signedIn } = await api.signIn(credentials);
        setUser(signedIn);
        return signedIn;
      },
      async signOut() {
        await api.signOut();
        setUser(null);
      },
      setUser,
    }),
    [user, loading, googleEnabled]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>.");
  return context;
}
