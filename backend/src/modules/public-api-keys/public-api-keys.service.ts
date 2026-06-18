import crypto from "crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import { AuthorizationService } from "../../common/auth/authorization.service";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { AuditLogEntity, PublicApiKeyEntity } from "../../entities";
import { CreatePublicApiKeyDto, publicApiScopes } from "./dtos";

function generateKey() {
  return `sk_live_${crypto.randomBytes(32).toString("base64url")}`;
}

function hashKey(key: string) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

@Injectable()
export class PublicApiKeysService {
  constructor(
    @InjectRepository(PublicApiKeyEntity)
    private readonly keys: Repository<PublicApiKeyEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly auditLogs: Repository<AuditLogEntity>,
    private readonly authz: AuthorizationService,
  ) {}

  async list(user: CurrentUser) {
    await this.authz.requireRole(user, ["admin"]);
    const keys = await this.keys.find({ where: { revokedAt: IsNull() }, order: { createdAt: "DESC" } });
    return { keys, availableScopes: publicApiScopes };
  }

  async create(user: CurrentUser, dto: CreatePublicApiKeyDto) {
    const profile = await this.authz.requireRole(user, ["admin"]);
    const key = generateKey();
    const row = await this.keys.save(this.keys.create({
      name: dto.name,
      scopes: dto.scopes,
      keyPrefix: key.slice(0, 16),
      keyHash: hashKey(key),
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      metadata: dto.metadata,
      createdByUserId: profile.id,
      createdByEmail: profile.email,
    }));
    await this.auditLogs.save(this.auditLogs.create({
      actorUserId: profile.id,
      actorEmail: profile.email,
      action: "public_api_key.created",
      entityType: "public_api_key",
      entityId: row.id,
      metadata: { name: dto.name, scopes: dto.scopes },
    }));
    return { ...row, key };
  }

  async revoke(user: CurrentUser, id: string) {
    const profile = await this.authz.requireRole(user, ["admin"]);
    const key = await this.keys.findOne({ where: { id } });
    if (!key) throw new NotFoundException("API key not found.");
    key.revokedAt = new Date();
    await this.keys.save(key);
    await this.auditLogs.save(this.auditLogs.create({
      actorUserId: profile.id,
      actorEmail: profile.email,
      action: "public_api_key.revoked",
      entityType: "public_api_key",
      entityId: id,
      metadata: { name: key.name, scopes: key.scopes },
    }));
    return { ok: true };
  }
}
