import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

/**
 * Holds the signed-in user for the whole app. On first load it asks the
 * server "who am I?" - the browser sends the httpOnly cookie, so the
 * session survives a page refresh without storing anything in
 * localStorage (which JavaScript, and therefore XSS, could read).
 */
const AuthContext = createContext(null);

/**
 * Retries a call while the API is still starting up.
 *
 * These two are the first requests the app makes, and on a cold
 * `npm run dev` they race the API's own start-up: Vite is serving in
 * under a second while Express is still connecting to Supabase, so the
 * proxy refuses the connection.
 *
 * "The API is not up" is not an answer. Reading it as "not signed in"
 * would sign somebody out for opening the page too quickly. So a real
 * reply is taken immediately - including a 401, which genuinely does
 * mean not signed in - and only a non-answer is retried.
 *
 * A non-answer arrives in two shapes, and it has to be both:
 *   - no status at all, when the request never landed. That is what
 *     happens in production, where nothing sits in front of Express.
 *   - a 5xx, because Vite's dev proxy does NOT pass the refused
 *     connection through: it answers 500 itself. Checking only for a
 *     missing status looks right and does nothing at all in dev, which
 *     is the one place this problem shows up.
 */
function isNotAnAnswer(err) {
  return !err.status || err.status >= 500;
}

// About five seconds of waiting. Long enough for Express to finish
// connecting to Supabase on a cold start; short enough that an API that
// really is down still gives up and shows the sign-in page.
async function askUntilTheApiIsUp(call, { attempts = 10, waitMs = 500 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (!isNotAnAnswer(err) || attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      askUntilTheApiIsUp(() => api.me()).catch(() => ({ user: null })),
      askUntilTheApiIsUp(() => api.config()).catch(() => ({})),
    ]).then(
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
