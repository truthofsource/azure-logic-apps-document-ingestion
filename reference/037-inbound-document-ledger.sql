/*
Workforce Services Workforce Platform
Migration: 037_gmail_inbound_document_ingestion_foundation

Purpose:
- Add a generic pre-trust Gmail attachment-ingestion record.
- Add MCO authorization as a first-class trusted document destination.
- Grant only the Workforce API and malware-scan processor permissions required
  by the Layer 40 ingestion contract; creation uses an EXECUTE-only procedure.

Safety boundary:
- This migration does not query Gmail.
- This migration does not authorize Google OAuth.
- This migration does not create Blob containers or Logic Apps.
- This migration does not promote unscanned content into trusted documents.
- Background-check architecture uses generic background_check terminology.
*/

SET XACT_ABORT ON;
GO

BEGIN TRY
    BEGIN TRANSACTION;

    IF EXISTS (
        SELECT 1
        FROM dbo.schema_migrations
        WHERE version =
            N'037_gmail_inbound_document_ingestion_foundation'
    )
    BEGIN
        COMMIT TRANSACTION;
        RETURN;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM dbo.schema_migrations
        WHERE version =
            N'036_stage2_ssn_and_government_id_foundation'
    )
    BEGIN
        THROW 53700,
            'Migration 036 must be applied before migration 037.',
            1;
    END;

    IF OBJECT_ID(
        N'dbo.document_metadata',
        N'U'
    ) IS NULL
    BEGIN
        THROW 53701,
            'dbo.document_metadata is required.',
            1;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM sys.database_principals
        WHERE
            name =
                N'func-example-workforce-dev-eastus2-001'
            AND type_desc =
                N'EXTERNAL_USER'
    )
    BEGIN
        THROW 53702,
            'The Workforce Function SQL principal is missing.',
            1;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM sys.database_principals
        WHERE
            name =
                N'func-example-stage2scan-dev-eastus2-001'
            AND type_desc =
                N'EXTERNAL_USER'
    )
    BEGIN
        THROW 53703,
            'The malware scan-processor SQL principal is missing.',
            1;
    END;

    IF OBJECT_ID(
        N'dbo.inbound_document_ingestions',
        N'U'
    ) IS NULL
    BEGIN
        CREATE TABLE dbo.inbound_document_ingestions (
            ingestion_id
                UNIQUEIDENTIFIER NOT NULL,
            source_system
                NVARCHAR(50) NOT NULL,
            source_mailbox_key
                NVARCHAR(200) NOT NULL,
            source_classifier
                NVARCHAR(50) NOT NULL,
            classifier_rule_version
                NVARCHAR(50) NOT NULL,
            source_message_id
                NVARCHAR(200) NOT NULL,
            source_thread_id
                NVARCHAR(200) NULL,
            source_attachment_id
                NVARCHAR(200) NOT NULL,
            sender_address
                NVARCHAR(320) NOT NULL,
            sender_domain
                NVARCHAR(255) NOT NULL,
            received_at_utc
                DATETIME2(7) NOT NULL,
            original_file_name
                NVARCHAR(260) NOT NULL,
            content_type
                NVARCHAR(200) NOT NULL,
            file_size_bytes
                BIGINT NOT NULL,
            attachment_sha256
                CHAR(64) NOT NULL,
            quarantine_container_name
                NVARCHAR(100) NOT NULL,
            quarantine_blob_name
                NVARCHAR(500) NOT NULL,
            quarantine_blob_etag
                NVARCHAR(200) NOT NULL,
            scan_status
                NVARCHAR(50) NOT NULL
                CONSTRAINT
                    DF_inbound_document_ingestions_scan_status
                DEFAULT N'pending_scan',
            scan_provider
                NVARCHAR(100) NULL,
            scanned_at_utc
                DATETIME2(7) NULL,
            promotion_status
                NVARCHAR(50) NOT NULL
                CONSTRAINT
                    DF_inbound_document_ingestions_promotion_status
                DEFAULT N'quarantined',
            destination_document_id
                UNIQUEIDENTIFIER NULL,
            idempotency_key
                CHAR(64) NOT NULL,
            correlation_id
                NVARCHAR(100) NOT NULL,
            failure_code
                NVARCHAR(100) NULL,
            created_at_utc
                DATETIME2(7) NOT NULL
                CONSTRAINT
                    DF_inbound_document_ingestions_created_at
                DEFAULT SYSUTCDATETIME(),
            updated_at_utc
                DATETIME2(7) NOT NULL
                CONSTRAINT
                    DF_inbound_document_ingestions_updated_at
                DEFAULT SYSUTCDATETIME(),

            CONSTRAINT
                PK_inbound_document_ingestions
            PRIMARY KEY (
                ingestion_id
            ),

            CONSTRAINT
                FK_inbound_document_ingestions_destination_document
            FOREIGN KEY (
                destination_document_id
            )
            REFERENCES dbo.document_metadata(
                document_id
            ),

            CONSTRAINT
                CK_inbound_document_ingestions_source_system
            CHECK (
                source_system =
                    N'gmail'
            ),

            CONSTRAINT
                CK_inbound_document_ingestions_source_classifier
            CHECK (
                source_classifier IN (
                    N'background_check',
                    N'mco_authorization'
                )
            ),

            CONSTRAINT
                CK_inbound_document_ingestions_content_type
            CHECK (
                content_type IN (
                    N'application/pdf',
                    N'image/jpeg',
                    N'image/png'
                )
            ),

            CONSTRAINT
                CK_inbound_document_ingestions_file_size
            CHECK (
                file_size_bytes > 0
                AND file_size_bytes <=
                    20971520
            ),

            CONSTRAINT
                CK_inbound_document_ingestions_attachment_sha256
            CHECK (
                LEN(attachment_sha256) = 64
                AND attachment_sha256
                    NOT LIKE
                    '%[^0-9A-Fa-f]%'
            ),

            CONSTRAINT
                CK_inbound_document_ingestions_idempotency_key
            CHECK (
                LEN(idempotency_key) = 64
                AND idempotency_key
                    NOT LIKE
                    '%[^0-9A-Fa-f]%'
            ),

            CONSTRAINT
                CK_inbound_document_ingestions_quarantine_container
            CHECK (
                quarantine_container_name =
                    N'gmail-document-quarantine'
            ),

            CONSTRAINT
                CK_inbound_document_ingestions_scan_status
            CHECK (
                scan_status IN (
                    N'pending_scan',
                    N'clean',
                    N'malicious',
                    N'scan_error'
                )
            ),

            CONSTRAINT
                CK_inbound_document_ingestions_scan_provider
            CHECK (
                scan_provider IS NULL
                OR scan_provider =
                    N'Microsoft Defender for Storage'
            ),

            CONSTRAINT
                CK_inbound_document_ingestions_scan_metadata_state
            CHECK (
                (
                    scan_status =
                        N'pending_scan'
                    AND scan_provider IS NULL
                    AND scanned_at_utc IS NULL
                )
                OR
                (
                    scan_status <>
                        N'pending_scan'
                    AND scan_provider IS NOT NULL
                    AND scanned_at_utc IS NOT NULL
                )
            ),

            CONSTRAINT
                CK_inbound_document_ingestions_promotion_status
            CHECK (
                promotion_status IN (
                    N'quarantined',
                    N'waiting_review',
                    N'promoted',
                    N'rejected',
                    N'promotion_failed',
                    N'provenance_conflict'
                )
            ),

            CONSTRAINT
                CK_inbound_document_ingestions_promotion_scan_state
            CHECK (
                promotion_status NOT IN (
                    N'waiting_review',
                    N'promoted'
                )
                OR scan_status =
                    N'clean'
            ),

            CONSTRAINT
                CK_inbound_document_ingestions_destination_state
            CHECK (
                (
                    promotion_status =
                        N'promoted'
                    AND destination_document_id
                        IS NOT NULL
                )
                OR
                (
                    promotion_status IN (
                        N'quarantined',
                        N'waiting_review',
                        N'rejected',
                        N'promotion_failed'
                    )
                    AND destination_document_id
                        IS NULL
                )
                OR
                promotion_status =
                    N'provenance_conflict'
            )
        );

        CREATE UNIQUE INDEX
            UX_inbound_document_ingestions_idempotency_key
        ON dbo.inbound_document_ingestions (
            idempotency_key
        );

        CREATE UNIQUE INDEX
            UX_inbound_document_ingestions_gmail_provenance
        ON dbo.inbound_document_ingestions (
            source_mailbox_key,
            source_message_id,
            source_attachment_id
        );

        CREATE UNIQUE INDEX
            UX_inbound_document_ingestions_quarantine_blob
        ON dbo.inbound_document_ingestions (
            quarantine_container_name,
            quarantine_blob_name
        );

        CREATE INDEX
            IX_inbound_document_ingestions_scan_promotion
        ON dbo.inbound_document_ingestions (
            scan_status,
            promotion_status,
            received_at_utc
        )
        INCLUDE (
            source_classifier,
            attachment_sha256,
            destination_document_id
        );
    END;

    /*
    Creation is exposed to the Workforce Function through one same-owner stored
    procedure instead of a direct INSERT grant. SQL Server does not support
    column-scoped INSERT grants; the procedure hard-codes pre-trust states.
    */
    EXEC sys.sp_executesql N'
