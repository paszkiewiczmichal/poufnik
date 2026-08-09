export type ProductTier = "basic" | "early_bird";

export interface AuthenticatedSession {
  accessToken: string;
  accountId: string;
  email: string;
  tier: "early_bird";
  issuedAt: number;
  expiresAt: number;
}

export type AuthState =
  | { status: "loading" }
  | { status: "choice_required" }
  | { status: "basic"; message: string | null }
  | { status: "authenticated"; session: AuthenticatedSession; message: string | null };

export interface LoginCredentials {
  email: string;
  password: string;
}

