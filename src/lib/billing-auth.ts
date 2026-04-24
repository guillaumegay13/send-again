import type { WorkspaceAuthResult } from "@/lib/auth";
import { isBillingUnlimitedForUser } from "@/lib/billing";
import { getAuthUserEmailById, getPreferredWorkspaceUserId } from "@/lib/db";

export interface WorkspaceBillingIdentity {
  userId: string | null;
  email: string | null;
  billingBypass: boolean;
}

export async function resolveWorkspaceBillingIdentity(
  auth: WorkspaceAuthResult,
  workspaceId: string
): Promise<WorkspaceBillingIdentity> {
  const userId = auth.userId ?? (await getPreferredWorkspaceUserId(workspaceId));
  let email = auth.userEmail ?? null;

  if (!email && userId) {
    try {
      email = await getAuthUserEmailById(userId);
    } catch (error) {
      console.error("Failed to resolve billing auth user email:", error);
    }
  }

  return {
    userId,
    email,
    billingBypass: isBillingUnlimitedForUser({ userId, email }),
  };
}
