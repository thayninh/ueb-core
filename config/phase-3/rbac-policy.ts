export const BUSINESS_ROLES = ["LECTURER", "FACULTY_LEADER", "ADMIN"] as const;

export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export const CORE_DATA_ACTIONS = [
  "READ",
  "CREATE",
  "UPDATE",
  "DELETE",
] as const;

export type CoreDataAction = (typeof CORE_DATA_ACTIONS)[number];

export const ADMIN_ACTIONS = [
  "CREATE_ACCOUNT",
  "DISABLE_ACCOUNT",
  "ASSIGN_ROLE",
  "REVOKE_ROLE",
  "ASSIGN_APPROVAL_UNIT",
  "REVOKE_APPROVAL_UNIT",
  "REVOKE_SESSION",
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export const READ_SCOPES = [
  "NONE",
  "SELF_LECTURER_UID",
  "ASSIGNED_APPROVAL_UNITS",
  "ALL",
] as const;

export type ReadScope = (typeof READ_SCOPES)[number];

export interface RolePolicy {
  readonly coreData: {
    readonly readScopes: readonly ReadScope[];
    readonly allowedMutations: readonly Exclude<CoreDataAction, "READ">[];
  };
  readonly administration: readonly AdminAction[];
  readonly requirements: {
    readonly lecturerUidMapping: boolean;
    readonly assignedApprovalUnit: boolean;
  };
}

export interface Phase3RbacPolicy {
  readonly version: 1;
  readonly denyByDefault: true;
  readonly roleComposition: "UNION_OF_GRANTS";
  readonly secureAuthorization: {
    readonly source: "DATABASE";
    readonly layers: readonly ["DAL", "DTO", "POSTGRESQL_RLS"];
    readonly cookieOnlyAuthorizationAllowed: false;
    readonly proxyMode: "OPTIMISTIC_REDIRECT_ONLY";
    readonly clientProvidedScopeTrusted: false;
    readonly rlsContextLifetime: "TRANSACTION_LOCAL";
  };
  readonly identity: {
    readonly maximumLecturerUidsPerUser: 1;
    readonly primaryEmailsPerUser: 1;
    readonly emailAliasesSupported: false;
    readonly emailNormalization: readonly ["TRIM", "LOWERCASE"];
  };
  readonly organizationalUnits: {
    readonly unassignedUnitBehavior: "DENY_LEADER_SCOPE";
    readonly syntheticLeadersAllowed: false;
    readonly inferredLeaderEmailsAllowed: false;
    readonly multipleUnitsPerLeaderAllowed: true;
  };
  readonly coreData: {
    readonly phase3Mode: "READ_ONLY";
    readonly table: "ueb_core_data";
  };
  readonly roles: Readonly<Record<BusinessRole, RolePolicy>>;
}

const NO_CORE_MUTATIONS = [] as const;
const NO_ADMIN_ACTIONS = [] as const;

export const PHASE_3_RBAC_POLICY = {
  version: 1,
  denyByDefault: true,
  roleComposition: "UNION_OF_GRANTS",
  secureAuthorization: {
    source: "DATABASE",
    layers: ["DAL", "DTO", "POSTGRESQL_RLS"],
    cookieOnlyAuthorizationAllowed: false,
    proxyMode: "OPTIMISTIC_REDIRECT_ONLY",
    clientProvidedScopeTrusted: false,
    rlsContextLifetime: "TRANSACTION_LOCAL",
  },
  identity: {
    maximumLecturerUidsPerUser: 1,
    primaryEmailsPerUser: 1,
    emailAliasesSupported: false,
    emailNormalization: ["TRIM", "LOWERCASE"],
  },
  organizationalUnits: {
    unassignedUnitBehavior: "DENY_LEADER_SCOPE",
    syntheticLeadersAllowed: false,
    inferredLeaderEmailsAllowed: false,
    multipleUnitsPerLeaderAllowed: true,
  },
  coreData: {
    phase3Mode: "READ_ONLY",
    table: "ueb_core_data",
  },
  roles: {
    LECTURER: {
      coreData: {
        readScopes: ["SELF_LECTURER_UID"],
        allowedMutations: NO_CORE_MUTATIONS,
      },
      administration: NO_ADMIN_ACTIONS,
      requirements: {
        lecturerUidMapping: true,
        assignedApprovalUnit: false,
      },
    },
    FACULTY_LEADER: {
      coreData: {
        readScopes: ["ASSIGNED_APPROVAL_UNITS"],
        allowedMutations: NO_CORE_MUTATIONS,
      },
      administration: NO_ADMIN_ACTIONS,
      requirements: {
        lecturerUidMapping: false,
        assignedApprovalUnit: true,
      },
    },
    ADMIN: {
      coreData: {
        readScopes: ["ALL"],
        allowedMutations: NO_CORE_MUTATIONS,
      },
      administration: [
        "CREATE_ACCOUNT",
        "DISABLE_ACCOUNT",
        "ASSIGN_ROLE",
        "REVOKE_ROLE",
        "ASSIGN_APPROVAL_UNIT",
        "REVOKE_APPROVAL_UNIT",
        "REVOKE_SESSION",
      ],
      requirements: {
        lecturerUidMapping: false,
        assignedApprovalUnit: false,
      },
    },
  },
} as const satisfies Phase3RbacPolicy;
