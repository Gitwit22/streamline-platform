export type UiRolePresetId = "participant" | "cohost";

export function normalizeUiRolePresetId(raw: any): UiRolePresetId {
  return raw === "cohost" ? "cohost" : "participant";
}
