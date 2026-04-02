export type CollaboratorPermissions = {
  createRooms: boolean;
  startRooms: boolean;
  joinInvisibleProducer: boolean;
  manageParticipants: boolean;
  controlLayouts: boolean;
  manageRecording: boolean;
  manageStreaming: boolean;
};

export type LinkedOwnerAccount = {
  relationshipId: string;
  ownerUid: string;
  ownerDisplayName: string | null;
  ownerEmail: string | null;
  permissions: CollaboratorPermissions;
};

export type CollaboratorRelationshipSummary = {
  id: string;
  status: "pending" | "accepted" | "declined" | "revoked";
  ownerUid: string;
  ownerDisplayName: string | null;
  ownerEmail: string | null;
  collaboratorUid: string;
  collaboratorDisplayName: string | null;
  collaboratorEmail: string | null;
  invitedByUid: string | null;
  permissions: CollaboratorPermissions;
  viewerRole: "owner" | "collaborator";
  counterpartyLabel: string;
  counterpartyEmail: string | null;
};

export type CollaboratorsPayload = {
  outgoing: CollaboratorRelationshipSummary[];
  incoming: CollaboratorRelationshipSummary[];
  linkedOwners: LinkedOwnerAccount[];
};

export type SelectedOwnerContext = {
  ownerUid: string | null;
  ownerDisplayName: string | null;
  ownerEmail: string | null;
};

const STORAGE_KEY = "sl_selected_owner_context";

export function getSelectedOwnerContext(): SelectedOwnerContext {
  if (typeof window === "undefined") {
    return { ownerUid: null, ownerDisplayName: null, ownerEmail: null };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ownerUid: null, ownerDisplayName: null, ownerEmail: null };
    const parsed = JSON.parse(raw) as SelectedOwnerContext;
    return {
      ownerUid: typeof parsed?.ownerUid === "string" && parsed.ownerUid.trim() ? parsed.ownerUid.trim() : null,
      ownerDisplayName: typeof parsed?.ownerDisplayName === "string" ? parsed.ownerDisplayName : null,
      ownerEmail: typeof parsed?.ownerEmail === "string" ? parsed.ownerEmail : null,
    };
  } catch {
    return { ownerUid: null, ownerDisplayName: null, ownerEmail: null };
  }
}

export function setSelectedOwnerContext(context: SelectedOwnerContext): void {
  if (typeof window === "undefined") return;
  if (!context.ownerUid) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(context));
}

export function clearSelectedOwnerContext(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
