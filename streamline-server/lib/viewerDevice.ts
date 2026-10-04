import crypto from "crypto";
import type { Request, Response } from "express";
import { deviceKeyFor, isValidDeviceId } from "./viewerEntitlementsPure";

/**
 * Anonymous viewer device id (httpOnly cookie sl_device_id). Minted on first
 * use. Entitlements store only its hash (deviceKeyFor).
 */
export function getDeviceId(req: Request, res: Response): string {
  let deviceId = (req as any).cookies?.sl_device_id;
  if (!isValidDeviceId(deviceId)) {
    deviceId = crypto.randomUUID();
    res.cookie("sl_device_id", deviceId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 365 * 24 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === "production",
    });
  }
  return deviceId;
}

/** Hashed device key for the request (mints the cookie when missing). */
export function getDeviceKey(req: Request, res: Response): string {
  return deviceKeyFor(getDeviceId(req, res));
}
