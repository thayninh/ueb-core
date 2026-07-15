import { z } from "zod";

export const GENERIC_SIGN_IN_ERROR = "Email hoặc mật khẩu không chính xác.";

export interface SignInActionState {
  readonly error: string | null;
}

const signInCredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(128),
});

export function parseSignInCredentials(formData: FormData):
  | {
      success: true;
      data: { email: string; password: string };
    }
  | { success: false } {
  const result = signInCredentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) return { success: false };
  return { success: true, data: result.data };
}

export function genericSignInFailure(): SignInActionState {
  return { error: GENERIC_SIGN_IN_ERROR };
}
