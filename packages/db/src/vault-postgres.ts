import { and, desc, eq } from "drizzle-orm";
import { vaultEncryptedPayloadSchema } from "@toksync/shared";
import { vaultExports } from "./schema";
import type { VaultArtifactStore } from "./vault";
import type { VaultExportRecord } from "./types";

type DrizzleLikeDb = {
  select: () => any;
  insert: (table: unknown) => any;
};

export class PostgresVaultExportRepository {
  constructor(
    private readonly db: DrizzleLikeDb,
    private readonly artifactStore?: VaultArtifactStore,
  ) {}

  async listExports(userId: string) {
    const rows = await this.db
      .select()
      .from(vaultExports)
      .where(
        and(eq(vaultExports.userId, userId), eq(vaultExports.kind, "export")),
      )
      .orderBy(desc(vaultExports.createdAt));
    return rows.map(vaultExportRecordFromPostgresRow);
  }

  async getExport(userId: string, exportId: string) {
    const rows = await this.db
      .select()
      .from(vaultExports)
      .where(
        and(
          eq(vaultExports.userId, userId),
          eq(vaultExports.id, exportId),
          eq(vaultExports.kind, "export"),
        ),
      );
    return rows[0] ? vaultExportRecordFromPostgresRow(rows[0]) : null;
  }

  async insert(record: VaultExportRecord) {
    await this.db
      .insert(vaultExports)
      .values(vaultExportRecordToPostgresRow(record));
  }

  async insertExportWithArtifact(
    record: VaultExportRecord,
    payload: NonNullable<VaultExportRecord["artifact"]>,
  ) {
    const artifactByteSize = Buffer.byteLength(JSON.stringify(payload));
    if (this.artifactStore) {
      await this.insert({
        ...record,
        artifactDigest: payload.payloadDigest,
        artifactByteSize,
        artifactStorageKey: this.artifactStore.put({
          userId: record.userId,
          exportId: record.id,
          payload,
        }),
      });
      return;
    }
    await this.insert({
      ...record,
      artifact: payload,
      artifactDigest: payload.payloadDigest,
      artifactByteSize,
    });
  }

  async getExportArtifact(userId: string, exportId: string) {
    const record = await this.getExport(userId, exportId);
    if (!record) return null;
    const payload = this.loadArtifact(record);
    if (!payload) return null;
    return { export: record, payload, payloadDigest: payload.payloadDigest };
  }

  private loadArtifact(record: VaultExportRecord) {
    if (record.artifact) return record.artifact;
    if (!record.artifactStorageKey || !this.artifactStore) return null;
    const payload = this.artifactStore.get(record.artifactStorageKey);
    if (!payload) return null;
    if (
      record.artifactDigest &&
      payload.payloadDigest !== record.artifactDigest
    ) {
      throw new Error("Vault artifact digest mismatch");
    }
    return payload;
  }
}

function vaultExportRecordToPostgresRow(record: VaultExportRecord) {
  return {
    id: record.id,
    userId: record.userId,
    kind: record.kind,
    status: record.status,
    format: record.format,
    includePublicCache: record.includePublicCache,
    includeReceipts: record.includeReceipts,
    includeContent: record.includeContent,
    artifactDigest: record.artifactDigest,
    artifactByteSize: record.artifactByteSize,
    artifactStorageKey: record.artifactStorageKey,
    artifact: record.artifact,
    eventCount: record.eventCount,
    deviceCount: record.deviceCount,
    sourceCount: record.sourceCount,
    receiptCount: record.receiptCount,
    error: record.error,
    createdAt: new Date(record.createdAt),
    finishedAt: record.finishedAt ? new Date(record.finishedAt) : undefined,
  };
}

function vaultExportRecordFromPostgresRow(row: any): VaultExportRecord {
  const artifact = row.artifact
    ? vaultEncryptedPayloadSchema.safeParse(row.artifact)
    : null;
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    status: row.status,
    format: row.format,
    includePublicCache: Boolean(row.includePublicCache),
    includeReceipts: Boolean(row.includeReceipts),
    includeContent: Boolean(row.includeContent),
    ...(row.artifactDigest ? { artifactDigest: row.artifactDigest } : {}),
    ...(row.artifactByteSize !== null && row.artifactByteSize !== undefined
      ? { artifactByteSize: row.artifactByteSize }
      : {}),
    ...(row.artifactStorageKey
      ? { artifactStorageKey: row.artifactStorageKey }
      : {}),
    ...(artifact?.success ? { artifact: artifact.data } : {}),
    eventCount: Number(row.eventCount ?? 0),
    deviceCount: Number(row.deviceCount ?? 0),
    ...(row.sourceCount !== null && row.sourceCount !== undefined
      ? { sourceCount: Number(row.sourceCount) }
      : {}),
    ...(row.receiptCount !== null && row.receiptCount !== undefined
      ? { receiptCount: Number(row.receiptCount) }
      : {}),
    ...(row.error ? { error: row.error } : {}),
    createdAt: dateString(row.createdAt),
    ...(row.finishedAt ? { finishedAt: dateString(row.finishedAt) } : {}),
  };
}

function dateString(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}
