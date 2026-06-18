import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ILike, Repository } from "typeorm";
import { DESTRUCTIVE_ROLES, MASTER_DATA_ROLES, AuthorizationService } from "../../common/auth/authorization.service";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { normalizeCompanyName, slugifyCompanyName } from "../../common/domain/company-normalizer";
import { categorizeJob } from "../../common/domain/job-categorizer";
import { CompanyEntity, JobEntity } from "../../entities";
import { CreateJobDto, UpdateJobDto } from "./dtos";

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(JobEntity)
    private readonly jobs: Repository<JobEntity>,
    @InjectRepository(CompanyEntity)
    private readonly companies: Repository<CompanyEntity>,
    private readonly authz: AuthorizationService,
  ) {}

  async list(query: { search?: string; source?: string; category?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const take = Math.min(100, Math.max(1, query.pageSize ?? 50));
    const qb = this.jobs.createQueryBuilder("job")
      .leftJoinAndSelect("job.applications", "applications")
      .leftJoinAndSelect("applications.candidate", "candidate")
      .orderBy("job.createdAt", "DESC")
      .skip((page - 1) * take)
      .take(take);
    if (query.search) {
      qb.andWhere("(job.title ILIKE :search OR job.company ILIKE :search OR job.location ILIKE :search)", { search: `%${query.search}%` });
    }
    if (query.source) qb.andWhere("job.source = :source", { source: query.source });
    if (query.category) qb.andWhere("(job.jobCategory = :category OR :category = ANY(job.categoryTags))", { category: query.category });
    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, pageSize: take };
  }

  async get(id: string) {
    const job = await this.jobs.findOne({
      where: { id },
      relations: { applications: { candidate: true }, comments: true, companyProfile: true },
    });
    if (!job) throw new NotFoundException("Job not found.");
    return job;
  }

  async create(user: CurrentUser, dto: CreateJobDto) {
    await this.authz.requireRole(user, MASTER_DATA_ROLES);
    await this.assertNotDuplicate(dto);
    const category = categorizeJob([dto.title, dto.notes, dto.descriptionText, dto.jobFunction, dto.industries, dto.companyDescription]);
    const job = await this.jobs.save(this.jobs.create({ ...dto, ...category, source: dto.source ?? "manual" }));
    await this.syncCompany(job);
    return job;
  }

  async update(user: CurrentUser, id: string, dto: UpdateJobDto) {
    await this.authz.requireRole(user, MASTER_DATA_ROLES);
    const job = await this.get(id);
    Object.assign(job, dto);
    Object.assign(job, categorizeJob([job.title, job.notes, job.descriptionText, job.jobFunction, job.industries, job.companyDescription]));
    const saved = await this.jobs.save(job);
    await this.syncCompany(saved);
    return saved;
  }

  async delete(user: CurrentUser, id: string) {
    await this.authz.requireRole(user, DESTRUCTIVE_ROLES);
    await this.jobs.softRemove(await this.get(id));
    return { ok: true };
  }

  private async assertNotDuplicate(dto: CreateJobDto) {
    if (dto.sourceUrl) {
      const existing = await this.jobs.findOne({ where: { sourceUrl: dto.sourceUrl } });
      if (existing) throw new ConflictException("Duplicate job source URL.");
    }
    const existing = await this.jobs.findOne({
      where: {
        title: ILike(dto.title),
        company: dto.company ?? undefined,
        postedAt: dto.postedAt ?? undefined,
        applicantsCount: dto.applicantsCount ?? undefined,
      },
    });
    if (existing) throw new ConflictException("Duplicate job title/company/posted date/applicant count.");
  }

  private async syncCompany(job: JobEntity) {
    if (!job.company?.trim()) return;
    const normalizedName = normalizeCompanyName(job.company);
    let company = await this.companies.findOne({ where: { normalizedName } });
    company ??= this.companies.create({ name: job.company, normalizedName, slug: slugifyCompanyName(job.company) });
    company.website ??= job.companyWebsite;
    company.linkedinUrl ??= job.companyLinkedinUrl;
    company.logoUrl ??= job.companyLogoUrl;
    company.employeesCount ??= job.companyEmployeesCount;
    company.description ??= job.companyDescription;
    company.slogan ??= job.companySlogan;
    company.source ??= job.source;
    company.lastSeenAt = new Date();
    company = await this.companies.save(company);
    if (job.companyId !== company.id) {
      job.companyId = company.id;
      await this.jobs.save(job);
    }
  }
}
