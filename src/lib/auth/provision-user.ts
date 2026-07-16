import "server-only";

export {
  provisionUser,
  type ProvisionUserOptions,
  type ProvisionUserResult,
} from "@/lib/auth/provision-user-core";
export type { ProvisionUserInput } from "@/lib/auth/provisioning-policy";
