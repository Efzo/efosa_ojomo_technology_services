import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export function businessDatabaseReady() { return process.env.DEMO_MODE !== "true" && Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL?.includes("demo_"); }
export async function requireBusinessOwner() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Sign in as the owner to open business operations.");
  if (!businessDatabaseReady()) {
    if ((session.user as { role?: string }).role !== "OWNER") throw new Error("Business operations is restricted to the owner.");
    return null;
  }
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } });
  if (user?.role !== "OWNER") throw new Error("Business operations is restricted to the owner.");
  return user.id;
}
