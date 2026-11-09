import type { SscasnAdminData, SscasnMatch } from "@/lib/sscasn";
import type { SscasnAuditResponse, SscasnManualSelection } from "@/lib/sscasnReconciliation";

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "Data SSCASN belum dapat diproses.");
  return body as T;
}

export async function getAdminSscasn(
  password: string,
  filters: { institution: string; query: string; page: number },
): Promise<SscasnAdminData> {
  const params = new URLSearchParams({ ...filters, page: String(filters.page) });
  return readResponse(
    await fetch(`/api/admin/sscasn?${params}`, {
      headers: { "x-admin-password": password },
    }),
  );
}

export async function saveAdminSscasnMatch(
  password: string,
  input: Omit<SscasnMatch, "reviewed_at">,
) {
  return readResponse<{ saved: boolean }>(
    await fetch("/api/admin/sscasn", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-password": password },
      body: JSON.stringify(input),
    }),
  );
}

export async function getAdminSscasnAuditInstitutions(password: string) {
  return readResponse<{ institutions: string[] }>(
    await fetch("/api/admin/sscasn?mode=audit-institutions", {
      headers: { "x-admin-password": password },
    }),
  );
}

export async function getAdminSscasnAudit(
  password: string,
  params: { institution: string; page: number },
) {
  const search = new URLSearchParams({ ...params, mode: "audit", page: String(params.page) });
  return readResponse<SscasnAuditResponse>(
    await fetch(`/api/admin/sscasn?${search}`, {
      headers: { "x-admin-password": password },
    }),
  );
}

export async function approveAdminSscasnAudit(password: string, institution: string) {
  return readResponse<SscasnAuditResponse>(
    await fetch("/api/admin/sscasn", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-password": password },
      body: JSON.stringify({ action: "approve-audit", institution }),
    }),
  );
}

export async function approveAdminSscasnSelection(
  password: string,
  input: {
    institution: string;
    selections: SscasnManualSelection[];
    note: string;
    page: number;
  },
) {
  return readResponse<SscasnAuditResponse>(
    await fetch("/api/admin/sscasn", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-password": password },
      body: JSON.stringify({ action: "approve-selected", ...input }),
    }),
  );
}
