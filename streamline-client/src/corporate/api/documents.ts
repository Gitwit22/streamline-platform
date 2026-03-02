import { apiFetchAuth } from "@/lib/api";

export interface Document {
  id: string;
  title: string;
  category: string;
  version: string;
  description: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  requiresAcknowledgment: boolean;
  totalAcknowledged: number;
  totalRequired: number;
  updatedAt: number | null;
  createdAt: number | null;
  createdBy: string;
}

export async function fetchDocuments(params?: {
  category?: string;
  limit?: number;
}): Promise<Document[]> {
  const qs = new URLSearchParams();
  if (params?.category) qs.set("category", params.category);
  if (params?.limit) qs.set("limit", String(params.limit));
  const url = `/api/corp/documents${qs.toString() ? "?" + qs : ""}`;
  const res = await apiFetchAuth(url);
  if (!res.ok) throw new Error("fetch_documents_failed");
  const data = await res.json();
  return data.documents;
}

export async function createDocument(body: {
  title: string;
  category?: string;
  version?: string;
  description?: string;
  fileUrl?: string;
  fileSize?: number;
  mimeType?: string;
  requiresAcknowledgment?: boolean;
}): Promise<Document> {
  const res = await apiFetchAuth("/api/corp/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "create_document_failed");
  }
  const data = await res.json();
  return data.document;
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await apiFetchAuth(`/api/corp/documents/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "delete_document_failed");
  }
}

export async function acknowledgeDocument(id: string): Promise<{ totalAcknowledged: number }> {
  const res = await apiFetchAuth(`/api/corp/documents/${id}/acknowledge`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("acknowledge_failed");
  return res.json();
}
