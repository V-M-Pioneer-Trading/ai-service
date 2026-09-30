import { M2MTokenError, M2MTokenErrorKind, M2MTokenSource } from "@v-m-pioneer-trading/introspection-client";
import { fetchStartupToken } from "../startupToken";

const SECRET = "caller-secret-value";
const TOKEN = "jwt-token-value";

function failing(err: unknown): M2MTokenSource {
  return {
    getToken: async () => {
      throw err;
    },
  };
}

function recorder() {
  const lines: string[] = [];
  return { lines, log: { error: (m: string) => lines.push(m), warn: (m: string) => lines.push(m) } };
}

describe("fetchStartupToken", () => {
  it("is ok when a token is fetched, and logs nothing", async () => {
    const { lines, log } = recorder();
    expect(await fetchStartupToken({ getToken: async () => TOKEN }, log)).toBe("ok");
    expect(lines).toEqual([]);
  });

  it("reports unknown-caller so the caller can exit, with one error line", async () => {
    const { lines, log } = recorder();
    const outcome = await fetchStartupToken(failing(new M2MTokenError("unknown-caller", "rejected")), log);
    expect(outcome).toBe("unknown-caller");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/did not recognise this caller/);
  });

  it.each<M2MTokenErrorKind>(["unavailable", "malformed"])("continues on %s with one warning line naming the kind and message", async (kind) => {
    const { lines, log } = recorder();
    expect(await fetchStartupToken(failing(new M2MTokenError(kind, "center timed out")), log)).toBe("unavailable");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(kind);
    expect(lines[0]).toContain("center timed out");
  });

  it("logs only the name of an error that is not an M2MTokenError", async () => {
    const { lines, log } = recorder();
    expect(await fetchStartupToken(failing(new TypeError(`secret ${SECRET} token ${TOKEN}`)), log)).toBe("unavailable");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("TypeError");
    expect(lines[0]).not.toContain(SECRET);
    expect(lines[0]).not.toContain(TOKEN);
  });

  it("does not log the token or secret on success or unknown-caller", async () => {
    const { lines, log } = recorder();
    await fetchStartupToken(failing(new M2MTokenError("unknown-caller", "rejected")), log);
    await fetchStartupToken({ getToken: async () => TOKEN }, log);
    const all = lines.join("\n");
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(TOKEN);
  });
});
