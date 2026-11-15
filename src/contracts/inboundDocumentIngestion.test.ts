import assert from "node:assert/strict";
import test from "node:test";

import {
  inboundDocumentOpaqueSourceIdMaxChars,
  parseInboundDocumentIngestionInput,
} from "./inboundDocumentIngestion.ts";

function validInput() {
  return {
    sourceMailboxKey: "operations-inbox",
    sourceClassifier: "background_check",
    classifierRuleVersion: "background-check-v1",
    sourceMessageId: "message-123",
    sourceThreadId: "thread-123",
    sourceAttachmentId: "attachment-123",
    senderAddress: "reports@example.test",
    receivedAtUtc: "2026-08-10T18:00:00Z",
    originalFileName: "background-check.pdf",
    contentType: "application/pdf",
    contentBase64: "JVBERi0xLjQ=",
    correlationId: "correlation-123",
  };
}

test(
  "accepts the generic background-check classifier",
  () => {
    const result =
      parseInboundDocumentIngestionInput(
        validInput()
      );

    assert.equal(
      result.sourceClassifier,
      "background_check"
    );
  }
);

test(
  "accepts the MCO authorization classifier",
  () => {
    const result =
      parseInboundDocumentIngestionInput({
        ...validInput(),
        sourceClassifier:
          "mco_authorization",
      });

    assert.equal(
      result.sourceClassifier,
      "mco_authorization"
    );
  }
);

test(
  "rejects subject and body persistence fields",
  () => {
    assert.throws(
      () =>
        parseInboundDocumentIngestionInput({
          ...validInput(),
          subject:
            "must not be persisted",
          body:
            "must not be persisted",
        }),
      /Unsupported inbound document fields/
    );
  }
);

test(
  "rejects a vendor-specific classifier",
  () => {
    assert.throws(
      () =>
        parseInboundDocumentIngestionInput({
          ...validInput(),
          sourceClassifier:
            "vendor_background_check",
        }),
      /sourceClassifier must be one of/
    );
  }
);


test(
  "accepts a bounded opaque Gmail attachment ID longer than the legacy 200-character limit",
  () => {
    const sourceAttachmentId =
      "A".repeat(512);

    const result =
      parseInboundDocumentIngestionInput({
        ...validInput(),
        sourceAttachmentId,
      });

    assert.equal(
      result.sourceAttachmentId,
      sourceAttachmentId
    );
  }
);

test(
  "rejects an opaque Gmail attachment ID beyond the explicit transport safety cap",
  () => {
    assert.throws(
      () =>
        parseInboundDocumentIngestionInput({
          ...validInput(),
          sourceAttachmentId:
            "A".repeat(
              inboundDocumentOpaqueSourceIdMaxChars + 1
            ),
        }),
      /sourceAttachmentId must be/
    );
  }
);
