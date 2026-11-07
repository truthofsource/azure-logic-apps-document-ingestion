import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import {
  DefaultAzureCredential,
} from "@azure/identity";
import {
  BlobServiceClient,
  type BlockBlobClient,
} from "@azure/storage-blob";
import {
  randomUUID,
} from "crypto";
import sql from "mssql";

import {
  requireApplicationAppRole,
} from "../auth/requireApplicationAppRole.ts";
import {
  parseInboundDocumentIngestionInput,
  type InboundDocumentIngestionInput,
} from "../contracts/inboundDocumentIngestion.ts";
import {
  getSqlPool,
} from "../db/sqlPool.ts";
import {
  inboundDocumentQuarantineContainer,
  inboundDocumentSourceSystem,
  normalizeInboundBlobEtag,
  prepareInboundDocument,
  type PreparedInboundDocument,
} from "../documents/inboundDocumentRules.ts";

export const inboundDocumentIngestionRole =
  "Workforce.IngestionWriter";

export const inboundDocumentIngestionRoute =
  "inbound-documents";

type InboundIngestionRow = {
  ingestion_id: string;
  source_system: string;
  source_mailbox_key: string;
  source_classifier: string;
  classifier_rule_version: string;
  source_message_id: string;
  source_thread_id: string | null;
  source_attachment_id: string;
  sender_address: string;
  sender_domain: string;
  received_at_utc: Date;
  original_file_name: string;
  content_type: string;
  file_size_bytes: number;
  attachment_sha256: string;
  quarantine_container_name: string;
  quarantine_blob_name: string;
  quarantine_blob_etag: string;
  scan_status: string;
  promotion_status: string;
  destination_document_id: string | null;
  idempotency_key: string;
  correlation_id: string;
  failure_code: string | null;
  created_at_utc: Date;
  updated_at_utc: Date;
};

type ProvenanceConflictOutcomeRow = {
  outcome:
    | "transitioned"
    | "idempotent"
    | "not-found"
    | "not-conflict";
};

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

function mapRow(
  row: InboundIngestionRow
) {
  return {
    ingestionId:
      row.ingestion_id,
    sourceSystem:
      row.source_system,
    sourceClassifier:
      row.source_classifier,
    classifierRuleVersion:
      row.classifier_rule_version,
    receivedAtUtc:
      row.received_at_utc,
    originalFileName:
      row.original_file_name,
    contentType:
      row.content_type,
    fileSizeBytes:
      row.file_size_bytes,
    attachmentSha256:
      row.attachment_sha256,
    scanStatus:
      row.scan_status,
    promotionStatus:
      row.promotion_status,
    destinationDocumentId:
      row.destination_document_id,
    correlationId:
      row.correlation_id,
    failureCode:
      row.failure_code,
    createdAtUtc:
      row.created_at_utc,
    updatedAtUtc:
      row.updated_at_utc,
  };
}

export function classifyInboundReplay(
  row: Pick<
    InboundIngestionRow,
    | "source_system"
    | "source_mailbox_key"
    | "source_message_id"
    | "source_attachment_id"
    | "attachment_sha256"
  >,
  input:
    InboundDocumentIngestionInput,
  prepared:
    Pick<
      PreparedInboundDocument,
      | "attachmentSha256"
      | "sourceAttachmentReference"
    >
): "replay" | "conflict" {
  return (
    row.source_system ===
      inboundDocumentSourceSystem &&
    row.source_mailbox_key ===
      input.sourceMailboxKey &&
    row.source_message_id ===
      input.sourceMessageId &&
    row.source_attachment_id ===
      prepared.sourceAttachmentReference &&
    row.attachment_sha256 ===
      prepared.attachmentSha256
  )
    ? "replay"
    : "conflict";
}

