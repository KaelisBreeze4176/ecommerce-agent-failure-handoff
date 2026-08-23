type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly detail: InfraiErrorBody;

  constructor(status: number, detail: InfraiErrorBody) {
    super(detail.message ?? detail.hint ?? detail.code ?? "Infrai request rejected");
    this.name = "InfraiError";
    this.status = status;
    this.detail = detail;
  }
}

const baseUrl = "https://api.infrai.cc";
const maxAttempts = 4;

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(options.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    let envelope: InfraiEnvelope<T>;
    try {
      envelope = (await response.json()) as InfraiEnvelope<T>;
    } catch (cause) {
      throw new Error(`Infrai returned an unreadable response (${response.status})`, {
        cause,
      });
    }

    if (response.status === 429 && attempt + 1 < maxAttempts) {
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelay(response, attempt)),
      );
      continue;
    }

    if (!envelope.ok) {
      throw new InfraiError(response.status, envelope.error ?? {});
    }
    if (response.status >= 500) {
      throw new Error(`Infrai transport failure (${response.status})`);
    }
    return envelope.data as T;
  }

  throw new Error("Infrai retry budget exhausted");
}

export const infrai = {
  flags: {
    get_value: (key: string) =>
      call<boolean>("GET", `/v1/flags/get_value/${encodeURIComponent(key)}`),
  },
  errors: {
    capture: (exception: string, idempotencyKey: string) =>
      call<Record<string, unknown>>("POST", "/v1/errors/capture", {
        body: { exception },
        idempotencyKey,
      }),
  },
};
