import {
  createHash,
} from "crypto";

import type {
  InboundDocumentIngestionInput,
} from "../contracts/inboundDocumentIngestion.ts";

export const inboundDocumentQuarantineContainer =
  "gmail-document-quarantine";

export const inboundDocumentMaxBytes =
  20 * 1024 * 1024;

export const inboundDocumentSourceSystem =
  "gmail" as const;

export interface PreparedInboundDocument {
  fileBuffer: Buffer;
  normalizedFileName: string;
  contentType:
    | "application/pdf"
    | "image/jpeg"
    | "image/png";
  senderDomain: string;
  receivedAt: Date;
  attachmentSha256: string;
  sourceAttachmentReference: string;
  idempotencyKey: string;
  blobName: string;
}

function sha256Hex(
  value: string | Buffer
): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

export function buildInboundDocumentSourceAttachmentReference(
  sourceAttachmentId: string
): string {
  return sha256Hex(
    [
      "gmail-attachment-id-v1",
      sourceAttachmentId,
    ].join("|")
  );
}

function sanitizeFileName(
  value: string
): string {
  const leaf =
    value
      .split(/[\\/]/)
      .pop() ?? value;

  const normalizedName =
    leaf
      .replace(
        /[^a-zA-Z0-9._() -]/g,
        "_"
      )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);

  if (!normalizedName) {
    throw new Error(
      "originalFileName must include a usable file name."
    );
  }

  return normalizedName;
}

function decodeBase64(
  value: string
): Buffer {
  const normalized =
    value.replace(/\s+/g, "");

  if (
    normalized.length === 0 ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(
      normalized
    )
  ) {
    throw new Error(
      "contentBase64 must be canonical base64 content."
    );
  }

  const buffer =
    Buffer.from(
      normalized,
      "base64"
    );

  if (
    buffer.length === 0 ||
    buffer.length >
      inboundDocumentMaxBytes
  ) {
    throw new Error(
      `Attachment must be between 1 and ${inboundDocumentMaxBytes} bytes.`
    );
  }

  const roundTrip =
    buffer
      .toString("base64")
      .replace(/=+$/g, "");

  if (
    roundTrip !==
    normalized.replace(/=+$/g, "")
  ) {
    throw new Error(
      "contentBase64 did not decode canonically."
    );
  }

  return buffer;
}

function requireSenderDomain(
  senderAddress: string
): string {
  const match =
    /^[^@\s]+@([^@\s]+)$/.exec(
      senderAddress
    );

  if (!match) {
    throw new Error(
      "senderAddress must contain one valid address."
    );
  }

  const domain =
    match[1].toLowerCase();

  if (
    domain.length > 255 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(
      domain
    ) ||
    !domain.includes(".")
  ) {
    throw new Error(
      "senderAddress domain is invalid."
    );
  }

  return domain;
}

function requireReceivedAt(
  value: string
): Date {
  const timestamp =
    Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw new Error(
      "receivedAtUtc must be a valid timestamp."
    );
  }

  const date = new Date(timestamp);

  if (
    date.getUTCFullYear() < 2000 ||
    date.getUTCFullYear() > 2100
  ) {
    throw new Error(
      "receivedAtUtc is outside the supported range."
    );
  }

  return date;
}

function hasPdfSignature(
  buffer: Buffer
): boolean {
  return (
    buffer.length >= 5 &&
    buffer.subarray(0, 5)
      .equals(
        Buffer.from(
          "%PDF-",
          "ascii"
        )
      )
  );
}

function hasJpegSignature(
  buffer: Buffer
): boolean {
  return (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

function hasPngSignature(
  buffer: Buffer
): boolean {
  const signature =
    Buffer.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
    ]);

  return (
    buffer.length >=
      signature.length &&
    buffer
      .subarray(
        0,
        signature.length
      )
      .equals(signature)
  );
}