export function classifyInboundDocumentRequestValidationFailure(
  error: unknown
): string {
  const message =
    error instanceof Error
      ? error.message
      : "";

  if (
    message.startsWith(
      "sourceAttachmentId "
    )
  ) {
    return "source_attachment_id";
  }

  if (
    message.startsWith(
      "contentBase64 "
    ) ||
    message.startsWith(
      "contentBase64 must"
    )
  ) {
    return "content_base64";
  }

  if (
    message.startsWith(
      "Attachment extension, MIME type, and byte signature"
    )
  ) {
    return "attachment_content";
  }

  if (
    message.startsWith(
      "senderAddress "
    )
  ) {
    return "sender_address";
  }

  if (
    message.startsWith(
      "receivedAtUtc "
    )
  ) {
    return "received_at_utc";
  }

  if (
    message.startsWith(
      "Request body must be valid JSON"
    )
  ) {
    return "request_json";
  }

  return "request_validation";
}

async function readJson(
  request: HttpRequest
): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error(
      "Request body must be valid JSON."
    );
  }
}

function getRoleClaims(
  roleResult: unknown
): Record<string, unknown> {
  const claims =
    (
      roleResult as {
        claims?: unknown;
      }
    ).claims;

  return (
    claims &&
    typeof claims === "object" &&
    !Array.isArray(claims)
  )
    ? claims as Record<string, unknown>
    : {};
}

function claimString(
  claims:
    Record<string, unknown>,
  name: string
): string | null {
  const value = claims[name];

  return (
    typeof value === "string" &&
    value.trim().length > 0
  )
    ? value.trim()
    : null;
}

function getQuarantineBlobServiceClient() {
  const endpoint =
    process.env
      .INBOUND_DOCUMENT_QUARANTINE_BLOB_ENDPOINT;

  const container =
    process.env
      .INBOUND_DOCUMENT_QUARANTINE_CONTAINER_NAME;

  if (
    !endpoint ||
    container !==
      inboundDocumentQuarantineContainer
  ) {
    throw new Error(
      "Inbound document quarantine storage is not configured."
    );
  }

  const parsed =
    new URL(endpoint);

  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (
      parsed.pathname !== "" &&
      parsed.pathname !== "/"
    )
  ) {
    throw new Error(
      "Inbound document quarantine Blob endpoint is invalid."
    );
  }

  return new BlobServiceClient(
    endpoint,
    new DefaultAzureCredential()
  );
}

async function findByIdempotencyKey(
  idempotencyKey: string
): Promise<InboundIngestionRow | null> {
  const pool =
    await getSqlPool();

  const result =
    await pool
      .request()
      .input(
        "idempotencyKey",
        sql.Char(64),
        idempotencyKey
      )
      .query<InboundIngestionRow>(`
        SELECT TOP (1)
          ingestion_id,
          source_system,
          source_mailbox_key,
          source_classifier,
          classifier_rule_version,
          source_message_id,
          source_thread_id,
          source_attachment_id,
          sender_address,
          sender_domain,
          received_at_utc,
          original_file_name,
          content_type,
          file_size_bytes,
          attachment_sha256,
          quarantine_container_name,
          quarantine_blob_name,
          quarantine_blob_etag,
          scan_status,
          promotion_status,
          destination_document_id,
          idempotency_key,
          correlation_id,
          failure_code,
          created_at_utc,
          updated_at_utc
        FROM dbo.inbound_document_ingestions
        WHERE idempotency_key =
          @idempotencyKey;
      `);

  return result.recordset[0] ?? null;
}

function isDuplicateSqlError(
  error: unknown
): boolean {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return false;
  }

  const number =
    (
      error as {
        number?: unknown;
      }
    ).number;

  return (
    number === 2601 ||
    number === 2627
  );
}

