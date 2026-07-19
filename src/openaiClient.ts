export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export class OpenAiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Thin fetch client for the Chat Completions tool-calling API — no SDK
 * dependency, matching the rest of this codebase's preference for direct
 * fetch clients (see automation-service's gameClients.ts). `baseUrl`
 * overridable so tests point this at a local stub instead of the real API.
 */
export class OpenAiClient {
  constructor(private apiKey: string, private baseUrl: string, private model: string) {}

  async chatCompletion(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ChatMessage> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools,
        tool_choice: "auto",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new OpenAiError(res.status, body || res.statusText);
    }
    const body = (await res.json()) as { choices: { message: ChatMessage }[] };
    const message = body.choices[0]?.message;
    if (message === undefined) throw new OpenAiError(502, "OpenAI response had no choices");
    return message;
  }
}
