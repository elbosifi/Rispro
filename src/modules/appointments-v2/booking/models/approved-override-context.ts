import type { Role } from "../../../../types/domain.js";
import type { SchedulingOverrideType } from "../../shared/types/common.js";

export interface ApprovedOverrideContext {
  approverUserId: number;
  approverRole: Role;
  overrideType: SchedulingOverrideType;
  reason: string;
  source: "deferred_approval";
  requestId: number;
}
