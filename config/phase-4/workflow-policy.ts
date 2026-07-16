export const PHASE_4_SUBMISSION_TYPES = [
  "CONFIRM_UNCHANGED",
  "UPDATE_EXISTING",
  "CREATE_NEW",
] as const;

export type Phase4SubmissionType = (typeof PHASE_4_SUBMISSION_TYPES)[number];

export const PHASE_4_EVENT_TYPES = [
  "SUBMITTED",
  "REJECTED",
  "APPROVED",
] as const;

export type Phase4EventType = (typeof PHASE_4_EVENT_TYPES)[number];

export const PHASE_4_TERMINAL_EVENT_TYPES = ["REJECTED", "APPROVED"] as const;

export type Phase4TerminalEventType =
  (typeof PHASE_4_TERMINAL_EVENT_TYPES)[number];

export const PHASE_4_WORKFLOW_STATES = [
  "PENDING",
  "REJECTED",
  "APPROVED",
] as const;

export type Phase4WorkflowState = (typeof PHASE_4_WORKFLOW_STATES)[number];

export const PHASE_4_BUSINESS_FIELDS = [
  "stt",
  "don_vi_phu_trach_hoc_phan",
  "bo_mon_phu_trach_hoc_phan",
  "khoi_kien_thuc",
  "ma_hoc_phan",
  "ten_hoc_phan",
  "ten_giang_vien",
  "ma_so_can_bo",
  "email_tai_khoan_vnu",
  "bo_mon",
  "don_vi",
  "core_1_2_3",
  "tc1_tro_giang",
  "tc2_sh_chuyen_mon",
  "tc3_tong_hop",
  "tc3_1_nganh_tot_nghiep_phu_hop",
  "tc3_2_bien_soan_de_cuong_giao_trinh",
  "tc3_3_chu_nhiem_de_tai_nckh_lien_quan",
  "tc3_4_bai_bao_lien_quan",
  "tc4_giang_thu",
] as const;

export type Phase4BusinessField = (typeof PHASE_4_BUSINESS_FIELDS)[number];

export const PHASE_4_READ_ONLY_FIELDS = [
  "stt",
  "ten_giang_vien",
  "ma_so_can_bo",
  "email_tai_khoan_vnu",
  "bo_mon",
  "don_vi",
] as const satisfies readonly Phase4BusinessField[];

export type Phase4ReadOnlyField = (typeof PHASE_4_READ_ONLY_FIELDS)[number];

export const PHASE_4_EDITABLE_FIELDS = [
  "don_vi_phu_trach_hoc_phan",
  "bo_mon_phu_trach_hoc_phan",
  "khoi_kien_thuc",
  "ma_hoc_phan",
  "ten_hoc_phan",
  "core_1_2_3",
  "tc1_tro_giang",
  "tc2_sh_chuyen_mon",
  "tc3_tong_hop",
  "tc3_1_nganh_tot_nghiep_phu_hop",
  "tc3_2_bien_soan_de_cuong_giao_trinh",
  "tc3_3_chu_nhiem_de_tai_nckh_lien_quan",
  "tc3_4_bai_bao_lien_quan",
  "tc4_giang_thu",
] as const satisfies readonly Phase4BusinessField[];

export type Phase4EditableField = (typeof PHASE_4_EDITABLE_FIELDS)[number];

export const PHASE_4_SERVER_DERIVED_TECHNICAL_FIELDS = [
  "event_id",
  "submission_id",
  "parent_submission_id",
  "event_type",
  "actor_user_id",
  "lecturer_uid",
  "record_uid",
  "approval_unit",
  "version_no",
  "snapshot_id",
  "identity_status",
  "source_row_number",
  "source_row_checksum",
  "source_import_run_id",
  "source_submission_id",
  "origin",
  "approved_by",
  "approved_at",
  "created_at",
] as const;

export type Phase4ServerDerivedTechnicalField =
  (typeof PHASE_4_SERVER_DERIVED_TECHNICAL_FIELDS)[number];

