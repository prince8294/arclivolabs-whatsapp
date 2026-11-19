import type { MetaWhatsAppCredentials } from "@/lib/whatsapp/config";

type GraphError = {
  message?: unknown;
  code?: unknown;
  error_subcode?: unknown;
  type?: unknown;
};

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

function responseError(status: number, graphError?: GraphError): MetaApiError {
  const metaCode = typeof graphError?.code === "number" ? graphError.code : 0;
  if (status === 429 || [4, 17, 32, 130429].includes(metaCode)) {
    return new MetaApiError("Meta is rate limiting requests. Wait a moment and try again.", "META_RATE_LIMIT", 429);
  }
  if (status === 401 || metaCode === 190) {
    return new MetaApiError("The Meta access token is invalid or expired. Replace it and reconnect.", "META_TOKEN_INVALID", 401);
  }
  if (status === 403 || metaCode === 10 || metaCode === 200) {
    return new MetaApiError("The token does not have permission to access this WhatsApp account.", "META_PERMISSION_DENIED", 403);
  }
  if (status === 404) {
    return new MetaApiError("Meta could not find the specified WhatsApp account or phone number.", "META_RESOURCE_NOT_FOUND", 404);
  }
  if (status >= 500) {
    return new MetaApiError("Meta is temporarily unavailable. Try again shortly.", "META_UNAVAILABLE", 503);
  }
  if (metaCode === 132000) {
    return new MetaApiError("Meta rejected the message because the template variables do not match the approved template.", "META_TEMPLATE_VARIABLE_MISMATCH", 400);
  }
  if (metaCode === 132001) {
    return new MetaApiError("Meta could not find the approved template for the requested name and language.", "META_TEMPLATE_NOT_FOUND", 400);
  }
  if (metaCode === 131026) {
    return new MetaApiError("Meta could not deliver this message to the recipient.", "META_UNDELIVERABLE", 400);
  }
  if (metaCode === 131047) {
    return new MetaApiError("Meta rejected this non-template message because the customer service window is closed.", "META_WINDOW_RESTRICTED", 400);
  }
  if (metaCode === 131049) {
    return new MetaApiError("Meta did not deliver this Marketing message under its engagement safeguards.", "META_MARKETING_RESTRICTED", 400);
  }
  if (metaCode === 100 || metaCode === 803 || (typeof graphError?.error_subcode === "number" && graphError.error_subcode > 0)) {
    return new MetaApiError("Meta rejected the account, phone number, or request configuration.", "META_INVALID_CONFIGURATION", 400);
  }
  return new MetaApiError("Meta rejected the request. Check the credentials and permissions, then try again.", "META_REQUEST_FAILED", 400);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function graphRequest<T>(
  credentials: MetaWhatsAppCredentials,
  path: string,
  options: { method?: "GET" | "POST" | "DELETE"; body?: Record<string, unknown>; retrySafe?: boolean } = {}
): Promise<T> {
  const method = options.method ?? "GET";
  const url = new URL(`https://graph.facebook.com/${credentials.graphApiVersion}/${path}`);
  const attempts = options.retrySafe === false || method !== "GET" ? 1 : 2;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          ...(options.body ? { "Content-Type": "application/json" } : {})
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
        cache: "no-store"
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const graphError =
          isRecord(payload) && isRecord(payload.error) ? (payload.error as GraphError) : undefined;
        const error = responseError(response.status, graphError);
        if (attempt + 1 < attempts && response.status >= 500) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }
        throw error;
      }
      return payload as T;
    } catch (error) {
      if (error instanceof MetaApiError) throw error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        continue;
      }
      if (error instanceof Error && error.name === "AbortError") {
        const message = method === "POST"
          ? "Meta did not confirm the test-message result. Check WhatsApp before sending another test."
          : method === "DELETE"
            ? "Meta did not confirm the deletion result. Refresh the template list before trying again."
          : "The request to Meta timed out. Try again shortly.";
        throw new MetaApiError(message, "META_TIMEOUT", 504);
      }
      const message = method === "POST"
        ? "Meta did not confirm the test-message result. Check WhatsApp before sending another test."
        : method === "DELETE"
          ? "Meta did not confirm the deletion result. Refresh the template list before trying again."
        : "Could not reach Meta. Check the server network and try again.";
      throw new MetaApiError(message, "META_NETWORK_ERROR", 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new MetaApiError("Could not verify the Meta connection.", "META_REQUEST_FAILED", 502);
}

type WabaResponse = { id?: unknown; name?: unknown };
type PhoneNumberResponse = {
  id?: unknown;
  verified_name?: unknown;
  display_phone_number?: unknown;
};
type PhoneNumberListResponse = {
  data?: unknown;
  paging?: { cursors?: { after?: unknown } };
};

export async function verifyMetaConnection(credentials: MetaWhatsAppCredentials) {
  const waba = await graphRequest<WabaResponse>(
    credentials,
    `${encodeURIComponent(credentials.wabaId)}?fields=id,name`
  );
  if (waba.id !== credentials.wabaId) {
    throw new MetaApiError("The access token cannot verify the selected WhatsApp Business Account.", "META_WABA_MISMATCH", 403);
  }

  const phone = await graphRequest<PhoneNumberResponse>(
    credentials,
    `${encodeURIComponent(credentials.phoneNumberId)}?fields=id,verified_name,display_phone_number`
  );
  if (phone.id !== credentials.phoneNumberId) {
    throw new MetaApiError("The selected Phone Number ID could not be verified.", "META_PHONE_MISMATCH", 400);
  }

  let pagePath = `${encodeURIComponent(credentials.wabaId)}/phone_numbers?fields=id&limit=100`;
  let belongsToAccount = false;
  for (let page = 0; page < 10; page += 1) {
    const numberList = await graphRequest<PhoneNumberListResponse>(credentials, pagePath);
    const phoneRecords = Array.isArray(numberList.data) ? numberList.data : [];
    belongsToAccount = phoneRecords.some((item) => isRecord(item) && item.id === credentials.phoneNumberId);
    if (belongsToAccount) break;
    const nextCursor = numberList.paging?.cursors?.after;
    if (typeof nextCursor !== "string" || !nextCursor) break;
    pagePath = `${encodeURIComponent(credentials.wabaId)}/phone_numbers?fields=id&limit=100&after=${encodeURIComponent(nextCursor)}`;
  }
  if (!belongsToAccount) {
    throw new MetaApiError("Meta could not confirm that this Phone Number ID belongs to the selected WhatsApp Business Account.", "META_PHONE_ACCOUNT_MISMATCH", 400);
  }

  return {
    displayName:
      (typeof phone.verified_name === "string" && phone.verified_name) ||
      (typeof waba.name === "string" ? waba.name : ""),
    displayPhoneNumber: typeof phone.display_phone_number === "string" ? phone.display_phone_number : ""
  };
}
