import type { Role } from "../../../../types/domain.js";
import type { SchedulingOverrideType } from "../../shared/types/common.js";

interface AuthorizedOverrideContextBase {
  requesterUserId: number;
  approverUserId: number;
  approverRole: Role;
  overrideTypes: SchedulingOverrideType[];
  overrideType?: SchedulingOverrideType;
  reason: string;
}

export type AuthorizedOverrideContext =
  | (AuthorizedOverrideContextBase & {
      source: "deferred_approval";
      requestId: number;
    })
  | (AuthorizedOverrideContextBase & {
      source: "recent_reauth";
    });
