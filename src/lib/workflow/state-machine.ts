import { WorkflowError } from "./errors";

import type {
  ResolvedSubmission,
  SubmittedWorkflowEvent,
  TerminalWorkflowEvent,
  WorkflowEvent,
} from "./types";

function invalidState(): never {
  throw new WorkflowError("WORKFLOW_INVALID_STATE");
}

function eventTimestamp(event: WorkflowEvent): number {
  const timestamp = event.createdAt.getTime();
  if (!Number.isFinite(timestamp)) {
    return invalidState();
  }
  return timestamp;
}

function compareEvents(left: WorkflowEvent, right: WorkflowEvent): number {
  const timestampDifference = eventTimestamp(left) - eventTimestamp(right);
  if (timestampDifference !== 0) {
    return timestampDifference;
  }
  return left.eventId.localeCompare(right.eventId);
}

function isTerminalEvent(event: WorkflowEvent): event is TerminalWorkflowEvent {
  return event.eventType === "REJECTED" || event.eventType === "APPROVED";
}

function hasMatchingIdentity(
  event: WorkflowEvent,
  submitted: SubmittedWorkflowEvent,
): boolean {
  return (
    event.submissionId === submitted.submissionId &&
    event.recordUid === submitted.recordUid &&
    event.lecturerUid === submitted.lecturerUid &&
    event.approvalUnit === submitted.approvalUnit
  );
}

export function resolveSubmission(
  events: readonly WorkflowEvent[],
): ResolvedSubmission {
  if (events.length === 0) {
    return invalidState();
  }

  const eventIds = new Set(events.map((event) => event.eventId));
  if (eventIds.size !== events.length) {
    return invalidState();
  }

  const sortedEvents = [...events].sort(compareEvents);
  const submittedEvents = sortedEvents.filter(
    (event): event is SubmittedWorkflowEvent => event.eventType === "SUBMITTED",
  );
  const terminalEvents = sortedEvents.filter(isTerminalEvent);

  if (submittedEvents.length !== 1 || terminalEvents.length > 1) {
    return invalidState();
  }

  const submittedEvent = submittedEvents[0];
  if (
    sortedEvents.length !== 1 + terminalEvents.length ||
    sortedEvents[0] !== submittedEvent ||
    sortedEvents.some((event) => !hasMatchingIdentity(event, submittedEvent))
  ) {
    return invalidState();
  }

  const terminalEvent = terminalEvents[0] ?? null;
  if (terminalEvent !== null && sortedEvents[1] !== terminalEvent) {
    return invalidState();
  }

  const state = terminalEvent?.eventType ?? "PENDING";

  return {
    submissionId: submittedEvent.submissionId,
    submissionType: submittedEvent.submissionType,
    recordUid: submittedEvent.recordUid,
    lecturerUid: submittedEvent.lecturerUid,
    approvalUnit: submittedEvent.approvalUnit,
    state,
    submittedEvent,
    terminalEvent,
    parentSubmissionId: submittedEvent.parentSubmissionId,
  };
}

function assertPending(resolved: ResolvedSubmission): void {
  if (resolved.state !== "PENDING") {
    throw new WorkflowError("WORKFLOW_ALREADY_TERMINAL");
  }
}

export function assertSubmissionCanBeRejected(
  resolved: ResolvedSubmission,
): void {
  assertPending(resolved);
}

export function assertSubmissionCanBeApproved(
  resolved: ResolvedSubmission,
): void {
  assertPending(resolved);
}
