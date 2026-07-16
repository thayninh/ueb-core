import type {
  Phase4BusinessField,
  Phase4EditableField,
  Phase4EventType,
  Phase4ReadOnlyField,
  Phase4SubmissionPayloadField,
  Phase4SubmissionReadOnlyField,
  Phase4SubmissionType,
  Phase4WorkflowState,
} from "../../../config/phase-4/workflow-policy";

export type SubmissionType = Phase4SubmissionType;
export type WorkflowEventType = Phase4EventType;
export type SubmissionState = Phase4WorkflowState;
export type BusinessFieldName = Phase4BusinessField;
export type EditableBusinessFieldName = Phase4EditableField;
export type ReadOnlyBusinessFieldName = Phase4ReadOnlyField;
export type SubmissionPayloadFieldName = Phase4SubmissionPayloadField;
export type SubmissionReadOnlyFieldName = Phase4SubmissionReadOnlyField;

export interface CoreBusinessRow {
  readonly stt: number;
  readonly don_vi_phu_trach_hoc_phan: string | null;
  readonly bo_mon_phu_trach_hoc_phan: string | null;
  readonly khoi_kien_thuc: number;
  readonly ma_hoc_phan: string | null;
  readonly ten_hoc_phan: string | null;
  readonly ten_giang_vien: string | null;
  readonly ma_so_can_bo: string | null;
  readonly email_tai_khoan_vnu: string | null;
  readonly bo_mon: string | null;
  readonly don_vi: string | null;
  readonly core_1_2_3: string | null;
  readonly tc1_tro_giang: string | null;
  readonly tc2_sh_chuyen_mon: string | null;
  readonly tc3_tong_hop: string | null;
  readonly tc3_1_nganh_tot_nghiep_phu_hop: string | null;
  readonly tc3_2_bien_soan_de_cuong_giao_trinh: string | null;
  readonly tc3_3_chu_nhiem_de_tai_nckh_lien_quan: string | null;
  readonly tc3_4_bai_bao_lien_quan: string | null;
  readonly tc4_giang_thu: string | null;
}

export type RowSubmissionPayload = Omit<CoreBusinessRow, "stt">;

export type EditableBusinessFields = Readonly<
  Pick<RowSubmissionPayload, EditableBusinessFieldName>
>;

export type CreateNewServerDerivedFields = Readonly<
  Pick<RowSubmissionPayload, SubmissionReadOnlyFieldName>
>;

interface WorkflowEventBase {
  readonly eventId: string;
  readonly submissionId: string;
  readonly recordUid: string;
  readonly lecturerUid: string;
  readonly approvalUnit: string;
  readonly actorUserId: string;
  readonly createdAt: Date;
}

interface SubmittedWorkflowEventBase extends WorkflowEventBase {
  readonly eventType: "SUBMITTED";
  readonly parentSubmissionId: string | null;
  readonly payload: RowSubmissionPayload;
  readonly payloadChecksum: string;
}

interface ExistingRowSubmittedWorkflowEvent extends SubmittedWorkflowEventBase {
  readonly submissionType: "CONFIRM_UNCHANGED" | "UPDATE_EXISTING";
  readonly baseStt: number;
  readonly baseVersionNo: number;
}

interface CreateNewSubmittedWorkflowEvent extends SubmittedWorkflowEventBase {
  readonly submissionType: "CREATE_NEW";
  readonly baseStt: null;
  readonly baseVersionNo: null;
}

export type SubmittedWorkflowEvent =
  ExistingRowSubmittedWorkflowEvent | CreateNewSubmittedWorkflowEvent;

export interface RejectedWorkflowEvent extends WorkflowEventBase {
  readonly eventType: "REJECTED";
  readonly reason: string;
}

export interface ApprovedWorkflowEvent extends WorkflowEventBase {
  readonly eventType: "APPROVED";
  readonly resultStt: number;
  readonly resultVersionNo: number;
}

export type TerminalWorkflowEvent =
  RejectedWorkflowEvent | ApprovedWorkflowEvent;

export type WorkflowEvent = SubmittedWorkflowEvent | TerminalWorkflowEvent;

export interface ResolvedSubmission {
  readonly submissionId: string;
  readonly submissionType: SubmissionType;
  readonly recordUid: string;
  readonly lecturerUid: string;
  readonly approvalUnit: string;
  readonly state: SubmissionState;
  readonly submittedEvent: SubmittedWorkflowEvent;
  readonly terminalEvent: TerminalWorkflowEvent | null;
  readonly parentSubmissionId: string | null;
}