export interface Phase4SubmissionRule {
  readonly existingCoreRowRequired: boolean;
  readonly baseVersionRequired: boolean;
  readonly recordUidRule:
    | "REUSE_SERVER_RESOLVED_RECORD_UID"
    | "GENERATE_ON_INITIAL_SUBMISSION_REUSE_ON_RESUBMIT";
  readonly submittedRowRule:
    | "COPY_SERVER_RESOLVED_CURRENT_ROW"
    | "MERGE_EDITABLE_FIELDS_INTO_SERVER_RESOLVED_CURRENT_ROW"
    | "MERGE_EDITABLE_FIELDS_WITH_SERVER_RESOLVED_LECTURER_IDENTITY";
  readonly approvedVersionRule: "CURRENT_VERSION_PLUS_ONE" | "VERSION_ONE";
}

export interface Phase4WorkflowPolicy {
  readonly version: 1;
  readonly unitOfWork: "ONE_SUBMISSION_ONE_LOGICAL_ROW_ONE_RECORD_UID";
  readonly appendOnly: {
    readonly workflowEvent: true;
    readonly coreData: true;
  };
  readonly events: {
    readonly initial: "SUBMITTED";
    readonly transitions: {
      readonly SUBMITTED: readonly ["REJECTED", "APPROVED"];
      readonly REJECTED: readonly [];
      readonly APPROVED: readonly [];
    };
    readonly exactlyOneSubmittedPerSubmission: true;
    readonly maximumTerminalEventsPerSubmission: 1;
  };
  readonly pending: {
    readonly maximumPerRecordUid: 1;
    readonly multiplePerLecturerAcrossDifferentRecords: true;
  };
  readonly resubmission: {
    readonly rejectedSubmissionIsImmutable: true;
    readonly newSubmissionIdRequired: true;
    readonly parentMustBeRejectedSubmission: true;
    readonly preserveRecordUid: true;
  };
  readonly fields: {
    readonly business: readonly Phase4BusinessField[];
    readonly readOnly: readonly Phase4ReadOnlyField[];
    readonly editable: readonly Phase4EditableField[];
    readonly serverDerivedTechnical: readonly Phase4ServerDerivedTechnicalField[];
    readonly rejectUnknownOrForbiddenClientFields: true;
  };
  readonly submissions: Readonly<
    Record<Phase4SubmissionType, Phase4SubmissionRule>
  >;
  readonly approval: {
    readonly approvedCoreRowsPerSubmission: 1;
    readonly rejectedCoreRowsPerSubmission: 0;
    readonly sourceSubmissionIdUniqueGlobally: true;
    readonly snapshotIdRule: "NEW_ONE_ROW_BATCH_ID_PER_APPROVAL";
    readonly sttRule: "POSTGRESQL_SEQUENCE_ON_APPROVAL";
    readonly applicationMaxSttAllowed: false;
    readonly staleBaseApprovalAllowed: false;
  };
  readonly approvalUnit: {
    readonly existingRecordSource: "CURRENT_CORE_VERSION";
    readonly createNewSource: "UNIQUE_CURRENT_LECTURER_UNIT";
    readonly ambiguousOrMissingBehavior: "BLOCK_SUBMISSION";
    readonly clientValueTrusted: false;
    readonly syntheticLeaderAllowed: false;
    readonly inferredLeaderEmailAllowed: false;
    readonly unassignedUnitCanReceivePending: true;
  };
  readonly authorization: {
    readonly lecturerUidSource: "ACTIVE_PRINCIPAL";
    readonly terminalActors: readonly ["ADMIN", "ASSIGNED_FACULTY_LEADER"];
    readonly clientScopeTrusted: false;
  };
  readonly concurrency: {
    readonly transactionIsolation: "SERIALIZABLE";
    readonly advisoryLockKey: "RECORD_UID";
    readonly advisoryLockLifetime: "TRANSACTION";
  };
  readonly latestVersion: {
    readonly partitionBy: "record_uid";
    readonly orderBy: "version_no DESC";
    readonly rowsPerRecordUid: 1;
    readonly lecturerSnapshotSelectionAllowed: false;
    readonly maxSttSelectionAllowed: false;
  };
}

