export function businessWorkspaceIssue(error: unknown) {
  const failure = error as { code?: unknown; errorCode?: unknown; name?: unknown } | null;
  const value = failure?.code ?? failure?.errorCode;
  const code = typeof value === "string" && /^P\d{4}$/.test(value) ? value : "unknown";
  if (["P2021", "P2022"].includes(code)) return {
    code,
    title: "Workspace database update required",
    message: "The database is reachable, but the business workspace needs a database update. Apply the pending business migrations to the database used by this environment. No records have been changed.",
    href: "/admin/business/setup",
    linkLabel: "Open business setup",
  };
  if (["P1000", "P1001", "P1002", "P1008", "P1017", "P2024"].includes(code)) return {
    code,
    title: "Workspace database connection unavailable",
    message: "The workspace could not complete its database connection. Check this environment's database availability and connection settings, then try again. File storage is configured separately. No records have been changed.",
    href: "/admin/settings#connections",
    linkLabel: "Review database connection",
  };
  return {
    code,
    title: "Business records temporarily unavailable",
    message: "The workspace query could not be completed. Review the server diagnostic code and the deployed database schema. This message does not mean that file storage is disconnected. No records have been changed.",
    href: "/admin/settings#connections",
    linkLabel: "Review connection settings",
  };
}
