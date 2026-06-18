import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ILike, Repository } from "typeorm";
import { MASTER_DATA_ROLES, AuthorizationService } from "../../common/auth/authorization.service";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { normalizeCompanyName, slugifyCompanyName } from "../../common/domain/company-normalizer";
import { CompanyEntity, CompanyPersonEntity } from "../../entities";
import { CreateCompanyDto, CreateCompanyPersonDto, UpdateCompanyDto, UpdateCompanyPersonDto } from "./dtos";

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(CompanyEntity)
    private readonly companies: Repository<CompanyEntity>,
    @InjectRepository(CompanyPersonEntity)
    private readonly people: Repository<CompanyPersonEntity>,
    private readonly authz: AuthorizationService,
  ) {}

  async list(query: { search?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const take = Math.min(100, Math.max(1, query.pageSize ?? 50));
    const [data, total] = await this.companies.findAndCount({
      where: query.search ? { name: ILike(`%${query.search}%`) } : {},
      order: { lastSeenAt: "DESC" },
      skip: (page - 1) * take,
      take,
    });
    return { data, total, page, pageSize: take };
  }

  async get(id: string) {
    const company = await this.companies.findOne({ where: { id }, relations: { jobs: true, people: true } });
    if (!company) throw new NotFoundException("Company not found.");
    return company;
  }

  async create(user: CurrentUser, dto: CreateCompanyDto) {
    await this.authz.requireRole(user, MASTER_DATA_ROLES);
    const normalizedName = normalizeCompanyName(dto.name);
    const existing = await this.companies.findOne({ where: { normalizedName } });
    const company = existing ?? this.companies.create({ name: dto.name, normalizedName, slug: slugifyCompanyName(dto.name) });
    Object.assign(company, dto, { normalizedName, slug: slugifyCompanyName(dto.name), lastSeenAt: new Date() });
    return this.companies.save(company);
  }

  async update(user: CurrentUser, id: string, dto: UpdateCompanyDto) {
    await this.authz.requireRole(user, MASTER_DATA_ROLES);
    const company = await this.get(id);
    Object.assign(company, dto);
    if (dto.name) {
      company.normalizedName = normalizeCompanyName(dto.name);
      company.slug = slugifyCompanyName(dto.name);
    }
    return this.companies.save(company);
  }

  async addPerson(user: CurrentUser, companyId: string, dto: CreateCompanyPersonDto) {
    await this.authz.requireRole(user, MASTER_DATA_ROLES);
    await this.get(companyId);
    const person = this.people.create({
      ...dto,
      companyId,
      normalizedName: normalizeCompanyName(dto.fullName),
      lastSeenAt: new Date(),
    });
    return this.people.save(person);
  }

  async updatePerson(user: CurrentUser, personId: string, dto: UpdateCompanyPersonDto) {
    await this.authz.requireRole(user, MASTER_DATA_ROLES);
    const person = await this.people.findOne({ where: { id: personId } });
    if (!person) throw new NotFoundException("Company person not found.");
    Object.assign(person, dto);
    if (dto.fullName) person.normalizedName = normalizeCompanyName(dto.fullName);
    person.lastSeenAt = new Date();
    return this.people.save(person);
  }
}