CREATE OR ALTER PROCEDURE dbo.create_inbound_document_ingestion
    @ingestionId UNIQUEIDENTIFIER,
    @sourceSystem NVARCHAR(50),
    @sourceMailboxKey NVARCHAR(200),
    @sourceClassifier NVARCHAR(50),
    @classifierRuleVersion NVARCHAR(50),
    @sourceMessageId NVARCHAR(200),
    @sourceThreadId NVARCHAR(200) = NULL,
    @sourceAttachmentId NVARCHAR(200),
    @senderAddress NVARCHAR(320),
    @senderDomain NVARCHAR(255),
    @receivedAtUtc DATETIME2(7),
    @originalFileName NVARCHAR(260),
    @contentType NVARCHAR(200),
    @fileSizeBytes BIGINT,
    @attachmentSha256 CHAR(64),
    @quarantineContainerName NVARCHAR(100),
    @quarantineBlobName NVARCHAR(500),
    @quarantineBlobEtag NVARCHAR(200),
    @idempotencyKey CHAR(64),
    @correlationId NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;

    IF @sourceSystem <> N''gmail''
        THROW 53710,
            ''Inbound source system must be gmail.'',
            1;

    IF @quarantineContainerName <>
        N''gmail-document-quarantine''
        THROW 53711,
            ''Inbound quarantine container is invalid.'',
            1;

    INSERT INTO dbo.inbound_document_ingestions (
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
        idempotency_key,
        correlation_id
    )
    OUTPUT
        INSERTED.ingestion_id,
        INSERTED.source_system,
        INSERTED.source_mailbox_key,
        INSERTED.source_classifier,
        INSERTED.classifier_rule_version,
        INSERTED.source_message_id,
        INSERTED.source_thread_id,
        INSERTED.source_attachment_id,
        INSERTED.sender_address,
        INSERTED.sender_domain,
        INSERTED.received_at_utc,
        INSERTED.original_file_name,
        INSERTED.content_type,
        INSERTED.file_size_bytes,
        INSERTED.attachment_sha256,
        INSERTED.quarantine_container_name,
        INSERTED.quarantine_blob_name,
        INSERTED.quarantine_blob_etag,
        INSERTED.scan_status,
        INSERTED.promotion_status,
        INSERTED.destination_document_id,
        INSERTED.idempotency_key,
        INSERTED.correlation_id,
        INSERTED.failure_code,
        INSERTED.created_at_utc,
        INSERTED.updated_at_utc
    VALUES (
        @ingestionId,
        @sourceSystem,
        @sourceMailboxKey,
        @sourceClassifier,
        @classifierRuleVersion,
        @sourceMessageId,
        @sourceThreadId,
        @sourceAttachmentId,
        @senderAddress,
        @senderDomain,
        @receivedAtUtc,
        @originalFileName,
        @contentType,
        @fileSizeBytes,
        @attachmentSha256,
        @quarantineContainerName,
        @quarantineBlobName,
        @quarantineBlobEtag,
        N''pending_scan'',
        N''quarantined'',
        @idempotencyKey,
        @correlationId
    );