function validateContent(
  fileName: string,
  contentType: string,
  buffer: Buffer
): PreparedInboundDocument["contentType"] {
  const lowerName =
    fileName.toLowerCase();

  if (
    contentType ===
      "application/pdf" &&
    lowerName.endsWith(".pdf") &&
    hasPdfSignature(buffer)
  ) {
    return "application/pdf";
  }

  if (
    contentType ===
      "image/jpeg" &&
    (
      lowerName.endsWith(".jpg") ||
      lowerName.endsWith(".jpeg")
    ) &&
    hasJpegSignature(buffer)
  ) {
    return "image/jpeg";
  }

  if (
    contentType ===
      "image/png" &&
    lowerName.endsWith(".png") &&
    hasPngSignature(buffer)
  ) {
    return "image/png";
  }

  throw new Error(
    "Attachment extension, MIME type, and byte signature must agree for PDF, JPEG, or PNG."
  );
}

export function buildInboundDocumentIdempotencyKey(
  input: Pick<
    InboundDocumentIngestionInput,
    | "sourceMailboxKey"
    | "sourceMessageId"
    | "sourceAttachmentId"
  >
): string {
  return sha256Hex(
    [
      "gmail-v1",
      input.sourceMailboxKey,
      input.sourceMessageId,
      input.sourceAttachmentId,
    ].join("|")
  );
}

export function normalizeInboundBlobEtag(
  value: string | undefined
): string {
  if (
    typeof value !== "string"
  ) {
    throw new Error(
      "Blob ETag is invalid."
    );
  }

  let normalized =
    value.trim();

  if (
    normalized.startsWith("W/")
  ) {
    throw new Error(
      "Weak Blob ETags are not accepted."
    );
  }

  const startsQuoted =
    normalized.startsWith('"');
  const endsQuoted =
    normalized.endsWith('"');

  if (startsQuoted !== endsQuoted) {
    throw new Error(
      "Blob ETag has unbalanced quotes."
    );
  }

  if (
    startsQuoted &&
    endsQuoted &&
    normalized.length >= 2
  ) {
    normalized =
      normalized.slice(1, -1);
  }

  if (
    normalized.length === 0 ||
    normalized.length > 160 ||
    /[\r\n"]/u.test(normalized)
  ) {
    throw new Error(
      "Blob ETag is invalid."
    );
  }

  return normalized;
}

export function prepareInboundDocument(
  input:
    InboundDocumentIngestionInput,
  ingestionId: string
): PreparedInboundDocument {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      ingestionId
    )
  ) {
    throw new Error(
      "ingestionId must be a valid GUID."
    );
  }

  const normalizedFileName =
    sanitizeFileName(
      input.originalFileName
    );

  const fileBuffer =
    decodeBase64(
      input.contentBase64
    );

  const contentType =
    validateContent(
      normalizedFileName,
      input.contentType,
      fileBuffer
    );

  const senderDomain =
    requireSenderDomain(
      input.senderAddress
    );

  const receivedAt =
    requireReceivedAt(
      input.receivedAtUtc
    );

  const attachmentSha256 =
    sha256Hex(fileBuffer);

  const sourceAttachmentReference =
    buildInboundDocumentSourceAttachmentReference(
      input.sourceAttachmentId
    );

  const idempotencyKey =
    buildInboundDocumentIdempotencyKey(
      input
    );

  const year =
    String(
      receivedAt.getUTCFullYear()
    );

  const month =
    String(
      receivedAt.getUTCMonth() + 1
    ).padStart(2, "0");

  const blobName =
    [
      "gmail",
      "v1",
      input.sourceClassifier,
      year,
      month,
      ingestionId,
      `${attachmentSha256.slice(0, 16)}-${normalizedFileName}`,
    ].join("/");

  return {
    fileBuffer,
    normalizedFileName,
    contentType,
    senderDomain,
    receivedAt,
    attachmentSha256,
    sourceAttachmentReference,
    idempotencyKey,
    blobName,
  };
}
