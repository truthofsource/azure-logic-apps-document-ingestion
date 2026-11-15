import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";

import {
  requireApplicationAppRole,
} from "../auth/requireApplicationAppRole.ts";
import type {
  InboundDocumentSourceClassifier,
} from "../contracts/inboundDocumentIngestion.ts";

export const inboundGmailMessagePlanRole =
  "Workforce.IngestionWriter";

export const inboundGmailMessagePlanRoute =
  "inbound-gmail-message-plan";

export const inboundGmailMaximumAttachmentBytes =
  20 * 1024 * 1024;

export const inboundGmailMaximumMessageSignalBytes =
  128 * 1024;

export interface GmailClassifierRule {
  sourceClassifier:
    InboundDocumentSourceClassifier;
  classifierRuleVersion: string;
  approvedSenderAddresses: string[];
  approvedSenderDomains: string[];
  requiredFilenameTokens: string[];
  requiredMessageSignalGroups?:
    string[][];
}

export interface GmailEligibleAttachment {
  sourceClassifier:
    InboundDocumentSourceClassifier;
  classifierRuleVersion: string;
  sourceMessageId: string;
  sourceThreadId: string | null;
  sourceAttachmentId: string;
  senderAddress: string;
  receivedAtUtc: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface GmailMessagePlan {
  eligibleAttachments:
    GmailEligibleAttachment[];
}

type UnknownRecord =
  Record<string, unknown>;

function json(
  status: number,
  body: unknown
): HttpResponseInit {
  return {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
    jsonBody: body,
  };
}

function isRecord(
  value: unknown
): value is UnknownRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function optionalString(
  value: unknown
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized =
    value.trim();

  return normalized.length > 0
    ? normalized
    : null;
}

function requireString(
  value: unknown,
  fieldName: string,
  maxLength: number
): string {
  const normalized =
    optionalString(value);

  if (!normalized) {
    throw new Error(
      `${fieldName} is required.`
    );
  }

  if (
    normalized.length >
    maxLength
  ) {
    throw new Error(
      `${fieldName} exceeds the supported length.`
    );
  }

  return normalized;
}

function normalizedCsv(
  value: string | undefined,
  options: {
    stripLeadingAt?: boolean;
  } = {}
): string[] {
  const items =
    (value ?? "")
      .split(",")
      .map((item) =>
        item
          .trim()
          .toLowerCase()
      )
      .map((item) =>
        options.stripLeadingAt
          ? item.replace(/^@+/u, "")
          : item
      )
      .filter(
        (item) =>
          item.length > 0
      );

  return [
    ...new Set(items),
  ];
}

function normalizedSignalGroups(
  value: string | undefined
): string[][] {
  return (value ?? "")
    .split(";")
    .map((group) =>
      [
        ...new Set(
          group
            .split("|")
            .map((phrase) =>
              phrase
                .trim()
                .toLowerCase()
            )
            .filter(
              (phrase) =>
                phrase.length > 0
            )
        ),
      ]
    )
    .filter(
      (group) =>
        group.length > 0
    );
}

function loadRule(
  prefix: string,
  sourceClassifier:
    InboundDocumentSourceClassifier
): GmailClassifierRule {
  return {
    sourceClassifier,
    classifierRuleVersion:
      (
        process.env[
          `${prefix}_RULE_VERSION`
        ] ?? ""
      ).trim(),
    approvedSenderAddresses:
      normalizedCsv(
        process.env[
          `${prefix}_APPROVED_SENDERS`
        ]
      ),
    approvedSenderDomains:
      normalizedCsv(
        process.env[
          `${prefix}_APPROVED_DOMAINS`
        ],
        {
          stripLeadingAt: true,
        }
      ),
    requiredFilenameTokens:
      normalizedCsv(
        process.env[
          `${prefix}_FILENAME_TOKENS`
        ]
      ),
    requiredMessageSignalGroups:
      normalizedSignalGroups(
        process.env[
          `${prefix}_MESSAGE_SIGNAL_GROUPS`
        ]
      ),
  };
}

function loadRuleProfiles(
  prefix: string,
  sourceClassifier:
    InboundDocumentSourceClassifier,
  profileCount: number
): GmailClassifierRule[] {
  const rules = [
    loadRule(
      prefix,
      sourceClassifier
    ),
  ];

  for (
    let profile = 1;
    profile <= profileCount;
    profile += 1
  ) {
    rules.push(
      loadRule(
        `${prefix}_PROFILE_${profile}`,
        sourceClassifier
      )
    );
  }

  return rules;
}

export function loadGmailClassifierRulesFromEnvironment():
GmailClassifierRule[] {
  return [
    loadRule(
      "GMAIL_BACKGROUND_CHECK",
      "background_check"
    ),
    ...loadRuleProfiles(
      "GMAIL_MCO_AUTHORIZATION",
      "mco_authorization",
      8
    ),
  ];
}

function ruleIsConfigured(
  rule: GmailClassifierRule
): boolean {
  const hasFilenameBoundary =
    rule.requiredFilenameTokens
      .length > 0;

  const hasMessageSignalBoundary =
    (
      rule
        .requiredMessageSignalGroups ??
      []
    ).length > 0;

  return (
    rule.classifierRuleVersion
      .trim().length > 0 &&
    (
      hasFilenameBoundary ||
      hasMessageSignalBoundary
    ) &&
    (
      rule.approvedSenderAddresses
        .length > 0 ||
      rule.approvedSenderDomains
        .length > 0
    )
  );
}

function getHeaderValue(
  payload: UnknownRecord,
  headerName: string
): string | null {
  const headers =
    payload.headers;

  if (!Array.isArray(headers)) {
    return null;
  }

  const expected =
    headerName.toLowerCase();

  for (
    const candidate
    of headers
  ) {
    if (!isRecord(candidate)) {
      continue;
    }

    const name =
      optionalString(
        candidate.name
      );

    const value =
      optionalString(
        candidate.value
      );

    if (
      name?.toLowerCase() ===
        expected &&
      value
    ) {
      return value;
    }
  }

  return null;
}

function parseSenderAddress(
  fromHeader: string | null
): string | null {
  if (!fromHeader) {
    return null;
  }

  const angleMatch =
    fromHeader.match(
      /<([^<>\s]+@[^<>\s]+)>/u
    );

  const bareMatch =
    fromHeader.match(
      /([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,})/iu
    );

  const candidate =
    (
      angleMatch?.[1] ??
      bareMatch?.[1] ??
      ""
    )
      .trim()
      .toLowerCase();

  if (
    candidate.length === 0 ||
    candidate.length > 320 ||
    candidate.includes(" ") ||
    candidate.startsWith("@") ||
    candidate.endsWith("@")
  ) {
    return null;
  }

  const separator =
    candidate.lastIndexOf("@");

  if (
    separator <= 0 ||
    separator ===
      candidate.length - 1
  ) {
    return null;
  }

  return candidate;
}

function senderDomain(
  senderAddress: string
): string {
  return senderAddress
    .slice(
      senderAddress.lastIndexOf(
        "@"
      ) + 1
    )
    .toLowerCase();
}

function senderMatches(
  senderAddress: string,
  rule: GmailClassifierRule
): boolean {
  const address =
    senderAddress.toLowerCase();

  const domain =
    senderDomain(address);

  return (
    rule.approvedSenderAddresses
      .map((value) =>
        value.toLowerCase()
      )
      .includes(address) ||
    rule.approvedSenderDomains
      .map((value) =>
        value
          .toLowerCase()
          .replace(/^@+/u, "")
      )
      .includes(domain)
  );
}

function filenameMatches(
  fileName: string,
  rule: GmailClassifierRule
): boolean {
  if (
    rule.requiredFilenameTokens
      .length === 0
  ) {
    return true;
  }

  const normalized =
    fileName.toLowerCase();

  return rule
    .requiredFilenameTokens
    .every((token) =>
      normalized.includes(
        token.toLowerCase()
      )
    );
}

function messageSignalMatches(
  messageSignalText: string,
  rule: GmailClassifierRule
): boolean {
  const groups =
    rule
      .requiredMessageSignalGroups ??
    [];

  if (groups.length === 0) {
    return true;
  }

  return groups.every(
    (group) =>
      group.length > 0 &&
      group.some((phrase) =>
        messageSignalText.includes(
          phrase.toLowerCase()
        )
      )
  );
}

function decodeInlineMessageSignalPart(
  part: UnknownRecord
): string | null {
  const mimeType =
    optionalString(
      part.mimeType
    )?.toLowerCase() ??
    null;

  if (
    mimeType !== "text/plain" &&
    mimeType !== "text/html"
  ) {
    return null;
  }

  const body =
    isRecord(part.body)
      ? part.body
      : null;

  const data =
    body
      ? optionalString(
          body.data
        )
      : null;

  if (
    !data ||
    !/^[A-Z0-9_-]+={0,2}$/iu.test(
      data
    )
  ) {
    return null;
  }

  try {
    return Buffer
      .from(
        data,
        "base64url"
      )
      .toString("utf8");
  } catch {
    return null;
  }
}

function collectMessageSignalText(
  part: unknown,
  output: string[],
  state: {
    remainingBytes: number;
  }
): void {
  if (
    state.remainingBytes <= 0 ||
    !isRecord(part)
  ) {
    return;
  }

  const decoded =
    decodeInlineMessageSignalPart(
      part
    );

  if (decoded) {
    const bounded =
      Buffer
        .from(
          decoded,
          "utf8"
        )
        .subarray(
          0,
          state.remainingBytes
        )
        .toString("utf8");

    if (bounded.length > 0) {
      output.push(bounded);
      state.remainingBytes =
        Math.max(
          0,
          state.remainingBytes -
            Buffer.byteLength(
              bounded,
              "utf8"
            )
        );
    }
  }

  const children =
    part.parts;

  if (!Array.isArray(children)) {
    return;
  }

  for (
    const child
    of children
  ) {
    collectMessageSignalText(
      child,
      output,
      state
    );

    if (
      state.remainingBytes <= 0
    ) {
      return;
    }
  }
}

function transientMessageSignalText(
  payload: UnknownRecord
): string {
  const output: string[] = [];

  const state = {
    remainingBytes:
      inboundGmailMaximumMessageSignalBytes,
  };

  const subject =
    getHeaderValue(
      payload,
      "Subject"
    );

  if (
    subject &&
    state.remainingBytes > 0
  ) {
    const boundedSubject =
      Buffer
        .from(
          subject,
          "utf8"
        )
        .subarray(
          0,
          state.remainingBytes
        )
        .toString("utf8");

    if (
      boundedSubject.length > 0
    ) {
      output.push(
        boundedSubject
      );

      state.remainingBytes =
        Math.max(
          0,
          state.remainingBytes -
            Buffer.byteLength(
              boundedSubject,
              "utf8"
            )
        );
    }
  }

  collectMessageSignalText(
    payload,
    output,
    state
  );

  return output
    .join("\n")
    .toLowerCase();
}

function extensionMatchesMime(
  fileName: string,
  contentType: string
): boolean {
  const normalizedFileName =
    fileName.toLowerCase();

  const normalizedContentType =
    contentType.toLowerCase();

  if (
    normalizedContentType ===
      "application/pdf"
  ) {
    return normalizedFileName
      .endsWith(".pdf");
  }

  if (
    normalizedContentType ===
      "image/jpeg"
  ) {
    return (
      normalizedFileName
        .endsWith(".jpg") ||
      normalizedFileName
        .endsWith(".jpeg")
    );
  }

  if (
    normalizedContentType ===
      "image/png"
  ) {
    return normalizedFileName
      .endsWith(".png");
  }

  return false;
}

function parseReceivedAtUtc(
  internalDate: unknown
): string | null {
  const raw =
    optionalString(
      internalDate
    );

  if (
    !raw ||
    !/^\d+$/u.test(raw)
  ) {
    return null;
  }

  const milliseconds =
    Number(raw);

  if (
    !Number.isSafeInteger(
      milliseconds
    ) ||
    milliseconds <= 0
  ) {
    return null;
  }

  const date =
    new Date(milliseconds);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date.toISOString();
}

type AttachmentCandidate = {
  sourceAttachmentId: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
};

function attachmentCandidate(
  part: UnknownRecord
): AttachmentCandidate | null {
  const originalFileName =
    optionalString(
      part.filename
    );

  const contentType =
    optionalString(
      part.mimeType
    )?.toLowerCase() ??
    null;

  const body =
    isRecord(part.body)
      ? part.body
      : null;

  const sourceAttachmentId =
    body
      ? optionalString(
          body.attachmentId
        )
      : null;

  const sizeBytes =
    body &&
    typeof body.size === "number" &&
    Number.isInteger(
      body.size
    )
      ? body.size
      : null;

  if (
    !originalFileName ||
    !contentType ||
    !sourceAttachmentId ||
    sizeBytes === null ||
    sizeBytes <= 0 ||
    sizeBytes >
      inboundGmailMaximumAttachmentBytes ||
    !extensionMatchesMime(
      originalFileName,
      contentType
    )
  ) {
    return null;
  }

  return {
    sourceAttachmentId,
    originalFileName,
    contentType,
    sizeBytes,
  };
}

function collectAttachmentCandidates(
  part: unknown,
  output:
    AttachmentCandidate[]
): void {
  if (!isRecord(part)) {
    return;
  }

  const candidate =
    attachmentCandidate(
      part
    );

  if (candidate) {
    output.push(candidate);
  }

  const children =
    part.parts;

  if (!Array.isArray(children)) {
    return;
  }

  for (
    const child
    of children
  ) {
    collectAttachmentCandidates(
      child,
      output
    );
  }
}

function matchingRule(
  candidate:
    AttachmentCandidate,
  senderAddress: string,
  messageSignalText: string,
  rules:
    GmailClassifierRule[]
): GmailClassifierRule | null {
  const matches =
    rules.filter(
      (rule) =>
        ruleIsConfigured(rule) &&
        senderMatches(
          senderAddress,
          rule
        ) &&
        filenameMatches(
          candidate.originalFileName,
          rule
        ) &&
        messageSignalMatches(
          messageSignalText,
          rule
        )
    );

  return matches.length === 1
    ? matches[0] ?? null
    : null;
}

export function planInboundGmailMessage(
  input: unknown,
  rules:
    GmailClassifierRule[]
): GmailMessagePlan {
  if (!isRecord(input)) {
    throw new Error(
      "Gmail message must be an object."
    );
  }

  const sourceMessageId =
    requireString(
      input.id,
      "message.id",
      200
    );

  const sourceThreadId =
    optionalString(
      input.threadId
    );

  if (
    sourceThreadId &&
    sourceThreadId.length > 200
  ) {
    throw new Error(
      "message.threadId exceeds the supported length."
    );
  }

  const payload =
    input.payload;

  if (!isRecord(payload)) {
    throw new Error(
      "message.payload is required."
    );
  }

  const senderAddress =
    parseSenderAddress(
      getHeaderValue(
        payload,
        "From"
      )
    );

  const receivedAtUtc =
    parseReceivedAtUtc(
      input.internalDate
    );

  if (
    !senderAddress ||
    !receivedAtUtc
  ) {
    return {
      eligibleAttachments: [],
    };
  }

  const requiresMessageSignals =
    rules.some(
      (rule) =>
        ruleIsConfigured(rule) &&
        senderMatches(
          senderAddress,
          rule
        ) &&
        (
          rule
            .requiredMessageSignalGroups ??
          []
        ).length > 0
    );

  const messageSignalText =
    requiresMessageSignals
      ? transientMessageSignalText(
          payload
        )
      : "";

  const candidates:
    AttachmentCandidate[] =
      [];

  collectAttachmentCandidates(
    payload,
    candidates
  );

  const eligibleAttachments:
    GmailEligibleAttachment[] =
      [];

  for (
    const candidate
    of candidates
  ) {
    const rule =
      matchingRule(
        candidate,
        senderAddress,
        messageSignalText,
        rules
      );

    if (!rule) {
      continue;
    }

    if (
      rule.sourceClassifier ===
        "mco_authorization" &&
      (
        candidate.contentType !==
          "application/pdf" ||
        !candidate.originalFileName
          .toLowerCase()
          .endsWith(".pdf")
      )
    ) {
      continue;
    }

    eligibleAttachments.push({
      sourceClassifier:
        rule.sourceClassifier,
      classifierRuleVersion:
        rule.classifierRuleVersion,
      sourceMessageId,
      sourceThreadId,
      sourceAttachmentId:
        candidate
          .sourceAttachmentId,
      senderAddress,
      receivedAtUtc,
      originalFileName:
        candidate
          .originalFileName,
      contentType:
        candidate.contentType,
      sizeBytes:
        candidate.sizeBytes,
    });
  }

  return {
    eligibleAttachments,
  };
}

export async function inboundGmailMessagePlan(
  request: HttpRequest,
  _context: InvocationContext
): Promise<HttpResponseInit> {
  const roleResult =
    await requireApplicationAppRole(
      request,
      inboundGmailMessagePlanRole
    );

  if (!roleResult.ok) {
    return json(
      roleResult.status,
      {
        ok: false,
        error:
          roleResult.error,
      }
    );
  }

  try {
    const message =
      await request.json();

    const plan =
      planInboundGmailMessage(
        message,
        loadGmailClassifierRulesFromEnvironment()
      );

    return json(200, {
      ok: true,
      ...plan,
    });
  } catch {
    return json(400, {
      ok: false,
      error:
        "Gmail message metadata is invalid.",
    });
  }
}

app.http(
  "inboundGmailMessagePlan",
  {
    methods: ["POST"],
    authLevel: "anonymous",
    route:
      inboundGmailMessagePlanRoute,
    handler:
      inboundGmailMessagePlan,
  }
);