END;
';

    /*
    A same-provenance / different-byte replay is a security-relevant conflict.
    The Workforce Function receives EXECUTE only on this same-owner procedure,
    rather than direct UPDATE permission on the pre-trust ingestion table.
    A previously promoted destination identifier is retained as evidence if a
    later Gmail replay proves that the immutable provenance is inconsistent.
    */
    EXEC sys.sp_executesql N'
CREATE OR ALTER PROCEDURE dbo.mark_inbound_document_provenance_conflict
    @ingestionId UNIQUEIDENTIFIER,
    @incomingAttachmentSha256 CHAR(64)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE
        @storedAttachmentSha256 CHAR(64) = NULL,
        @currentPromotionStatus NVARCHAR(50) = NULL;

    SELECT
        @storedAttachmentSha256 =
            attachment_sha256,
        @currentPromotionStatus =
            promotion_status
    FROM dbo.inbound_document_ingestions
        WITH (UPDLOCK, HOLDLOCK)
    WHERE
        ingestion_id =
            @ingestionId;

    IF @storedAttachmentSha256 IS NULL
    BEGIN
        SELECT
            N''not-found'' AS outcome;
        RETURN;
    END;

    IF @storedAttachmentSha256 =
        @incomingAttachmentSha256
    BEGIN
        SELECT
            N''not-conflict'' AS outcome;
        RETURN;
    END;

    IF @currentPromotionStatus =
        N''provenance_conflict''
    BEGIN
        SELECT
            N''idempotent'' AS outcome;
        RETURN;
    END;

    UPDATE dbo.inbound_document_ingestions
    SET
        promotion_status =
            N''provenance_conflict'',
        failure_code =
            N''attachment_hash_conflict'',
        updated_at_utc =
            SYSUTCDATETIME()
    WHERE
        ingestion_id =
            @ingestionId;

    SELECT
        N''transitioned'' AS outcome;
