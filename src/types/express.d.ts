import "express";

declare global {
  namespace Express {
    interface UserClaims {
      sub: number | string;
      username?: string;
      fullName?: string;
      role: "receptionist" | "supervisor" | "modality_staff" | string;
      purpose?: string;
    }

    interface Request {
      user?: UserClaims;
    }
  }
}

export {};
