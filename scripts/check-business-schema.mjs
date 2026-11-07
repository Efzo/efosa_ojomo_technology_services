// Read-only release preflight. Never logs connection strings or customer data.
import nextEnv from '@next/env';
import { PrismaClient } from '@prisma/client';
nextEnv.loadEnvConfig(process.cwd());
const connection = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
if (!connection) { console.error('Database configuration missing.'); process.exit(1); }
const url = new URL(connection);
if (!process.env.DATABASE_URL_POOLED && url.hostname === 'db.prisma.io') url.hostname = 'pooled.db.prisma.io';
url.searchParams.set('connection_limit', '1');
url.searchParams.set('connect_timeout', '15');
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
try {
 const tables = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
 const business = tables.filter(t => t.table_name.startsWith('Business')).map(t => t.table_name);
 console.log('Database schema connection: successful.');
 console.log('Business tables present:', business.length, 'of 9.');
 if (tables.some(t => t.table_name === '_prisma_migrations')) {
  const migrations = await prisma.$queryRaw`SELECT migration_name, finished_at IS NOT NULL AS applied, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY started_at`;
  console.log('Migration history:', JSON.stringify(migrations));
 } else console.log('Prisma migration history: absent; review before applying migrations.');
 if (process.argv.includes('--require-business')) {
  await Promise.all([prisma.businessClient.findMany({take:1}),prisma.businessEngagement.findMany({take:1}),prisma.businessTask.findMany({take:1}),prisma.businessInvoice.findMany({take:1,include:{payments:true}}),prisma.businessPayment.findMany({take:1}),prisma.businessExpense.findMany({take:1}),prisma.businessTimeEntry.findMany({take:1}),prisma.businessDocument.findMany({take:1,include:{_count:{select:{files:true}}}}),prisma.businessDocumentFile.findMany({take:1})]);
  console.log('All nine business-model queries passed. No customer records were changed.');
 }
} catch(error) {
 const raw = error.code || error.errorCode;
 console.error('Business schema check failed:', typeof raw === 'string' && /^P\d{4}$/.test(raw) ? raw : 'unknown');
 process.exitCode = 1;
} finally { await prisma.$disconnect(); }
