import { createHash } from "node:crypto";
import { canonicalHardwareIdentity, publicRigIdFromFingerprint, type HardwareSpec } from "./protocol";

export function hardwareIdentity(hardware: HardwareSpec) {
  const fingerprint = createHash("sha256").update(canonicalHardwareIdentity(hardware)).digest("hex");
  return { fingerprint, publicRigId: publicRigIdFromFingerprint(fingerprint) };
}
