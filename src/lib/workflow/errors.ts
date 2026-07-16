export const WORKFLOW_ERROR_CODES = [
  "WORKFLOW_INVALID_STATE",
  "WORKFLOW_ALREADY_PENDING",
  "WORKFLOW_STALE_BASE",
  "WORKFLOW_NOT_OWNER",
  "WORKFLOW_UNIT_UNRESOLVED",
  "WORKFLOW_SCOPE_DENIED",
  "WORKFLOW_ALREADY_TERMINAL",
  "WORKFLOW_PAYLOAD_MISMATCH",
  "WORKFLOW_INVALID_PAYLOAD",
  "WORKFLOW_RECORD_NOT_FOUND",
  "WORKFLOW_SUBMISSION_NOT_FOUND",
] as const;

export type WorkflowErrorCode = (typeof WORKFLOW_ERROR_CODES)[number];

const ERROR_DEFINITIONS = {
  WORKFLOW_INVALID_STATE: {
    status: 409,
    message: "The workflow state is invalid for this operation.",
  },
  WORKFLOW_ALREADY_PENDING: {
    status: 409,
    message: "A pending submission already exists for this record.",
  },
  WORKFLOW_STALE_BASE: {
    status: 409,
    message: "The submission is based on an outdated record version.",
  },
  WORKFLOW_NOT_OWNER: {
    status: 403,
    message: "The requested workflow resource is outside the allowed scope.",
  },
  WORKFLOW_UNIT_UNRESOLVED: {
    status: 409,
    message: "The approval unit cannot be resolved uniquely.",
  },
  WORKFLOW_SCOPE_DENIED: {
    status: 403,
    message: "The operation is not allowed in the current workflow scope.",
  },
  WORKFLOW_ALREADY_TERMINAL: {
    status: 409,
    message: "The submission has already reached a terminal state.",
  },
  WORKFLOW_PAYLOAD_MISMATCH: {
    status: 409,
    message: "The workflow payload does not match the submitted contract.",
  },
  WORKFLOW_INVALID_PAYLOAD: {
    status: 400,
    message: "The workflow payload is invalid.",
  },
  WORKFLOW_RECORD_NOT_FOUND: {
    status: 404,
    message: "The workflow record was not found.",
  },
  WORKFLOW_SUBMISSION_NOT_FOUND: {
    status: 404,
    message: "The workflow submission was not found.",
  },
} as const satisfies Record<
  WorkflowErrorCode,
  { readonly status: 400 | 403 | 404 | 409; readonly message: string }
>;

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;
  readonly httpStatus: 400 | 403 | 404 | 409;

  constructor(code: WorkflowErrorCode) {
    const definition = ERROR_DEFINITIONS[code];
    super(definition.message);
    this.name = "WorkflowError";
    this.code = code;
    this.httpStatus = definition.status;
  }
}

export function getWorkflowHttpStatus(
  code: WorkflowErrorCode,
): 400 | 403 | 404 | 409 {
  return ERROR_DEFINITIONS[code].status;
}

export function isWorkflowError(value: unknown): value is WorkflowError {
  return value instanceof WorkflowError;
}
