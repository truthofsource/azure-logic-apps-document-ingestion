import assert from "node:assert/strict";
import test from "node:test";

import type {
  GmailClassifierRule,
} from "./inboundgmailmessageplan.ts";

import {
  inboundGmailMaximumAttachmentBytes,
  inboundGmailMessagePlanRole,
  inboundGmailMessagePlanRoute,
  loadGmailClassifierRulesFromEnvironment,
  planInboundGmailMessage,
} from "./inboundgmailmessageplan.ts";

const backgroundRule:
GmailClassifierRule = {
  sourceClassifier:
    "background_check",
  classifierRuleVersion:
    "background-check-v1",
  approvedSenderAddresses: [
    "reports@vendor.test",
  ],
  approvedSenderDomains: [],
  requiredFilenameTokens: [
    "background",
    "check",
  ],
};

const mcoRule:
GmailClassifierRule = {
  sourceClassifier:
    "mco_authorization",
  classifierRuleVersion:
    "mco-authorization-v1",
  approvedSenderAddresses: [],
  approvedSenderDomains: [
    "authorizations.mco.test",
  ],
  requiredFilenameTokens: [
    "authorization",
  ],
};

function message(
  overrides:
    Record<string, unknown> = {}
) {
  return {
    id:
      "message-123",
    threadId:
      "thread-123",
    internalDate:
      "1786464000000",
    payload: {
      mimeType:
        "multipart/mixed",
      headers: [
        {
          name: "From",
          value:
            "Vendor Reports <reports@vendor.test>",
        },
        {
          name: "Subject",
          value:
            "Sensitive subject must not be returned",
        },
      ],
      parts: [
        {
          mimeType:
            "text/plain",
          filename: "",
          body: {
            size: 29,
            data:
              "sensitive-body-data",
          },
        },
        {
          mimeType:
            "multipart/alternative",
          filename: "",
          parts: [
            {
              mimeType:
                "application/pdf",
              filename:
                "employee-background-check.pdf",
              body: {
                attachmentId:
                  "attachment-123",
                size: 4096,
              },
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

test(
  "uses the dedicated ingestion role and planner route",
  () => {
    assert.equal(
      inboundGmailMessagePlanRole,
      "Workforce.IngestionWriter"
    );

    assert.equal(
      inboundGmailMessagePlanRoute,
      "inbound-gmail-message-plan"
    );
  }
);

test(
  "recursively discovers a nested PDF and returns only minimal descriptor data",
  () => {
    const result =
      planInboundGmailMessage(
        message(),
        [
          backgroundRule,
          mcoRule,
        ]
      );

    assert.equal(
      result
        .eligibleAttachments
        .length,
      1
    );

    assert.deepEqual(
      result
        .eligibleAttachments[0],
      {
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
          "reports@vendor.test",
        receivedAtUtc:
          new Date(
            1786464000000
          ).toISOString(),
        originalFileName:
          "employee-background-check.pdf",
        contentType:
          "application/pdf",
        sizeBytes: 4096,
      }
    );

    const serialized =
      JSON.stringify(result);

    assert.equal(
      serialized.includes(
        "Sensitive subject"
      ),
      false
    );

    assert.equal(
      serialized.includes(
        "sensitive-body-data"
      ),
      false
    );

    assert.equal(
      serialized.includes(
        "data"
      ),
      false
    );
  }
);

test(
  "rejects an MCO authorization PNG even when sender and classifier signals match",
  () => {
    const input =
      message({
        payload: {
          headers: [
            {
              name: "From",
              value:
                "authorizations@authorizations.mco.test",
            },
          ],
          parts: [
            {
              mimeType:
                "image/png",
              filename:
                "member-authorization.png",
              body: {
                attachmentId:
                  "mco-attachment-png",
                size: 2048,
              },
            },
          ],
        },
      });
    const result = planInboundGmailMessage(input, [backgroundRule, mcoRule]);
    assert.equal(result.eligibleAttachments.length, 0);
  }
);

test(
  "rejects an MCO authorization JPEG even when sender and classifier signals match",
  () => {
    const input =
      message({
        payload: {
          headers: [
            {
              name: "From",
              value:
                "authorizations@authorizations.mco.test",
            },
          ],
          parts: [
            {
              mimeType:
                "image/jpeg",
              filename:
                "member-authorization.jpg",
              body: {
                attachmentId:
                  "mco-attachment-jpeg",
                size: 2048,
              },
            },
          ],
        },
      });
    const result = planInboundGmailMessage(input, [backgroundRule, mcoRule]);
    assert.equal(result.eligibleAttachments.length, 0);
  }
);

test(
  "accepts an MCO authorization PDF when sender and classifier signals match",
  () => {
    const input =
      message({
        payload: {
          headers: [
            {
              name: "From",
              value:
                "authorizations@authorizations.mco.test",
            },
          ],
          parts: [
            {
              mimeType:
                "application/pdf",
              filename:
                "member-authorization.pdf",
              body: {
                attachmentId:
                  "mco-attachment-pdf",
                size: 2048,
              },
            },
          ],
        },
      });
    const result = planInboundGmailMessage(input, [backgroundRule, mcoRule]);
    assert.equal(result.eligibleAttachments.length, 1);
    assert.equal(result.eligibleAttachments[0]?.sourceClassifier, "mco_authorization");
    assert.equal(result.eligibleAttachments[0]?.contentType, "application/pdf");
  }
);

test(
  "fails closed when no classifier rule has an approved sender boundary",
  () => {
    const disabled:
      GmailClassifierRule = {
        ...backgroundRule,
        approvedSenderAddresses: [],
        approvedSenderDomains: [],
      };

    const result =
      planInboundGmailMessage(
        message(),
        [disabled]
      );

    assert.deepEqual(
      result,
      {
        eligibleAttachments: [],
      }
    );
  }
);

test(
  "fails closed when two configured rules both match the same attachment",
  () => {
    const ambiguous:
      GmailClassifierRule = {
        sourceClassifier:
          "mco_authorization",
        classifierRuleVersion:
          "mco-authorization-v1",
        approvedSenderAddresses: [
          "reports@vendor.test",
        ],
        approvedSenderDomains: [],
        requiredFilenameTokens: [
          "background",
          "check",
        ],
      };

    const result =
      planInboundGmailMessage(
        message(),
        [
          backgroundRule,
          ambiguous,
        ]
      );

    assert.equal(
      result
        .eligibleAttachments
        .length,
      0
    );
  }
);

test(
  "rejects MIME and filename-extension contradictions",
  () => {
    const input =
      message({
        payload: {
          headers: [
            {
              name: "From",
              value:
                "reports@vendor.test",
            },
          ],
          parts: [
            {
              mimeType:
                "application/pdf",
              filename:
                "employee-background-check.png",
              body: {
                attachmentId:
                  "attachment-123",
                size: 1024,
              },
            },
          ],
        },
      });

    const result =
      planInboundGmailMessage(
        input,
        [backgroundRule]
      );

    assert.equal(
      result
        .eligibleAttachments
        .length,
      0
    );
  }
);

test(
  "rejects unsupported attachment MIME types",
  () => {
    const input =
      message({
        payload: {
          headers: [
            {
              name: "From",
              value:
                "reports@vendor.test",
            },
          ],
          parts: [
            {
              mimeType:
                "application/zip",
              filename:
                "employee-background-check.zip",
              body: {
                attachmentId:
                  "attachment-123",
                size: 1024,
              },
            },
          ],
        },
      });

    const result =
      planInboundGmailMessage(
        input,
        [backgroundRule]
      );

    assert.equal(
      result
        .eligibleAttachments
        .length,
      0
    );
  }
);

test(
  "rejects filename-less inline content even when a body is present",
  () => {
    const input =
      message({
        payload: {
          headers: [
            {
              name: "From",
              value:
                "reports@vendor.test",
            },
          ],
          parts: [
            {
              mimeType:
                "image/png",
              filename: "",
              body: {
                attachmentId:
                  "inline-1",
                size: 1024,
              },
            },
          ],
        },
      });

    const result =
      planInboundGmailMessage(
        input,
        [backgroundRule]
      );

    assert.equal(
      result
        .eligibleAttachments
        .length,
      0
    );
  }
);

test(
  "rejects an attachment above the 20 MiB boundary",
  () => {
    const input =
      message({
        payload: {
          headers: [
            {
              name: "From",
              value:
                "reports@vendor.test",
            },
          ],
          parts: [
            {
              mimeType:
                "application/pdf",
              filename:
                "employee-background-check.pdf",
              body: {
                attachmentId:
                  "attachment-123",
                size:
                  inboundGmailMaximumAttachmentBytes +
                  1,
              },
            },
          ],
        },
      });

    const result =
      planInboundGmailMessage(
        input,
        [backgroundRule]
      );

    assert.equal(
      result
        .eligibleAttachments
        .length,
      0
    );
  }
);

test(
  "rejects attachment metadata without an external Gmail attachment ID",
  () => {
    const input =
      message({
        payload: {
          headers: [
            {
              name: "From",
              value:
                "reports@vendor.test",
            },
          ],
          parts: [
            {
              mimeType:
                "application/pdf",
              filename:
                "employee-background-check.pdf",
              body: {
                size: 4096,
                data:
                  "inline-data-is-not-an-external-attachment",
              },
            },
          ],
        },
      });

    const result =
      planInboundGmailMessage(
        input,
        [backgroundRule]
      );

    assert.equal(
      result
        .eligibleAttachments
        .length,
      0
    );
  }
);

test(
  "fails closed on an absent sender header or invalid Gmail internalDate",
  () => {
    const noSender =
      message({
        payload: {
          headers: [],
          parts: [],
        },
      });

    assert.deepEqual(
      planInboundGmailMessage(
        noSender,
        [backgroundRule]
      ),
      {
        eligibleAttachments: [],
      }
    );

    assert.deepEqual(
      planInboundGmailMessage(
        message({
          internalDate:
            "not-an-epoch-ms",
        }),
        [backgroundRule]
      ),
      {
        eligibleAttachments: [],
      }
    );
  }
);

test(
  "rejects a non-object Gmail message contract",
  () => {
    assert.throws(
      () =>
        planInboundGmailMessage(
          "not-an-object",
          [backgroundRule]
        ),
      /must be an object/
    );
  }
);

test(
  "matches an exact sender with an any-of transient subject signal group",
  () => {
    const signalRule:
      GmailClassifierRule = {
        sourceClassifier:
          "mco_authorization",
        classifierRuleVersion:
          "mco-signal-v1",
        approvedSenderAddresses: [
          "signing@delivery.test",
        ],
        approvedSenderDomains: [],
        requiredFilenameTokens: [],
        requiredMessageSignalGroups: [
          [
            "service summary",
            "choices plan",
          ],
        ],
      };

    const input =
      message({
        payload: {
          mimeType:
            "multipart/mixed",
          headers: [
            {
              name: "From",
              value:
                "signing@delivery.test",
            },
            {
              name: "Subject",
              value:
                "Completed CHOICES PLAN 080926",
            },
          ],
          parts: [
            {
              mimeType:
                "application/pdf",
              filename:
                "document.pdf",
              body: {
                attachmentId:
                  "signal-attachment-1",
                size: 2048,
              },
            },
          ],
        },
      });

    const result =
      planInboundGmailMessage(
        input,
        [signalRule]
      );

    assert.equal(
      result
        .eligibleAttachments
        .length,
      1
    );

    assert.equal(
      JSON
        .stringify(result)
        .includes(
          "CHOICES PLAN"
        ),
      false
    );
  }
);

test(
  "matches a transient inline body signal without returning body content",
  () => {
    const signalRule:
      GmailClassifierRule = {
        sourceClassifier:
          "mco_authorization",
        classifierRuleVersion:
          "mco-body-signal-v1",
        approvedSenderAddresses: [
          "signing@delivery.test",
        ],
        approvedSenderDomains: [],
        requiredFilenameTokens: [],
        requiredMessageSignalGroups: [
          [
            "ltss authorization team",
          ],
        ],
      };

    const sensitiveBody =
      "LTSS Authorization Team private-message-marker";

    const input =
      message({
        payload: {
          mimeType:
            "multipart/mixed",
          headers: [
            {
              name: "From",
              value:
                "signing@delivery.test",
            },
          ],
          parts: [
            {
              mimeType:
                "text/plain",
              filename: "",
              body: {
                size:
                  sensitiveBody.length,
                data:
                  Buffer
                    .from(
                      sensitiveBody,
                      "utf8"
                    )
                    .toString(
                      "base64url"
                    ),
              },
            },
            {
              mimeType:
                "application/pdf",
              filename:
                "document.pdf",
              body: {
                attachmentId:
                  "signal-attachment-2",
                size: 2048,
              },
            },
          ],
        },
      });

    const result =
      planInboundGmailMessage(
        input,
        [signalRule]
      );

    assert.equal(
      result
        .eligibleAttachments
        .length,
      1
    );

    assert.equal(
      JSON
        .stringify(result)
        .includes(
          "private-message-marker"
        ),
      false
    );
  }
);

test(
  "requires one alternative from every transient message signal group",
  () => {
    const domainRule:
      GmailClassifierRule = {
        sourceClassifier:
          "mco_authorization",
        classifierRuleVersion:
          "mco-domain-groups-v1",
        approvedSenderAddresses: [],
        approvedSenderDomains: [
          "payer.test",
        ],
        requiredFilenameTokens: [],
        requiredMessageSignalGroups: [
          [
            "program marker",
            "ltss",
          ],
          [
            "ongoing auth",
            "pc initiate",
          ],
        ],
      };

    const body =
      "Program Marker for authorized services";

    const matchingInput =
      message({
        payload: {
          mimeType:
            "multipart/mixed",
          headers: [
            {
              name: "From",
              value:
                "specialist@payer.test",
            },
            {
              name: "Subject",
              value:
                "ONGOING AUTH 12.22.21",
            },
          ],
          parts: [
            {
              mimeType:
                "text/plain",
              filename: "",
              body: {
                size:
                  body.length,
                data:
                  Buffer
                    .from(
                      body,
                      "utf8"
                    )
                    .toString(
                      "base64url"
                    ),
              },
            },
            {
              mimeType:
                "application/pdf",
              filename:
                "updated-document.pdf",
              body: {
                attachmentId:
                  "signal-attachment-3",
                size: 2048,
              },
            },
          ],
        },
      });

    const incompleteInput =
      message({
        payload: {
          mimeType:
            "multipart/mixed",
          headers: [
            {
              name: "From",
              value:
                "specialist@payer.test",
            },
            {
              name: "Subject",
              value:
                "General LTSS correspondence",
            },
          ],
          parts: [
            {
              mimeType:
                "application/pdf",
              filename:
                "general-document.pdf",
              body: {
                attachmentId:
                  "signal-attachment-4",
                size: 2048,
              },
            },
          ],
        },
      });

    assert.equal(
      planInboundGmailMessage(
        matchingInput,
        [domainRule]
      ).eligibleAttachments.length,
      1
    );

    assert.equal(
      planInboundGmailMessage(
        incompleteInput,
        [domainRule]
      ).eligibleAttachments.length,
      0
    );
  }
);

test(
  "does not classify a transient signal from an unrelated sender",
  () => {
    const signalRule:
      GmailClassifierRule = {
        sourceClassifier:
          "mco_authorization",
        classifierRuleVersion:
          "mco-sender-gate-v1",
        approvedSenderAddresses: [
          "approved@delivery.test",
        ],
        approvedSenderDomains: [],
        requiredFilenameTokens: [],
        requiredMessageSignalGroups: [
          [
            "strong authorization marker",
          ],
        ],
      };

    const body =
      "strong authorization marker";

    const input =
      message({
        payload: {
          mimeType:
            "multipart/mixed",
          headers: [
            {
              name: "From",
              value:
                "unrelated@example.test",
            },
          ],
          parts: [
            {
              mimeType:
                "text/plain",
              filename: "",
              body: {
                size:
                  body.length,
                data:
                  Buffer
                    .from(
                      body,
                      "utf8"
                    )
                    .toString(
                      "base64url"
                    ),
              },
            },
            {
              mimeType:
                "application/pdf",
              filename:
                "document.pdf",
              body: {
                attachmentId:
                  "signal-attachment-5",
                size: 2048,
              },
            },
          ],
        },
      });

    assert.equal(
      planInboundGmailMessage(
        input,
        [signalRule]
      ).eligibleAttachments.length,
      0
    );
  }
);

test(
  "loads generic numbered MCO profiles and grouped message signals from environment",
  () => {
    const keys = [
      "GMAIL_MCO_AUTHORIZATION_PROFILE_1_RULE_VERSION",
      "GMAIL_MCO_AUTHORIZATION_PROFILE_1_APPROVED_SENDERS",
      "GMAIL_MCO_AUTHORIZATION_PROFILE_1_APPROVED_DOMAINS",
      "GMAIL_MCO_AUTHORIZATION_PROFILE_1_FILENAME_TOKENS",
      "GMAIL_MCO_AUTHORIZATION_PROFILE_1_MESSAGE_SIGNAL_GROUPS",
    ];

    const previous =
      Object.fromEntries(
        keys.map(
          (key) => [
            key,
            process.env[key],
          ]
        )
      );

    try {
      process.env[
        "GMAIL_MCO_AUTHORIZATION_PROFILE_1_RULE_VERSION"
      ] =
        "profile-one-v1";
      process.env[
        "GMAIL_MCO_AUTHORIZATION_PROFILE_1_APPROVED_SENDERS"
      ] =
        "signing@delivery.test";
      process.env[
        "GMAIL_MCO_AUTHORIZATION_PROFILE_1_APPROVED_DOMAINS"
      ] =
        "";
      process.env[
        "GMAIL_MCO_AUTHORIZATION_PROFILE_1_FILENAME_TOKENS"
      ] =
        "";
      process.env[
        "GMAIL_MCO_AUTHORIZATION_PROFILE_1_MESSAGE_SIGNAL_GROUPS"
      ] =
        "phrase one|phrase two;auth one|auth two";

      const loaded =
        loadGmailClassifierRulesFromEnvironment();

      const profile =
        loaded.find(
          (rule) =>
            rule
              .classifierRuleVersion ===
            "profile-one-v1"
        );

      assert.deepEqual(
        profile
          ?.requiredMessageSignalGroups,
        [
          [
            "phrase one",
            "phrase two",
          ],
          [
            "auth one",
            "auth two",
          ],
        ]
      );

      assert.deepEqual(
        profile
          ?.approvedSenderAddresses,
        [
          "signing@delivery.test",
        ]
      );
    } finally {
      for (const key of keys) {
        const value =
          previous[key];

        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] =
            value;
        }
      }
    }
  }
);
