import assert from "node:assert/strict";
import test from "node:test";

import type {
  InboundDocumentIngestionInput,
} from "../contracts/inboundDocumentIngestion.ts";

import {
  buildInboundDocumentIdempotencyKey,
  buildInboundDocumentSourceAttachmentReference,
  inboundDocumentQuarantineContainer,
  normalizeInboundBlobEtag,
  prepareInboundDocument,
} from "./inboundDocumentRules.ts";

const ingestionId =
  "11111111-1111-4111-8111-111111111111";

function input(
  overrides:
    Partial<InboundDocumentIngestionInput> = {}
): InboundDocumentIngestionInput {
  return {
    sourceMailboxKey:
      "operations-inbox",
    sourceClassifier:
      "background_check",
    classifierRuleVersion:
      "background-check-v1",
    sourceMessageId:
      "message-123",
    sourceThreadId:
      "thread-123",
    sourceAttachmentId:
      "attachment-123",
    senderAddress:
      "reports@example.test",
    receivedAtUtc:
      "2026-08-10T18:00:00Z",
    originalFileName:
      "background-check.pdf",
    contentType:
      "application/pdf",
    contentBase64:
      Buffer.from(
        "%PDF-1.7\nsynthetic",
        "ascii"
      ).toString("base64"),
    correlationId:
      "correlation-123",
    ...overrides,
  };
}

test(
  "uses the generic Gmail quarantine container",
  () => {
    assert.equal(
      inboundDocumentQuarantineContainer,
      "gmail-document-quarantine"
    );
  }
);

test(
  "prepares a PDF with deterministic provenance hashes",
  () => {
    const prepared =
      prepareInboundDocument(
        input(),
        ingestionId
      );

    assert.equal(
      prepared.contentType,
      "application/pdf"
    );

    assert.match(
      prepared.attachmentSha256,
      /^[0-9a-f]{64}$/
    );

    assert.match(
      prepared.idempotencyKey,
      /^[0-9a-f]{64}$/
    );

    assert.match(
      prepared.blobName,
      /^gmail\/v1\/background_check\/2026\/08\//
    );
  }
);

test(
  "idempotency ignores mutable presentation fields",
  () => {
    const first =
      buildInboundDocumentIdempotencyKey(
        input()
      );

    const second =
      buildInboundDocumentIdempotencyKey(
        input({
          originalFileName:
            "different-name.pdf",
          correlationId:
            "different-correlation",
        })
      );

    assert.equal(
      first,
      second
    );
  }
);

test(
  "accepts matching JPEG and PNG signatures",
  () => {
    const jpeg =
      prepareInboundDocument(
        input({
          originalFileName:
            "check.jpg",
          contentType:
            "image/jpeg",
          contentBase64:
            Buffer.from([
              0xff,
              0xd8,
              0xff,
              0x00,
            ]).toString("base64"),
        }),
        ingestionId
      );

    assert.equal(
      jpeg.contentType,
      "image/jpeg"
    );

    const png =
      prepareInboundDocument(
        input({
          originalFileName:
            "authorization.png",
          contentType:
            "image/png",
          contentBase64:
            Buffer.from([
              0x89,
              0x50,
              0x4e,
              0x47,
              0x0d,
              0x0a,
              0x1a,
              0x0a,
              0x00,
            ]).toString("base64"),
        }),
        ingestionId
      );

    assert.equal(
      png.contentType,
      "image/png"
    );
  }
);

test(
  "fails closed when extension, MIME, and signature disagree",
  () => {
    assert.throws(
      () =>
        prepareInboundDocument(
          input({
            originalFileName:
              "background-check.png",
          }),
          ingestionId
        ),
      /must agree/
    );
  }
);


test(
  "normalizes only one balanced outer ETag quote pair",
  () => {
    assert.equal(
      normalizeInboundBlobEtag(
        '"etag-123"'
      ),
      "etag-123"
    );

    assert.throws(
      () =>
        normalizeInboundBlobEtag(
          'W/"etag-123"'
        ),
      /Weak Blob ETags/
    );

    assert.throws(
      () =>
        normalizeInboundBlobEtag(
          '"etag-123'
        ),
      /unbalanced quotes/
    );

    assert.throws(
      () =>
        normalizeInboundBlobEtag(
          'etag"123'
        ),
      /Blob ETag is invalid/
    );
  }
);


test(
  "normalizes a long opaque Gmail attachment ID to a fixed SHA-256 persistence reference",
  () => {
    const sourceAttachmentId =
      "opaque-gmail-attachment-id-".repeat(32);

    const reference =
      buildInboundDocumentSourceAttachmentReference(
        sourceAttachmentId
      );

    assert.match(
      reference,
      /^[0-9a-f]{64}$/u
    );

    const prepared =
      prepareInboundDocument(
        input({
          sourceAttachmentId,
        }),
        ingestionId
      );

    assert.equal(
      prepared.sourceAttachmentReference,
      reference
    );

    assert.notEqual(
      prepared.sourceAttachmentReference,
      sourceAttachmentId
    );

    assert.notEqual(
      buildInboundDocumentIdempotencyKey(
        input({
          sourceAttachmentId,
        })
      ),
      buildInboundDocumentIdempotencyKey(
        input({
          sourceAttachmentId:
            sourceAttachmentId + "-different",
        })
      )
    );
  }
);