async function markInboundProvenanceConflict(
  existing: Pick<InboundIngestionRow, "ingestion_id">,
  input: InboundDocumentIngestionInput,
  prepared: Pick<PreparedInboundDocument, "attachmentSha256">,
  roleResult: unknown,
  context: InvocationContext
): Promise<void> {
  const pool = await getSqlPool();
  const transaction = new sql.Transaction(pool);
  let transactionStarted = false;

  try {
    await transaction.begin();
    transactionStarted = true;

    const result = await new sql.Request(transaction)
      .input("ingestionId", sql.UniqueIdentifier, existing.ingestion_id)
      .input(
        "incomingAttachmentSha256",
        sql.Char(64),
        prepared.attachmentSha256
      )
      .execute<ProvenanceConflictOutcomeRow>(
        "dbo.mark_inbound_document_provenance_conflict"
      );

    const outcome = result.recordset[0]?.outcome;

    if (outcome !== "transitioned" && outcome !== "idempotent") {
      throw new Error(
        "Inbound provenance conflict transition returned an unexpected outcome."
      );
    }

    if (outcome === "transitioned") {
      const claims = getRoleClaims(roleResult);
      const actorObjectId =
        claimString(claims, "oid") ??
        claimString(claims, "sub");
      const metadataJson = JSON.stringify({
        sourceSystem: inboundDocumentSourceSystem,
        sourceClassifier: input.sourceClassifier,
        classifierRuleVersion: input.classifierRuleVersion,
        failureCode: "attachment_hash_conflict",
        promotionStatus: "provenance_conflict",
      });

      await new sql.Request(transaction)
        .input("actorObjectId", sql.NVarChar(100), actorObjectId)
        .input("entityId", sql.NVarChar(100), existing.ingestion_id)
        .input("correlationId", sql.NVarChar(100), input.correlationId)
        .input("metadataJson", sql.NVarChar(sql.MAX), metadataJson)
        .query(`
          INSERT INTO dbo.audit_events (
            actor_type,
            actor_object_id,
            action,
            entity_type,
            entity_id,
            outcome,
            correlation_id,
            metadata_json
          )
          VALUES
          (
            N'service_principal',
            @actorObjectId,
            N'inbound_document.provenance_conflict',
            N'inbound_document_ingestion',
            @entityId,
            N'blocked',
            @correlationId,
            @metadataJson
          ),
          (
            N'service_principal',
            @actorObjectId,
            N'inbound_document.manual_review_required',
            N'inbound_document_ingestion',
            @entityId,
            N'required',
            @correlationId,
            @metadataJson
          );
        `);
    }

    await transaction.commit();
    transactionStarted = false;
  } catch {
    if (transactionStarted) {
      try {
        await transaction.rollback();
      } catch {
        context.warn(
          "Inbound provenance-conflict transaction rollback could not be confirmed."
        );
      }
    }

    context.error(
      "Inbound provenance conflict could not be recorded."
    );

    throw new Error(
      "Inbound provenance conflict state could not be recorded."
    );
  }
}

async function provenanceConflictResponse(
  existing: InboundIngestionRow,
  input: InboundDocumentIngestionInput,
  prepared: PreparedInboundDocument,
  roleResult: unknown,
  context: InvocationContext
): Promise<HttpResponseInit> {
  await markInboundProvenanceConflict(
    existing,
    input,
    prepared,
    roleResult,
    context
  );

  return json(409, {
    ok: false,
    error:
      "Inbound document provenance conflicts with an existing immutable Gmail attachment identity.",
  });
}

async function deleteUploadedBlob(
  blob:
    BlockBlobClient | null,
  context:
    InvocationContext
): Promise<void> {
  if (!blob) {
    return;
  }

  try {
    await blob.deleteIfExists();
  } catch {
    context.warn(
      "Inbound quarantine cleanup failed after an incomplete ingestion."
    );
  }
}

