export const inboundDocumentSourceClassifiers = [
  "background_check",
  "mco_authorization",
] as const;

export const inboundDocumentOpaqueSourceIdMaxChars =
  8192;

export type InboundDocumentSourceClassifier =
  (typeof inboundDocumentSourceClassifiers)[number];

export interface InboundDocumentIngestionInput {
  sourceMailboxKey: string;
  sourceClassifier: InboundDocumentSourceClassifier;
  classifierRuleVersion: string;
  sourceMessageId: string;
  sourceThreadId: string | null;
  sourceAttachmentId: string;
  senderAddress: string;
  receivedAtUtc: string;
  originalFileName: string;
  contentType: string;
  contentBase64: string;
  correlationId: string;
}

const allowedFields = new Set([
  "sourceMailboxKey",
  "sourceClassifier",
  "classifierRuleVersion",
  "sourceMessageId",
  "sourceThreadId",
  "sourceAttachmentId",
  "senderAddress",
  "receivedAtUtc",
  "originalFileName",
  "contentType",
  "contentBase64",
  "correlationId",
]);

function requireRecord(
  value: unknown
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(
      "Inbound document request must be a JSON object."
    );
  }

  return value as Record<string, unknown>;
}

function rejectUnsupportedFields(
  value: Record<string, unknown>
): void {
  const unsupported = Object.keys(value)
    .filter((key) => !allowedFields.has(key))
    .sort();

  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported inbound document fields: ${unsupported.join(", ")}.`
    );
  }
}

function requireString(
  value: unknown,
  fieldName: string,
  maxLength: number,
  trim = true
): string {
  if (typeof value !== "string") {
    throw new Error(
      `${fieldName} must be a string.`
    );
  }

  const normalized =
    trim ? value.trim() : value;

  if (normalized.length === 0) {
    throw new Error(
      `${fieldName} is required.`
    );
  }

  if (normalized.length > maxLength) {
    throw new Error(
      `${fieldName} must be ${maxLength} characters or fewer.`
    );
  }

  return normalized;
}

function optionalString(
  value: unknown,
  fieldName: string,
  maxLength: number
): string | null {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  return requireString(
    value,
    fieldName,
    maxLength
  );
}

function requireClassifier(
  value: unknown
): InboundDocumentSourceClassifier {
  const classifier = requireString(
    value,
    "sourceClassifier",
    50
  );

  if (
    !inboundDocumentSourceClassifiers.includes(
      classifier as InboundDocumentSourceClassifier
    )
  ) {
    throw new Error(
      `sourceClassifier must be one of: ${inboundDocumentSourceClassifiers.join(", ")}.`
    );
  }

  return classifier as InboundDocumentSourceClassifier;
}

export function parseInboundDocumentIngestionInput(
  input: unknown
): InboundDocumentIngestionInput {
  const body = requireRecord(input);

  rejectUnsupportedFields(body);

  return {
    sourceMailboxKey: requireString(
      body.sourceMailboxKey,
      "sourceMailboxKey",
      200
    ),
    sourceClassifier: requireClassifier(
      body.sourceClassifier
    ),
    classifierRuleVersion: requireString(
      body.classifierRuleVersion,
      "classifierRuleVersion",
      50
    ),
    sourceMessageId: requireString(
      body.sourceMessageId,
      "sourceMessageId",
      200
    ),
    sourceThreadId: optionalString(
      body.sourceThreadId,
      "sourceThreadId",
      200
    ),
    sourceAttachmentId: requireString(
      body.sourceAttachmentId,
      "sourceAttachmentId",
      inboundDocumentOpaqueSourceIdMaxChars
    ),
    senderAddress: requireString(
      body.senderAddress,
      "senderAddress",
      320
    ),
    receivedAtUtc: requireString(
      body.receivedAtUtc,
      "receivedAtUtc",
      64
    ),
    originalFileName: requireString(
      body.originalFileName,
      "originalFileName",
      260
    ),
    contentType: requireString(
      body.contentType,
      "contentType",
      200
    ).toLowerCase(),
    contentBase64: requireString(
      body.contentBase64,
      "contentBase64",
      32 * 1024 * 1024,
      false
    ),
    correlationId: requireString(
      body.correlationId,
      "correlationId",
      100
    ),
  };
}
