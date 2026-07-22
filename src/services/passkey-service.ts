import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type WebAuthnCredential
} from "@simplewebauthn/server";
import { pool } from "../db/pool.js";
import type { PasskeyConfiguration } from "./passkey-settings-service.js";
import type { DbNumeric, DbQueryResult } from "../types/db.js";
import type { Role } from "../types/domain.js";
import type { UserId } from "../types/http.js";
import { HttpError } from "../utils/http-error.js";

export interface PasskeyUser {
  id: UserId;
  username: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
}

interface PasskeyRow {
  id: DbNumeric;
  credential_id: string;
  public_key: Buffer;
  counter: DbNumeric;
  transports: unknown;
  user_id: DbNumeric;
  username: string;
  full_name: string;
  role: Role;
  must_change_password: boolean;
}

export interface PasskeyWebAuthn {
  generateRegistrationOptions: typeof generateRegistrationOptions;
  verifyRegistrationResponse: typeof verifyRegistrationResponse;
  generateAuthenticationOptions: typeof generateAuthenticationOptions;
  verifyAuthenticationResponse: typeof verifyAuthenticationResponse;
}

export const simpleWebAuthn: PasskeyWebAuthn = {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
};

function asCounter(value: DbNumeric): number {
  const counter = Number(value);
  return Number.isSafeInteger(counter) && counter >= 0 ? counter : 0;
}

function transports(value: unknown): AuthenticatorTransportFuture[] {
  const list = Array.isArray(value) ? value : [];
  return list.filter((item): item is AuthenticatorTransportFuture =>
    typeof item === "string" && ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"].includes(item)
  );
}

function assertResponse(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, message);
  }
  return value as Record<string, unknown>;
}

export async function registrationOptionsForUser(user: PasskeyUser, configuration: PasskeyConfiguration, webauthn: PasskeyWebAuthn = simpleWebAuthn) {
  const credentials = await pool.query<{ credential_id: string; transports: unknown }>(
    "select credential_id, transports from user_passkeys where user_id = $1 order by id",
    [user.id]
  );
  return webauthn.generateRegistrationOptions({
    rpName: configuration.rpName,
    rpID: configuration.rpId,
    userID: new TextEncoder().encode(String(user.id)),
    userName: user.username,
    userDisplayName: user.fullName || user.username,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    excludeCredentials: credentials.rows.map((credential) => ({
      id: credential.credential_id,
      transports: transports(credential.transports)
    }))
  });
}

export async function authenticationOptions(configuration: PasskeyConfiguration, webauthn: PasskeyWebAuthn = simpleWebAuthn) {
  return webauthn.generateAuthenticationOptions({
    rpID: configuration.rpId,
    userVerification: "required"
  });
}

export async function verifyAndStoreRegistration(
  userId: UserId,
  responseValue: unknown,
  expectedChallenge: string,
  configuration: PasskeyConfiguration,
  webauthn: PasskeyWebAuthn = simpleWebAuthn
): Promise<void> {
  const response = assertResponse(responseValue, "Passkey registration response is required.") as unknown as RegistrationResponseJSON;
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await webauthn.verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: configuration.origin,
      expectedRPID: configuration.rpId,
      requireUserVerification: true
    });
  } catch {
    throw new HttpError(400, "Passkey registration could not be verified.");
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new HttpError(400, "Passkey registration could not be verified.");
  }

  const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo;
  const result = await pool.query(
    `insert into user_passkeys (user_id, credential_id, public_key, counter, device_type, backed_up, transports)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)
     on conflict (credential_id) do nothing
     returning id`,
    [
      userId,
      credential.id,
      Buffer.from(credential.publicKey),
      credential.counter,
      credentialDeviceType,
      credentialBackedUp,
      JSON.stringify(transports(response.response.transports))
    ]
  );
  if (!result.rowCount) {
    throw new HttpError(409, "This passkey is already registered.");
  }
}

export async function verifyPasskeyLogin(
  responseValue: unknown,
  expectedChallenge: string,
  configuration: PasskeyConfiguration,
  webauthn: PasskeyWebAuthn = simpleWebAuthn
): Promise<PasskeyUser> {
  const response = assertResponse(responseValue, "Passkey sign-in response is required.") as unknown as AuthenticationResponseJSON;
  if (!response.id) throw new HttpError(400, "Passkey sign-in response is required.");
  const stored = (await pool.query(
    `select p.id, p.credential_id, p.public_key, p.counter, p.transports, p.user_id,
            u.username, u.full_name, u.role, coalesce(u.must_change_password, false) as must_change_password
     from user_passkeys p
     join users u on u.id = p.user_id
     where p.credential_id = $1 and u.is_active = true
     limit 1`,
    [response.id]
  )) as DbQueryResult<PasskeyRow>;
  const passkey = stored.rows[0];
  if (!passkey) throw new HttpError(401, "Passkey sign-in failed.");

  const credential: WebAuthnCredential = {
    id: passkey.credential_id,
    publicKey: new Uint8Array(passkey.public_key),
    counter: asCounter(passkey.counter),
    transports: transports(passkey.transports)
  };
  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await webauthn.verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: configuration.origin,
      expectedRPID: configuration.rpId,
      credential,
      requireUserVerification: true
    });
  } catch {
    throw new HttpError(401, "Passkey sign-in failed.");
  }
  if (!verification.verified) throw new HttpError(401, "Passkey sign-in failed.");

  await pool.query(
    "update user_passkeys set counter = $2, device_type = $3, backed_up = $4 where id = $1",
    [passkey.id, verification.authenticationInfo.newCounter, verification.authenticationInfo.credentialDeviceType, verification.authenticationInfo.credentialBackedUp]
  );
  return {
    id: passkey.user_id,
    username: passkey.username,
    fullName: passkey.full_name,
    role: passkey.role,
    mustChangePassword: passkey.must_change_password
  };
}