async function inboundDocumentIngestion(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log(
    "Processing protected inbound document quarantine request."
  );

  const roleResult =
    await requireApplicationAppRole(
      request,
      inboundDocumentIngestionRole
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

  let input:
    InboundDocumentIngestionInput;

  let prepared:
    PreparedInboundDocument;

  const ingestionId =
    randomUUID();

  try {
    input =
      parseInboundDocumentIngestionInput(
        await readJson(request)
      );

    prepared =
      prepareInboundDocument(
        input,
        ingestionId
      );
  } catch (error) {
    context.warn(
      `Inbound document request rejected: ${classifyInboundDocumentRequestValidationFailure(
        error
      )}.`
    );

    return json(
      400,
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Invalid inbound document request.",
      }
    );
  }

  try {
    const existing =
      await findByIdempotencyKey(
        prepared.idempotencyKey
      );

    if (existing) {
      const classification =
        classifyInboundReplay(
          existing,
          input,
          prepared
        );

      if (classification === "replay") {
        return json(200, {
          ok: true,
          idempotentReplay:
            true,
          ingestion:
            mapRow(existing),
        });
      }

      return await provenanceConflictResponse(
        existing,
        input,
        prepared,
        roleResult,
        context
      );
    }
  } catch (error) {
    context.error(
      "Inbound document idempotency lookup failed."
    );

    return json(
      500,
      {
        ok: false,
        error:
          "Inbound document ingestion failed.",
      }
    );
  }

  let uploadedBlob:
    BlockBlobClient | null =
      null;

  try {
    const blobService =
      getQuarantineBlobServiceClient();

    const container =
      blobService.getContainerClient(
        inboundDocumentQuarantineContainer
      );

    uploadedBlob =
      container.getBlockBlobClient(
        prepared.blobName
      );

    const upload =
      await uploadedBlob.uploadData(
        prepared.fileBuffer,
        {
          conditions: {
            ifNoneMatch: "*",
          },
          blobHTTPHeaders: {
            blobContentType:
              prepared.contentType,
          },
          metadata: {
            ingestionid:
              ingestionId,
            sourceclassifier:
              input.sourceClassifier,
            contentsha256:
              prepared.attachmentSha256,
          },
        }
      );

    const quarantineEtag =
      normalizeInboundBlobEtag(
        upload.etag
      );

    const pool =
      await getSqlPool();

    const transaction =
      new sql.Transaction(
        pool
      );

    let transactionStarted =
      false;

    try {
      await transaction.begin();
      transactionStarted = true;

      const dbRequest =
        new sql.Request(
          transaction
        );

      dbRequest
        .input(
          "ingestionId",
          sql.UniqueIdentifier,
          ingestionId
        )
        .input(
          "sourceSystem",
          sql.NVarChar(50),
          inboundDocumentSourceSystem
        )
        .input(
          "sourceMailboxKey",
          sql.NVarChar(200),
          input.sourceMailboxKey
        )
        .input(
          "sourceClassifier",
          sql.NVarChar(50),
          input.sourceClassifier
        )
        .input(
          "classifierRuleVersion",
          sql.NVarChar(50),
          input.classifierRuleVersion
        )
        .input(
          "sourceMessageId",
          sql.NVarChar(200),
          input.sourceMessageId
        )
        .input(
          "sourceThreadId",
          sql.NVarChar(200),
          input.sourceThreadId
        )
        .input(
          "sourceAttachmentId",
          sql.NVarChar(200),
          prepared.sourceAttachmentReference
        )
        .input(
          "senderAddress",
          sql.NVarChar(320),
          input.senderAddress
        )
        .input(
          "senderDomain",
          sql.NVarChar(255),
          prepared.senderDomain
        )
        .input(
          "receivedAtUtc",
          sql.DateTime2(7),
          prepared.receivedAt
        )
        .input(
          "originalFileName",
          sql.NVarChar(260),
          prepared.normalizedFileName
        )
        .input(
          "contentType",
          sql.NVarChar(200),
          prepared.contentType
        )
        .input(
          "fileSizeBytes",
          sql.BigInt,
          prepared.fileBuffer.length
        )
        .input(
          "attachmentSha256",
          sql.Char(64),
          prepared.attachmentSha256
        )
        .input(
          "quarantineContainerName",
          sql.NVarChar(100),
          inboundDocumentQuarantineContainer
        )
        .input(
          "quarantineBlobName",
          sql.NVarChar(500),
          prepared.blobName
        )
        .input(
          "quarantineBlobEtag",
          sql.NVarChar(200),
          quarantineEtag
        )
        .input(
          "idempotencyKey",
          sql.Char(64),
          prepared.idempotencyKey
        )
        .input(
          "correlationId",
          sql.NVarChar(100),
          input.correlationId
        );

      const insertResult =
        await dbRequest
          .execute<InboundIngestionRow>(
            "dbo.create_inbound_document_ingestion"
          );

      const claims =
        getRoleClaims(
          roleResult
        );

      const actorObjectId =
        claimString(
          claims,
          "oid"
        ) ??
        claimString(
          claims,
          "sub"
        );

      await new sql.Request(
        transaction
      )
        .input(
          "actorObjectId",
          sql.NVarChar(100),
          actorObjectId
        )
        .input(
          "entityId",
          sql.NVarChar(100),
          ingestionId
        )
        .input(
          "correlationId",
          sql.NVarChar(100),
          input.correlationId
        )
        .input(
          "metadataJson",
          sql.NVarChar(sql.MAX),
          JSON.stringify({
            sourceSystem:
              inboundDocumentSourceSystem,
            sourceClassifier:
              input.sourceClassifier,
            classifierRuleVersion:
              input.classifierRuleVersion,
            attachmentSha256:
              prepared.attachmentSha256,
            scanStatus:
              "pending_scan",
            promotionStatus:
              "quarantined",
          })
        )
        .query(`
          INSERT INTO dbo.audit_events (
            actor_type,
            actor_object_id,
            action,
            entity_type,
            entity_id,
            outcome,
            correlation_id,
            metadata_json
          )
          VALUES (
            N'service_principal',
            @actorObjectId,
            N'inbound_document.quarantined',
            N'inbound_document_ingestion',
            @entityId,
            N'success',
            @correlationId,
            @metadataJson
          );
        `);

      await transaction.commit();
      transactionStarted =
        false;

      return json(
        201,
        {
          ok: true,
          idempotentReplay:
            false,
          ingestion:
            mapRow(
              insertResult.recordset[0]
            ),
        }
      );
    } catch (error) {
      if (
        transactionStarted
      ) {
        try {
          await transaction.rollback();
        } catch {
          context.warn(
            "Inbound SQL transaction rollback could not be confirmed."
          );
        }
      }

      await deleteUploadedBlob(
        uploadedBlob,
        context
      );
      uploadedBlob = null;

      if (
        isDuplicateSqlError(
          error
        )
      ) {
        const existing =
          await findByIdempotencyKey(
            prepared.idempotencyKey
          );

        if (existing) {
          const classification =
            classifyInboundReplay(
              existing,
              input,
              prepared
            );

          if (classification === "replay") {
            return json(200, {
              ok: true,
              idempotentReplay:
                true,
              ingestion:
                mapRow(existing),
            });
          }

          return await provenanceConflictResponse(
            existing,
            input,
            prepared,
            roleResult,
            context
          );
        }
      }

      throw error;
    }
  } catch (error) {
    await deleteUploadedBlob(
      uploadedBlob,
      context
    );

    context.error(
      "Inbound document quarantine failed."
    );

    const message =
      error instanceof Error
        ? error.message
        : "";

    const status =
      (
        message.includes(
          "not configured"
        ) ||
        message.includes(
          "invalid"
        )
      )
        ? 503
        : 500;

    return json(
      status,
      {
        ok: false,
        error:
          "Inbound document ingestion failed.",
      }
    );
  }
}

app.http(
  "inboundDocumentIngestion",
  {
    methods: ["POST"],
    authLevel: "anonymous",
    route:
      inboundDocumentIngestionRoute,
    handler:
      inboundDocumentIngestion,
  }
);
