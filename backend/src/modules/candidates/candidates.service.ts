import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ILike, Repository } from "typeorm";
import { DESTRUCTIVE_ROLES, MASTER_DATA_ROLES, AuthorizationService } from "../../common/auth/authorization.service";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { CandidateEntity } from "../../entities";
import { CreateCandidateDto, UpdateCandidateDto } from "./dtos";

@Injectable()
export class CandidatesService {
  constructor(
    @InjectRepository(CandidateEntity)
    private readonly candidates: Repository<CandidateEntity>,
    private readonly authz: AuthorizationService,
  ) {}

  async list(query: { search?: string; status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const take = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const where = query.search
      ? [{ name: ILike(`%${query.search}%`) }, { email: ILike(`%${query.search}%`) }]
      : query.status ? { status: query.status } : {};
    const [data, total] = await this.candidates.findAndCount({
      where,
      order: { createdAt: "DESC" },
      skip: (page - 1) * take,
      take,
    });
    return { data, total, page, pageSize: take };
  }

  async get(id: string) {
    const candidate = await this.candidates.findOne({
      where: { id },
      relations: { resumes: true, applications: { job: true } },
      order: { applications: { appliedAt: "DESC" } },
    });
    if (!candidate) throw new NotFoundException("Candidate not found.");
    return candidate;
  }

  async create(user: CurrentUser, dto: CreateCandidateDto) {
    await this.authz.requireRole(user, MASTER_DATA_ROLES);
    return this.candidates.save(this.candidates.create(dto));
  }

  async update(user: CurrentUser, id: string, dto: UpdateCandidateDto) {
    await this.authz.requireRole(user, MASTER_DATA_ROLES);
    const candidate = await this.get(id);
    Object.assign(candidate, dto);
    return this.candidates.save(candidate);
  }

  async delete(user: CurrentUser, id: string) {
    await this.authz.requireRole(user, DESTRUCTIVE_ROLES);
    const candidate = await this.get(id);
    await this.candidates.softRemove(candidate);
    return { ok: true };
  }
}
