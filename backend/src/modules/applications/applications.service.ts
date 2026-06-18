import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  ASSIGNMENT_MANAGER_ROLES,
  AuthorizationService,
} from "../../common/auth/authorization.service";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { applicationAutomation } from "../../common/domain/application-automation";
import {
  ApplicationCommentEntity,
  ApplicationEntity,
  ApplicationEventEntity,
  AuditLogEntity,
  ProfileEntity,
} from "../../entities";
import { CreateApplicationCommentDto, CreateApplicationDto, UpdateApplicationDto } from "./dtos";

@Injectable()
export class ApplicationsService {
  constructor(
    @InjectRepository(ApplicationEntity)
    private readonly applications: Repository<ApplicationEntity>,
    @InjectRepository(ApplicationEventEntity)
    private readonly events: Repository<ApplicationEventEntity>,
    @InjectRepository(ApplicationCommentEntity)
    private readonly comments: Repository<ApplicationCommentEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly auditLogs: Repository<AuditLogEntity>,
    private readonly authz: AuthorizationService,
  ) {}

  async list(user: CurrentUser, query: { status?: string; assignedToMe?: boolean; page?: number; pageSize?: number }) {
    const profile = await this.authz.profileFor(user);
    const page = Math.max(1, query.page ?? 1);
    const take = Math.min(150, Math.max(1, query.pageSize ?? 50));
    const qb = this.applications.createQueryBuilder("application")
      .leftJoinAndSelect("application.candidate", "candidate")
      .leftJoinAndSelect("application.job", "job")
      .orderBy("application.appliedAt", "DESC")
      .skip((page - 1) * take)
      .take(take);
    if (query.status) qb.andWhere("application.status = :status", { status: query.status });
    if (profile.role === "application_engineer" || query.assignedToMe) {
      qb.andWhere("(application.assignedToUserId = :profileId OR application.assignedTo = :email OR application.assignedTo = :name)", {
        profileId: profile.id,
        email: profile.email,
        name: profile.displayName,
      });
    }
    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, pageSize: take };
  }

  async get(user: CurrentUser, id: string) {
    const profile = await this.authz.profileFor(user);
    const application = await this.applications.findOne({
      where: { id },
      relations: { candidate: true, job: true, comments: true, events: true },
    });
    if (!application) throw new NotFoundException("Application not found.");
    this.authz.assertApplicationVisibility(profile, application);
    return application;
  }

  async create(user: CurrentUser, dto: CreateApplicationDto) {
    const profile = await this.authz.profileFor(user);
    const isAssignment = ["assigned", "stacked", "in_progress"].includes(dto.status) || Boolean(dto.assignedToUserId || dto.assignedTo);
    if (isAssignment) await this.authz.requireRole(user, ASSIGNMENT_MANAGER_ROLES);
    const automated = applicationAutomation({
      status: dto.status,
      explicitFollowUp: dto.followUpAt !== undefined,
      explicitNextAction: dto.nextAction !== undefined,
      explicitAssignmentDue: dto.assignmentDueAt !== undefined,
    });
    const application = this.applications.create({
      ...dto,
      assignedByUserId: profile.id,
      followUpAt: dto.followUpAt ?? automated.followUpAt ?? null,
      nextAction: dto.nextAction ?? automated.nextAction ?? null,
      assignmentDueAt: dto.assignmentDueAt ?? automated.assignmentDueAt ?? null,
      followUpSource: dto.followUpAt ? "manual" : automated.followUpSource ?? null,
      followUpCreatedAt: automated.followUpCreatedAt ?? null,
      appliedAt: new Date(),
    });
    const saved = await this.applications.save(application).catch((err: { code?: string }) => {
      if (err.code === "23505") throw new ConflictException("Candidate already has an application for this job.");
      throw err;
    });
    await this.events.save(this.events.create({ applicationId: saved.id, fromStatus: null, toStatus: saved.status, note: dto.assignmentNote ?? null }));
    await this.auditLogs.save(this.auditLogs.create({
      actorUserId: profile.id,
      actorEmail: profile.email,
      action: "application.created",
      entityType: "application",
      entityId: saved.id,
      metadata: { candidateId: saved.candidateId, jobId: saved.jobId, status: saved.status },
    }));
    return saved;
  }

  async update(user: CurrentUser, id: string, dto: UpdateApplicationDto) {
    const profile = await this.authz.profileFor(user);
    const application = await this.get(user, id);
    const touchesAssignment = ["assignedTo", "assignedToUserId", "assignmentNote", "assignmentDueAt", "priority", "reviewStatus"].some((field) => field in dto);
    if (touchesAssignment) await this.authz.requireRole(user, ASSIGNMENT_MANAGER_ROLES);
    const previousStatus = application.status;
    Object.assign(application, dto);
    if (dto.reviewStatus === "approved" || dto.reviewStatus === "changes_requested") {
      application.reviewedByUserId = profile.id;
      application.reviewedAt = new Date();
    }
    if (dto.status) {
      const automated = applicationAutomation({
        status: dto.status,
        explicitFollowUp: dto.followUpAt !== undefined,
        explicitNextAction: dto.nextAction !== undefined,
        explicitAssignmentDue: dto.assignmentDueAt !== undefined,
      });
      Object.assign(application, automated);
    }
    const saved = await this.applications.save(application);
    if (dto.status && dto.status !== previousStatus) {
      await this.events.save(this.events.create({ applicationId: id, fromStatus: previousStatus, toStatus: dto.status }));
    }
    await this.auditLogs.save(this.auditLogs.create({
      actorUserId: profile.id,
      actorEmail: profile.email,
      action: "application.updated",
      entityType: "application",
      entityId: id,
      metadata: { fields: Object.keys(dto) },
    }));
    return saved;
  }

  async addComment(user: CurrentUser, id: string, dto: CreateApplicationCommentDto) {
    const profile = await this.authz.profileFor(user);
    await this.get(user, id);
    return this.comments.save(this.comments.create({
      applicationId: id,
      commenterName: profile.displayName || profile.email || "User",
      commenterUserId: profile.id,
      body: dto.body,
      visibleToCandidate: dto.visibleToCandidate,
      parentCommentId: dto.parentCommentId ?? null,
    }));
  }
}