END;
';

    /*
    Extend the current trusted-document constraints only.
    The quarantine container deliberately does not become a document_metadata
    container because unscanned content is not trusted document evidence.
    */

    IF EXISTS (
        SELECT 1
        FROM sys.check_constraints
        WHERE
            parent_object_id =
                OBJECT_ID(
                    N'dbo.document_metadata'
                )
            AND name =
                N'CK_document_metadata_document_type'
    )
    BEGIN
        ALTER TABLE dbo.document_metadata
            DROP CONSTRAINT
                CK_document_metadata_document_type;
    END;

    ALTER TABLE dbo.document_metadata
        WITH CHECK
        ADD CONSTRAINT
            CK_document_metadata_document_type
        CHECK (
            document_type IN (
                N'timesheet_raw',
                N'employment_application',
                N'background_check',
                N'payroll_packet',
                N'billing_evidence',
                N'audit_evidence',
                N'policy_procedure',
                N'government_id',
                N'mco_authorization',
                N'other'
            )
        );

    IF EXISTS (
        SELECT 1
        FROM sys.check_constraints
        WHERE
            parent_object_id =
                OBJECT_ID(
                    N'dbo.document_metadata'
                )
            AND name =
                N'CK_document_metadata_workflow_area'
    )
    BEGIN
        ALTER TABLE dbo.document_metadata
            DROP CONSTRAINT
                CK_document_metadata_workflow_area;
    END;

    ALTER TABLE dbo.document_metadata
        WITH CHECK
        ADD CONSTRAINT
            CK_document_metadata_workflow_area
        CHECK (
            workflow_area IN (
                N'timesheets',
                N'employment',
                N'background_checks',
                N'payroll',
                N'billing',
                N'audit',
                N'compliance',
                N'general',
                N'authorizations'
            )
        );

    IF EXISTS (
        SELECT 1
        FROM sys.check_constraints
        WHERE
            parent_object_id =
                OBJECT_ID(
                    N'dbo.document_metadata'
                )
            AND name =
                N'CK_document_metadata_container_name'
    )
    BEGIN
        ALTER TABLE dbo.document_metadata
            DROP CONSTRAINT
                CK_document_metadata_container_name;
    END;

    ALTER TABLE dbo.document_metadata
        WITH CHECK
        ADD CONSTRAINT
            CK_document_metadata_container_name
        CHECK (
            container_name IN (
                N'timesheets-raw',
                N'payroll-packets',
                N'employment-applications',
                N'background-checks',
                N'billing-evidence',
                N'audit-evidence',
                N'stage2-applicant-intake',
                N'mco-authorizations'
            )
        );

    GRANT SELECT (
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
    )
        ON OBJECT::dbo.inbound_document_ingestions
        TO [func-example-workforce-dev-eastus2-001];

    GRANT EXECUTE
        ON OBJECT::dbo.create_inbound_document_ingestion
        TO [func-example-workforce-dev-eastus2-001];

    GRANT EXECUTE
        ON OBJECT::dbo.mark_inbound_document_provenance_conflict
        TO [func-example-workforce-dev-eastus2-001];

    GRANT SELECT (
        ingestion_id,
        quarantine_container_name,
        quarantine_blob_name,
        quarantine_blob_etag,
        scan_status,
        promotion_status
    )
        ON OBJECT::dbo.inbound_document_ingestions
        TO [func-example-stage2scan-dev-eastus2-001];

    GRANT UPDATE (
        scan_status,
        scan_provider,
        scanned_at_utc,
        promotion_status,
        failure_code,
        updated_at_utc
    )
        ON OBJECT::dbo.inbound_document_ingestions
        TO [func-example-stage2scan-dev-eastus2-001];

    INSERT INTO dbo.schema_migrations (
        version,
        description
    )
    VALUES (
        N'037_gmail_inbound_document_ingestion_foundation',
        N'Add generic Gmail pre-trust document ingestion, background-check/MCO classification, MCO trusted-document destination, and least-privilege scan transitions.'
    );

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
    BEGIN
        ROLLBACK TRANSACTION;
    END;

    THROW;
END CATCH;
GO
