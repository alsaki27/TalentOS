import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomBytes } from "crypto";
import { OrgInviteEntity } from "../../entities";
import { CreateInviteDto, AcceptInviteDto } from "./dtos";

@Injectable()
export class InvitesService {
  constructor(
    @InjectRepository(OrgInviteEntity)
    private readonly invites: Repository<OrgInviteEntity>,
  ) {}

  async createInvite(dto: CreateInviteDto) {
    const token = randomBytes(32).toString("hex");
    const invite = this.invites.create({
      ...dto,
      token,
      status: "pending",
    });
    const saved = await this.invites.save(invite);
    // TODO: integrate email delivery
    return saved;
  }

  listInvites() {
    return this.invites.find({ order: { createdAt: "DESC" } });
  }

  async revokeInvite(id: string) {
    const invite = await this.invites.findOne({ where: { id } });
    if (!invite) throw new NotFoundException("Invite not found.");
    invite.status = "revoked";
    return this.invites.save(invite);
  }

  async acceptInvite(dto: AcceptInviteDto) {
    const invite = await this.invites.findOne({ where: { token: dto.token } });
    if (!invite) throw new NotFoundException("Invite not found.");
    if (invite.status !== "pending") throw new NotFoundException("Invite is not pending.");
    invite.status = "accepted";
    invite.acceptedAt = new Date();
    return this.invites.save(invite);
  }

  async resendInvite(id: string) {
    const invite = await this.invites.findOne({ where: { id } });
    if (!invite) throw new NotFoundException("Invite not found.");
    invite.token = randomBytes(32).toString("hex");
    invite.status = "pending";
    const saved = await this.invites.save(invite);
    // TODO: integrate email delivery
    return saved;
  }
}