export const PHASE_4_WORKFLOW_POLICY = {
  version: 1,
  unitOfWork: "ONE_SUBMISSION_ONE_LOGICAL_ROW_ONE_RECORD_UID",
  appendOnly: {
    workflowEvent: true,
    coreData: true,
  },
  events: {
    initial: "SUBMITTED",
    transitions: {
      SUBMITTED: ["REJECTED", "APPROVED"],
      REJECTED: [],
      APPROVED: [],
    },
    exactlyOneSubmittedPerSubmission: true,
    maximumTerminalEventsPerSubmission: 1,
  },
  pending: {
    maximumPerRecordUid: 1,
    multiplePerLecturerAcrossDifferentRecords: true,
  },
  resubmission: {
    rejectedSubmissionIsImmutable: true,
    newSubmissionIdRequired: true,
    parentMustBeRejectedSubmission: true,
    preserveRecordUid: true,
  },
  fields: {
    business: PHASE_4_BUSINESS_FIELDS,
    readOnly: PHASE_4_READ_ONLY_FIELDS,
    editable: PHASE_4_EDITABLE_FIELDS,
    serverDerivedTechnical: PHASE_4_SERVER_DERIVED_TECHNICAL_FIELDS,
    rejectUnknownOrForbiddenClientFields: true,
  },
  submissions: {
    CONFIRM_UNCHANGED: {
      existingCoreRowRequired: true,
      baseVersionRequired: true,
      recordUidRule: "REUSE_SERVER_RESOLVED_RECORD_UID",
      submittedRowRule: "COPY_SERVER_RESOLVED_CURRENT_ROW",
      approvedVersionRule: "CURRENT_VERSION_PLUS_ONE",
    },
    UPDATE_EXISTING: {
      existingCoreRowRequired: true,
      baseVersionRequired: true,
      recordUidRule: "REUSE_SERVER_RESOLVED_RECORD_UID",
      submittedRowRule:
        "MERGE_EDITABLE_FIELDS_INTO_SERVER_RESOLVED_CURRENT_ROW",
      approvedVersionRule: "CURRENT_VERSION_PLUS_ONE",
    },
    CREATE_NEW: {
      existingCoreRowRequired: false,
      baseVersionRequired: false,
      recordUidRule: "GENERATE_ON_INITIAL_SUBMISSION_REUSE_ON_RESUBMIT",
      submittedRowRule:
        "MERGE_EDITABLE_FIELDS_WITH_SERVER_RESOLVED_LECTURER_IDENTITY",
      approvedVersionRule: "VERSION_ONE",
    },
  },
  approval: {
    approvedCoreRowsPerSubmission: 1,
    rejectedCoreRowsPerSubmission: 0,
    sourceSubmissionIdUniqueGlobally: true,
    snapshotIdRule: "NEW_ONE_ROW_BATCH_ID_PER_APPROVAL",
    sttRule: "POSTGRESQL_SEQUENCE_ON_APPROVAL",
    applicationMaxSttAllowed: false,
    staleBaseApprovalAllowed: false,
  },
  approvalUnit: {
    existingRecordSource: "CURRENT_CORE_VERSION",
    createNewSource: "UNIQUE_CURRENT_LECTURER_UNIT",
    ambiguousOrMissingBehavior: "BLOCK_SUBMISSION",
    clientValueTrusted: false,
    syntheticLeaderAllowed: false,
    inferredLeaderEmailAllowed: false,
    unassignedUnitCanReceivePending: true,
  },
  authorization: {
    lecturerUidSource: "ACTIVE_PRINCIPAL",
    terminalActors: ["ADMIN", "ASSIGNED_FACULTY_LEADER"],
    clientScopeTrusted: false,
  },
  concurrency: {
    transactionIsolation: "SERIALIZABLE",
    advisoryLockKey: "RECORD_UID",
    advisoryLockLifetime: "TRANSACTION",
  },
  latestVersion: {
    partitionBy: "record_uid",
    orderBy: "version_no DESC",
    rowsPerRecordUid: 1,
    lecturerSnapshotSelectionAllowed: false,
    maxSttSelectionAllowed: false,
  },
} as const satisfies Phase4WorkflowPolicy;
