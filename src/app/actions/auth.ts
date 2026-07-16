"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth/server";
import { recordLoginFailure } from "@/lib/auth/audit-writer";
import {
  extractLoginIdentifier,
  genericSignInFailure,
  parseSignInCredentials,
  type SignInActionState,
} from "@/lib/auth/sign-in-policy";

export async function signInAction(
  _previousState: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  const credentials = parseSignInCredentials(formData);
  if (!credentials.success) {
    await recordLoginFailure(extractLoginIdentifier(formData));
    return genericSignInFailure();
  }

  try {
    await getAuth().api.signInEmail({
      headers: await headers(),
      body: credentials.data,
    });
  } catch {
    await recordLoginFailure(credentials.data.email);
    return genericSignInFailure();
  }

  redirect("/dashboard");
}

export async function signOutAction(): Promise<never> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/sign-in");
}
