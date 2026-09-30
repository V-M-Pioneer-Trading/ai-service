import { configFromEnv } from "../config";

const REQUIRED = {
  AUTOMATION_SERVICE_URL: "http://automation.test/api/automation/v1",
  OPENAI_API_KEY: "sk-test",
  AUTH_M2M_TOKEN_URL: "http://localhost:3005/auth/v1/m2m-token",
  AUTH_M2M_CALLER_SECRET: "caller-secret",
};

describe("configFromEnv", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, REQUIRED);
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("reads the machine-token settings", () => {
    const config = configFromEnv();
    expect(config.authM2mTokenUrl).toBe(REQUIRED.AUTH_M2M_TOKEN_URL);
    expect(config.authM2mCallerSecret).toBe(REQUIRED.AUTH_M2M_CALLER_SECRET);
  });

  it.each(["AUTH_M2M_TOKEN_URL", "AUTH_M2M_CALLER_SECRET"])("fails loudly when %s is unset", (name) => {
    delete process.env[name];
    expect(() => configFromEnv()).toThrow(`${name} must be set`);
  });

  it.each(["AUTH_M2M_TOKEN_URL", "AUTH_M2M_CALLER_SECRET"])("fails loudly when %s is empty", (name) => {
    process.env[name] = "";
    expect(() => configFromEnv()).toThrow(`${name} must be set`);
  });
});
