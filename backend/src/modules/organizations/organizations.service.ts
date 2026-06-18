import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { OrganizationEntity } from "../../entities";
import { CreateOrganizationDto, UpdateOrganizationDto } from "./dtos";

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly organizations: Repository<OrganizationEntity>,
  ) {}

  list() {
    return this.organizations.find({ order: { createdAt: "DESC" } });
  }

  create(dto: CreateOrganizationDto) {
    return this.organizations.save(this.organizations.create(dto));
  }

  async get(id: string) {
    const org = await this.organizations.findOne({ where: { id } });
    if (!org) throw new NotFoundException("Organization not found.");
    return org;
  }

  async findBySlug(slug: string) {
    const org = await this.organizations.findOne({ where: { slug } });
    if (!org) throw new NotFoundException("Organization not found.");
    return org;
  }

  async update(id: string, dto: UpdateOrganizationDto) {
    const org = await this.get(id);
    Object.assign(org, dto);
    return this.organizations.save(org);
  }

  async getMembers(id: string) {
    const org = await this.organizations.findOne({
      where: { id },
      relations: { members: true },
    });
    if (!org) throw new NotFoundException("Organization not found.");
    return { organizationId: org.id, members: org.members ?? [] };
  }

  async getSubscription(id: string) {
    const org = await this.organizations.findOne({
      where: { id },
      relations: { subscriptions: { plan: true } },
    });
    if (!org) throw new NotFoundException("Organization not found.");
    const subscription = org.subscriptions?.[0] ?? null;
    return { organizationId: org.id, subscription };
  }
}
