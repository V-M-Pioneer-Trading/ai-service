import { M2MTokenError, M2MTokenSource } from "@v-m-pioneer-trading/introspection-client";

export type StartupTokenOutcome = "ok" | "unknown-caller" | "unavailable";

/**
 * Fetch the machine token once at startup. A wrong secret is a configuration
 * error the caller should exit on; anything else is the center being slow or
 * down, and the first call that needs a token fetches it again. Logs one line
 * and never the token, the secret or an error's cause.
 */
export async function fetchStartupToken(
  tokens: M2MTokenSource,
  log: { error: (msg: string) => void; warn: (msg: string) => void } = console
): Promise<StartupTokenOutcome> {
  try {
    await tokens.getToken();
    return "ok";
  } catch (err) {
    if (err instanceof M2MTokenError && err.kind === "unknown-caller") {
      log.error("auth-service did not recognise this caller (check AUTH_M2M_CALLER_SECRET); exiting");
      return "unknown-caller";
    }
    const kind = err instanceof M2MTokenError ? err.kind : "error";
    log.warn(`machine token not fetched at startup (${kind}); will retry on first use`);
    return "unavailable";
  }
}
